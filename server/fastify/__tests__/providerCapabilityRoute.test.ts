import { describe, expect, it } from 'vitest'
import { LLMFormat } from '@risuai/shared-core/model-types'
import type { FastifyDatabase as Database } from '../src/prompt/serverTypes.js'
import { resolveModelProfile } from '../../../src/ts/model/modelProfileResolver'
import { resolveChatProviderRoute } from '../src/prompt/chatDispatch.js'

// Proves the server /chat dispatcher wires the shared capability table
// consistently with the browser completion path; the unknown-id guard stays
// server-only, and the reverse_proxy + ooba case dispatches instead of hard-failing.

function db(overrides: Partial<Database> = {}): Database {
  return { aiModel: 'echo_model', ...overrides } as unknown as Database
}

describe('resolveChatProviderRoute — routable', () => {
  it('routes echo and anthropic', () => {
    expect(resolveChatProviderRoute(db({ aiModel: 'echo_model' }))).toEqual({
      routable: true,
      provider: 'echo',
    })
    expect(resolveChatProviderRoute(db({ aiModel: 'claude-3-5-sonnet-20241022' }))).toEqual({
      routable: true,
      provider: 'anthropic',
    })
  })

  it.each(['gpt-5.5', 'gpt-5.5-2026-04-23'])('routes the registered OpenAI model %s', (aiModel) => {
    const database = db({ aiModel, openAIKey: 'sk-openai' })
    expect(resolveChatProviderRoute(database)).toEqual({ routable: true, provider: 'openai' })
    expect(resolveChatProviderRoute(database, resolveModelProfile({ database }))).toEqual({
      routable: true,
      provider: 'openai',
    })
  })

  it('routes Claude Opus 4.8 through the Anthropic adapter', () => {
    const database = db({ aiModel: 'claude-opus-4-8', claudeAPIKey: 'sk-anthropic' })
    expect(resolveChatProviderRoute(database, resolveModelProfile({ database }))).toEqual({
      routable: true,
      provider: 'anthropic',
    })
  })

  it.each(['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'])(
    'routes the registered Google model %s through the Gemini adapter',
    (aiModel) => {
      const database = db({ aiModel, google: { accessToken: 'studio-key', projectId: 'project' } })
      const profile = resolveModelProfile({ database })
      expect(profile.modelInfo.parameters).toContain('reasoning_effort')
      expect(resolveChatProviderRoute(database, profile)).toEqual({ routable: true, provider: 'gemini' })
    },
  )

  it('routes a configured reverse_proxy under OpenAICompatible', () => {
    expect(
      resolveChatProviderRoute(
        db({
          aiModel: 'reverse_proxy',
          customAPIFormat: LLMFormat.OpenAICompatible,
          forceReplaceUrl: 'https://proxy.example.com/v1',
          proxyKey: 'sk-proxy',
        } as Partial<Database>),
      ),
    ).toEqual({ routable: true, provider: 'openai' })
  })

  it('routes reverse_proxy + reverseProxyOobaMode to openai (decision #5 — the flip)', () => {
    // Previously this hard-failed with "Ooba OpenAI-compatible reverse proxy must
    // use local dispatch". The shared table no longer gates on the ooba flag and
    // the openai adapter applies oobaSystemHoist itself, so it now dispatches —
    // matching the browser completion path.
    expect(
      resolveChatProviderRoute(
        db({
          aiModel: 'reverse_proxy',
          customProxyRequestModel: 'ooba-model',
          customAPIFormat: LLMFormat.OpenAICompatible,
          reverseProxyOobaMode: true,
          forceReplaceUrl: 'https://proxy.example.com/v1',
          proxyKey: 'sk-proxy',
        } as Partial<Database>),
      ),
    ).toEqual({ routable: true, provider: 'openai' })
  })

  it('routes ollama-cloud by ollamaRequestFormat (with an API key)', () => {
    expect(
      resolveChatProviderRoute(
        db({
          aiModel: 'ollama-cloud',
          ollamaApiKey: 'k',
          ollamaRequestFormat: LLMFormat.Ollama,
        } as Partial<Database>),
      ),
    ).toEqual({ routable: true, provider: 'ollama' })
    expect(
      resolveChatProviderRoute(
        db({
          aiModel: 'ollama-cloud',
          ollamaApiKey: 'k',
          ollamaRequestFormat: LLMFormat.OpenAICompatible,
        } as Partial<Database>),
      ),
    ).toEqual({ routable: true, provider: 'openai' })
    expect(
      resolveChatProviderRoute(
        db({
          aiModel: 'ollama-cloud',
          ollamaApiKey: 'k',
          ollamaRequestFormat: LLMFormat.Anthropic,
        } as Partial<Database>),
      ),
    ).toEqual({ routable: true, provider: 'anthropic' })
  })

  it('can route directly from a resolved profile capability verdict', () => {
    const database = db({
      aiModel: 'ollama-cloud',
      ollamaApiKey: 'k',
      ollamaRequestFormat: LLMFormat.OpenAIResponseAPI,
    } as Partial<Database>)
    const profile = resolveModelProfile({ database })
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'openai-responses' })
    expect(resolveChatProviderRoute(database, profile)).toEqual({
      routable: true,
      provider: 'openai-responses',
    })
  })
})

describe('resolveChatProviderRoute — unsupported (specific messages preserved)', () => {
  it.each([
    ['novelai', 'unsupported /chat provider: NovelAI text generation must use local dispatch'],
    ['novellist', 'unsupported /chat provider: NovelList must use local dispatch'],
    ['custom', 'unsupported /chat provider: plugin providers must use local dispatch'],
    ['pluginmodel:::provider-a', 'unsupported /chat provider: plugin providers must use local dispatch'],
    ['hf:::Xenova/opt-350m', 'unsupported /chat provider: local WebLLM models must use local dispatch'],
  ])('classifies %s as unsupported with its specific reason', (aiModel, reason) => {
    expect(resolveChatProviderRoute(db({ aiModel }))).toEqual({ routable: false, reason })
  })

  it('keeps the server-only unknown-OpenAI-compatible-id guard', () => {
    const route = resolveChatProviderRoute(db({ aiModel: 'unregistered-local-model' }))
    expect(route.routable).toBe(false)
    expect(route).toEqual({
      routable: false,
      reason:
        'unsupported /chat provider: unknown OpenAI-compatible model "unregistered-local-model" cannot be dispatched by the server',
    })
  })

  it('keeps the unknown-id guard when the route helper receives a resolved profile', () => {
    const database = db({ aiModel: 'unregistered-local-model', openAIKey: 'sk-server-owned' })
    const route = resolveChatProviderRoute(database, resolveModelProfile({ database }))
    expect(route).toEqual({
      routable: false,
      reason:
        'unsupported /chat provider: unknown OpenAI-compatible model "unregistered-local-model" cannot be dispatched by the server',
    })
  })

  it('classifies ollama-cloud without an API key as unsupported (matches the browser gate)', () => {
    expect(
      resolveChatProviderRoute(
        db({
          aiModel: 'ollama-cloud',
          ollamaRequestFormat: LLMFormat.OpenAICompatible,
        } as Partial<Database>),
      ).routable,
    ).toBe(false)
  })
})
