import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS } from '../../../src/ts/model/modelProfileResolver.js'
import { LLMFormat, type LLMFormat as LLMFormatValue } from '../../../src/ts/model/types.js'
import { formatToServerProvider } from '../../../src/ts/process/request/providerCapability.js'
import { SERVER_IMAGE_GENERATION_PROVIDERS } from '../../../src/ts/server/imageGenerationProtocol.js'
import { PROVIDER_OPERATIONS } from '@risuai/protocol/provider-operation'
import { TTS_SYNTHESIS_OPERATIONS } from '../../../src/ts/server/ttsProtocol.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

type TextAdapterOwner = {
  adapter: string
  resolver: string
  runner: string
  dispatchAnchor: string
  assurance: string
}

/** Every provider admitted by the legacy completion route and shared chat dispatcher. */
const TEXT_ADAPTER_OWNERS: Record<string, TextAdapterOwner> = {
  echo: {
    adapter: 'server/fastify/src/generation/echo.ts',
    resolver: 'resolveEchoRequest',
    runner: 'runEcho',
    dispatchAnchor: "provider === 'echo'",
    assurance: 'server/fastify/__tests__/echo.test.ts',
  },
  openai: {
    adapter: 'server/fastify/src/generation/openai.ts',
    resolver: 'resolveOpenAIRequest',
    runner: 'runOpenAI',
    dispatchAnchor: "provider === 'openai' || provider === 'openrouter'",
    assurance: 'server/fastify/__tests__/openai.test.ts',
  },
  nanogpt: {
    adapter: 'server/fastify/src/generation/openai.ts',
    resolver: 'resolveOpenAIRequest',
    runner: 'runOpenAI',
    dispatchAnchor: "provider === 'nanogpt'",
    assurance: 'server/fastify/__tests__/chatDispatchProfileOptions.test.ts',
  },
  openrouter: {
    adapter: 'server/fastify/src/generation/openai.ts',
    resolver: 'resolveOpenAIRequest',
    runner: 'runOpenAI',
    dispatchAnchor: "provider === 'openrouter'",
    assurance: 'server/fastify/__tests__/chatDispatchProfileOptions.test.ts',
  },
  anthropic: {
    adapter: 'server/fastify/src/generation/anthropic.ts',
    resolver: 'resolveAnthropicRequest',
    runner: 'runAnthropic',
    dispatchAnchor: "provider === 'anthropic'",
    assurance: 'server/fastify/__tests__/anthropic.test.ts',
  },
  mistral: {
    adapter: 'server/fastify/src/generation/mistral.ts',
    resolver: 'resolveMistralRequest',
    runner: 'runMistral',
    dispatchAnchor: "provider === 'mistral'",
    assurance: 'server/fastify/__tests__/mistral.test.ts',
  },
  cohere: {
    adapter: 'server/fastify/src/generation/cohere.ts',
    resolver: 'resolveCohereRequest',
    runner: 'runCohere',
    dispatchAnchor: "provider === 'cohere'",
    assurance: 'server/fastify/__tests__/cohere.test.ts',
  },
  gemini: {
    adapter: 'server/fastify/src/generation/gemini.ts',
    resolver: 'resolveGeminiRequest',
    runner: 'runGemini',
    dispatchAnchor: "provider === 'gemini'",
    assurance: 'server/fastify/__tests__/gemini.test.ts',
  },
  'openai-legacy-instruct': {
    adapter: 'server/fastify/src/generation/openaiLegacyInstruct.ts',
    resolver: 'resolveOpenAILegacyInstructRequest',
    runner: 'runOpenAILegacyInstruct',
    dispatchAnchor: "provider === 'openai-legacy-instruct'",
    assurance: 'server/fastify/__tests__/openaiLegacyInstruct.test.ts',
  },
  'openai-responses': {
    adapter: 'server/fastify/src/generation/openaiResponses.ts',
    resolver: 'resolveOpenAIResponsesRequest',
    runner: 'runOpenAIResponses',
    dispatchAnchor: "provider === 'openai-responses'",
    assurance: 'server/fastify/__tests__/openaiResponses.test.ts',
  },
  kobold: {
    adapter: 'server/fastify/src/generation/kobold.ts',
    resolver: 'resolveKoboldRequest',
    runner: 'runKobold',
    dispatchAnchor: "provider === 'kobold'",
    assurance: 'server/fastify/__tests__/kobold.test.ts',
  },
  'ooba-legacy': {
    adapter: 'server/fastify/src/generation/oobaLegacy.ts',
    resolver: 'resolveOobaLegacyRequest',
    runner: 'runOobaLegacy',
    dispatchAnchor: "provider === 'ooba-legacy'",
    assurance: 'server/fastify/__tests__/oobaLegacy.test.ts',
  },
  ollama: {
    adapter: 'server/fastify/src/generation/ollama.ts',
    resolver: 'resolveOllamaRequest',
    runner: 'runOllama',
    dispatchAnchor: "provider === 'ollama'",
    assurance: 'server/fastify/__tests__/ollama.test.ts',
  },
  bedrock: {
    adapter: 'server/fastify/src/generation/bedrock.ts',
    resolver: 'resolveBedrockRequest',
    runner: 'runBedrock',
    dispatchAnchor: "provider === 'bedrock'",
    assurance: 'server/fastify/__tests__/bedrock.test.ts',
  },
  horde: {
    adapter: 'server/fastify/src/generation/horde.ts',
    resolver: 'resolveHordeRequest',
    runner: 'runHorde',
    dispatchAnchor: "provider === 'horde'",
    assurance: 'server/fastify/__tests__/horde.test.ts',
  },
}

type FormatPolicy = { provider: string | null; retention: 'server' | 'browser-only' }

/** Every retained browser model format is either server-routable or explicitly browser-only. */
const LLM_FORMAT_POLICY: Record<LLMFormatValue, FormatPolicy> = {
  [LLMFormat.OpenAICompatible]: { provider: 'openai', retention: 'server' },
  [LLMFormat.OpenAILegacyInstruct]: { provider: 'openai-legacy-instruct', retention: 'server' },
  [LLMFormat.Anthropic]: { provider: 'anthropic', retention: 'server' },
  [LLMFormat.AnthropicLegacy]: { provider: 'anthropic', retention: 'server' },
  [LLMFormat.Mistral]: { provider: 'mistral', retention: 'server' },
  [LLMFormat.GoogleCloud]: { provider: 'gemini', retention: 'server' },
  [LLMFormat.VertexAIGemini]: { provider: 'gemini', retention: 'server' },
  [LLMFormat.NovelList]: { provider: null, retention: 'browser-only' },
  [LLMFormat.Cohere]: { provider: 'cohere', retention: 'server' },
  [LLMFormat.NovelAI]: { provider: null, retention: 'browser-only' },
  [LLMFormat.WebLLM]: { provider: null, retention: 'browser-only' },
  [LLMFormat.OobaLegacy]: { provider: 'ooba-legacy', retention: 'server' },
  [LLMFormat.Plugin]: { provider: null, retention: 'browser-only' },
  [LLMFormat.Ooba]: { provider: null, retention: 'browser-only' },
  [LLMFormat.Kobold]: { provider: 'kobold', retention: 'server' },
  [LLMFormat.Ollama]: { provider: 'ollama', retention: 'server' },
  [LLMFormat.Horde]: { provider: 'horde', retention: 'server' },
  [LLMFormat.AWSBedrockClaude]: { provider: 'bedrock', retention: 'server' },
  [LLMFormat.OpenAIResponseAPI]: { provider: 'openai-responses', retention: 'server' },
  [LLMFormat.Echo]: { provider: 'echo', retention: 'server' },
  [LLMFormat.NanoGPT]: { provider: 'nanogpt', retention: 'server' },
  [LLMFormat.NanoGPTResponses]: { provider: 'openai-responses', retention: 'server' },
  [LLMFormat.NanoGPTMessages]: { provider: 'anthropic', retention: 'server' },
  [LLMFormat.NanoGPTLegacy]: { provider: 'openai-legacy-instruct', retention: 'server' },
}

type FirstClassProviderPolicy = {
  dispatchTargets: readonly string[]
  endpointCredentialAnchor: string
  optionAnchor: string
}

/** Profile ids additionally own endpoint, credential, and provider-option resolution. */
const FIRST_CLASS_PROVIDER_POLICY: Record<
  (typeof FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS)[number],
  FirstClassProviderPolicy
> = {
  openai: {
    dispatchTargets: ['openai'],
    endpointCredentialAnchor: "case 'openai':",
    optionAnchor: 'deriveOpenAIBaseUrl',
  },
  llmgateway: {
    dispatchTargets: ['openai'],
    endpointCredentialAnchor: "case 'llmgateway':",
    optionAnchor: 'LLM_GATEWAY_BASE_URL',
  },
  neuralwatt: {
    dispatchTargets: ['openai'],
    endpointCredentialAnchor: "case 'neuralwatt':",
    optionAnchor: 'NEURALWATT_BASE_URL',
  },
  anthropic: {
    dispatchTargets: ['anthropic'],
    endpointCredentialAnchor: "case 'anthropic':",
    optionAnchor: 'apiKey',
  },
  google: {
    dispatchTargets: ['gemini'],
    endpointCredentialAnchor: "case 'google':",
    optionAnchor: 'extraHeaders',
  },
  vertex: {
    dispatchTargets: ['gemini'],
    endpointCredentialAnchor: "case 'vertex':",
    optionAnchor: 'privateKey',
  },
  ollama: {
    dispatchTargets: ['anthropic', 'ollama', 'openai', 'openai-responses'],
    endpointCredentialAnchor: "case 'ollama':",
    optionAnchor: 'requestFormat',
  },
  'custom-api': {
    dispatchTargets: ['openai'],
    endpointCredentialAnchor: "case 'custom-api':",
    optionAnchor: 'baseUrl',
  },
  'debug-echo': {
    dispatchTargets: ['echo'],
    endpointCredentialAnchor: "case 'debug-echo':",
    optionAnchor: 'resolveDebugEchoMessage',
  },
}

type OptionOwner = { owner: string; anchor: string; disposition?: 'retained-inert' }

const PROVIDER_OPTION_OWNERS: Record<string, OptionOwner> = {
  credentialId: { owner: 'src/ts/model/modelProfileResolver.ts', anchor: 'resolveProfileCredential' },
  requestModel: { owner: 'src/ts/model/modelProfileResolver.ts', anchor: 'resolveProfileRequestModelFromParts' },
  baseUrl: { owner: 'src/ts/model/modelProfileResolver.ts', anchor: 'resolveFirstClassProviderOptions' },
  extraHeaders: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'extraHeaders' },
  additionalParams: {
    owner: 'server/fastify/src/generation/additionalParams.ts',
    anchor: 'getProfileAdditionalParameters',
  },
  reverseProxy: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'reverseProxy' },
  openrouter: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'openrouter' },
  nanogpt: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'nanogpt' },
  llmGateway: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'llmGateway' },
  ollama: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'ollama' },
  vertex: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'vertex' },
  customApi: { owner: 'src/ts/model/modelProfileResolver.ts', anchor: 'customApi' },
}

const RUNTIME_OPTION_OWNERS: Record<string, OptionOwner> = {
  maxContext: { owner: 'server/fastify/src/prompt/budgetFinalize.ts', anchor: 'maxContextTokens' },
  maxResponse: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'const maxTokens' },
  temperature: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'parameters.temperature' },
  topP: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'parameters.topP' },
  topK: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'parameters.topK' },
  minP: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'parameters.minP' },
  topA: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'parameters.topA' },
  repetitionPenalty: {
    owner: 'server/fastify/src/prompt/chatDispatch.ts',
    anchor: 'parameters.repetitionPenalty',
  },
  frequencyPenalty: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'parameters.frequencyPenalty' },
  presencePenalty: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'parameters.presencePenalty' },
  reasoningEffort: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'parameters.reasoningEffort' },
  thinkingTokens: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'parameters.thinkingTokens' },
  verbosity: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'parameters.verbosity' },
  genTime: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'db.genTime' },
  thinkingType: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'db.thinkingType' },
  deepseekThinkingType: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'db.deepseekThinkingType' },
  adaptiveThinkingEffort: {
    owner: 'server/fastify/src/prompt/chatDispatch.ts',
    anchor: 'db.adaptiveThinkingEffort',
  },
  deepseekReasoningEffort: {
    owner: 'server/fastify/src/prompt/chatDispatch.ts',
    anchor: 'db.deepseekReasoningEffort',
  },
  extractJson: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'db.extractJson' },
  jsonSchema: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'db.jsonSchema' },
  customTokenizer: { owner: 'server/fastify/src/prompt/tokenizerConfig.ts', anchor: 'db.customTokenizer' },
  halfStreaming: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'db.halfStreaming' },
  useStreaming: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'db.useStreaming' },
  jsonSchemaEnabled: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'db.jsonSchemaEnabled' },
  strictJsonSchema: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'db.strictJsonSchema' },
  outputImageModal: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'db.outputImageModal' },
  enableCustomFlags: { owner: 'src/ts/model/modelProfileResolver.ts', anchor: 'enableCustomFlags' },
  stripCoT: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'profile.runtimeOptions.stripCoT' },
  dynamicOutput: {
    owner: 'server/fastify/src/prompt/effectiveGenerationConfig.ts',
    anchor: "assignIfDefined(database, 'dynamicOutput'",
    disposition: 'retained-inert',
  },
  modelTools: { owner: 'server/fastify/src/prompt/chatDispatch.ts', anchor: 'runtimeOptions.modelTools' },
  customFlags: { owner: 'src/ts/model/modelProfileResolver.ts', anchor: 'customFlags' },
}

type OperationOwner = { production: string; assurance: string }

const PROVIDER_OPERATION_OWNERS: Record<string, OperationOwner> = Object.fromEntries(
  PROVIDER_OPERATIONS.map((operation) => [
    operation,
    {
      production: 'server/fastify/src/providerOperations.ts',
      assurance: 'server/fastify/__tests__/providerOperations.test.ts',
    },
  ]),
)

const RAW_TRANSLATOR_OWNERS: Record<string, OperationOwner> = {
  google: {
    production: 'server/fastify/src/translation/rawMessageTranslation.ts',
    assurance: 'server/fastify/__tests__/rawMessageTranslation.test.ts',
  },
  deepl: {
    production: 'server/fastify/src/translation/rawMessageTranslation.ts',
    assurance: 'server/fastify/__tests__/rawMessageTranslation.test.ts',
  },
  deeplX: {
    production: 'server/fastify/src/translation/rawMessageTranslation.ts',
    assurance: 'server/fastify/__tests__/rawMessageTranslation.test.ts',
  },
  llm: {
    production: 'server/fastify/src/translation/rawMessageTranslation.ts',
    assurance: 'server/fastify/__tests__/rawMessageTranslation.test.ts',
  },
}

const TRANSLATION_LIFECYCLE_OWNERS = {
  browser_pipeline_and_cache: {
    production: 'src/ts/translator/translator.ts',
    anchor: 'translateLLM',
    assurance: 'src/ts/translator/translator.cache.svelte-node.test.ts',
  },
  message_job: {
    production: 'server/fastify/src/translation/serverMessageTranslation.ts',
    anchor: 'runServerMessageTranslation',
    assurance: 'server/fastify/__tests__/serverMessageTranslation.test.ts',
  },
  greeting_job: {
    production: 'server/fastify/src/translation/serverGreetingTranslation.ts',
    anchor: 'runServerGreetingTranslation',
    assurance: 'server/fastify/__tests__/greetingTranslationStore.test.ts',
  },
  generation_completion: {
    production: 'server/fastify/src/translation/generationCompletionTranslation.ts',
    anchor: 'handleGeneratedChatCompletion',
    assurance: 'server/fastify/__tests__/generationChatCompletionTranslation.test.ts',
  },
  draft_and_btw_hooks: {
    production: 'src/ts/process/inputHooks.ts',
    anchor: 'runInputHook',
    assurance: 'src/ts/process/inputHooks.test.ts',
  },
} as const

const IMAGE_OPERATION_OWNERS: Record<string, OperationOwner> = Object.fromEntries(
  SERVER_IMAGE_GENERATION_PROVIDERS.map((provider) => [
    provider,
    {
      production: 'server/fastify/src/imageGeneration.ts',
      assurance: 'server/fastify/__tests__/imageGeneration.test.ts',
    },
  ]),
)

const TTS_OPERATION_OWNERS: Record<string, OperationOwner> = Object.fromEntries(
  TTS_SYNTHESIS_OPERATIONS.map((operation) => [
    operation,
    {
      production: 'server/fastify/src/tts.ts',
      assurance: 'server/fastify/__tests__/tts.test.ts',
    },
  ]),
)

const TRANSCRIPTION_OWNER = {
  browser: 'src/ts/server/openAITranscription.ts',
  production: 'server/fastify/src/openAITranscription.ts',
  route: 'server/fastify/src/routes/openAITranscription.ts',
  assurance: 'server/fastify/__tests__/openAITranscription.test.ts',
} as const

describe('Phase 7 compatibility structure', () => {
  it('classifies every retained model format and every admitted text adapter', () => {
    const formats = Object.values(LLMFormat)
    expect(
      Object.keys(LLM_FORMAT_POLICY)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([...formats].sort((a, b) => a - b))

    for (const format of formats) {
      const policy = LLM_FORMAT_POLICY[format]
      expect(formatToServerProvider(format), `LLMFormat ${format}`).toBe(policy.provider)
      if (policy.provider === null) expect(policy.retention).toBe('browser-only')
      else expect(TEXT_ADAPTER_OWNERS, policy.provider).toHaveProperty(policy.provider)
    }

    const legacyRouteSource = readRepoFile('server/fastify/src/routes/generation.ts')
    expect(Object.keys(TEXT_ADAPTER_OWNERS).sort()).toEqual(
      setStringLiteralValues(legacyRouteSource, 'SUPPORTED_PROVIDERS').sort(),
    )
    const dispatchSource = readRepoFile('server/fastify/src/prompt/chatDispatch.ts')
    for (const [provider, owner] of Object.entries(TEXT_ADAPTER_OWNERS)) {
      const adapterSource = readRepoFile(owner.adapter)
      expect(adapterSource, `${provider} endpoint/credential resolver`).toContain(owner.resolver)
      expect(adapterSource, `${provider} adapter runner`).toContain(owner.runner)
      expect(dispatchSource, `${provider} option dispatch`).toContain(owner.dispatchAnchor)
      expect(readRepoFile(owner.assurance), `${provider} behavioral assurance`).toContain('describe(')
    }
  })

  it('pins every first-class profile provider to endpoint, credential, option, and dispatch owners', () => {
    expect(Object.keys(FIRST_CLASS_PROVIDER_POLICY).sort()).toEqual([...FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS].sort())
    const resolverSource = readRepoFile('src/ts/model/modelProfileResolver.ts')
    const dispatchSource = readRepoFile('server/fastify/src/prompt/chatDispatch.ts')

    for (const [provider, policy] of Object.entries(FIRST_CLASS_PROVIDER_POLICY)) {
      expect(resolverSource, `${provider} endpoint/credential owner`).toContain(policy.endpointCredentialAnchor)
      expect(
        resolverSource.includes(policy.optionAnchor) || dispatchSource.includes(policy.optionAnchor),
        `${provider} provider option owner`,
      ).toBe(true)
      for (const target of policy.dispatchTargets)
        expect(TEXT_ADAPTER_OWNERS, `${provider} -> ${target}`).toHaveProperty(target)
    }
  })

  it('classifies every profile provider option and runtime option', () => {
    const recordsSource = readRepoFile('src/ts/model/modelProfileRecords.ts')
    expect(Object.keys(PROVIDER_OPTION_OWNERS).sort()).toEqual(
      interfacePropertyNames(recordsSource, 'ModelProfileRecordProviderOptions').sort(),
    )
    expect(Object.keys(RUNTIME_OPTION_OWNERS).sort()).toEqual(
      interfacePropertyNames(recordsSource, 'ModelProfileRecordRuntimeOptions').sort(),
    )

    const materializationSource = readRepoFile('server/fastify/src/prompt/effectiveGenerationConfig.ts')
    for (const [option, owner] of Object.entries(RUNTIME_OPTION_OWNERS)) {
      if (option === 'stripCoT') {
        // Strip CoT deliberately stays on the resolved profile and is consumed
        // directly so no unrelated flat settings layer can override it.
        expect(materializationSource, `${option} must remain profile-direct`).not.toContain(option)
      } else {
        expect(materializationSource, `${option} profile materialization`).toContain(option)
      }
      expect(readRepoFile(owner.owner), `${option} consumer`).toContain(owner.anchor)
    }
    expect(
      Object.entries(RUNTIME_OPTION_OWNERS)
        .filter(([, owner]) => owner.disposition === 'retained-inert')
        .map(([option]) => option),
    ).toEqual(['dynamicOutput'])

    for (const [option, owner] of Object.entries(PROVIDER_OPTION_OWNERS)) {
      expect(readRepoFile(owner.owner), `${option} provider option consumer`).toContain(owner.anchor)
    }
  })

  it('keeps every fixed provider operation tied to production and request-capture assurance', () => {
    expect(Object.keys(PROVIDER_OPERATION_OWNERS).sort()).toEqual([...PROVIDER_OPERATIONS].sort())
    for (const operation of PROVIDER_OPERATIONS) {
      const owner = PROVIDER_OPERATION_OWNERS[operation]
      expect(readRepoFile(owner.production), `${operation} production owner`).toContain(`'${operation}'`)
      expect(readRepoFile(owner.assurance), `${operation} request capture`).toContain(`'${operation}'`)
    }
  })

  it('classifies translation dispatch and every detached/browser lifecycle owner', () => {
    const rawSource = readRepoFile('server/fastify/src/translation/rawMessageTranslation.ts')
    expect(Object.keys(RAW_TRANSLATOR_OWNERS).sort()).toEqual(
      typeAliasStringUnion(rawSource, 'RawMessageTranslatorType').sort(),
    )
    for (const [translator, owner] of Object.entries(RAW_TRANSLATOR_OWNERS)) {
      expect(readRepoFile(owner.production), `${translator} translation dispatch`).toContain(`'${translator}'`)
      expect(readRepoFile(owner.assurance), `${translator} translation assurance`).toContain(`'${translator}'`)
    }
    for (const [lifecycle, owner] of Object.entries(TRANSLATION_LIFECYCLE_OWNERS)) {
      expect(readRepoFile(owner.production), `${lifecycle} production owner`).toContain(owner.anchor)
      expect(readRepoFile(owner.assurance), `${lifecycle} behavioral assurance`).toContain('describe(')
    }
  })

  it('keeps every image, TTS, and transcription operation tied to a bounded server owner', () => {
    expect(Object.keys(IMAGE_OPERATION_OWNERS).sort()).toEqual([...SERVER_IMAGE_GENERATION_PROVIDERS].sort())
    for (const provider of SERVER_IMAGE_GENERATION_PROVIDERS) {
      const owner = IMAGE_OPERATION_OWNERS[provider]
      expect(readRepoFile(owner.production), `${provider} image dispatch`).toContain(`case '${provider}'`)
      expect(readRepoFile(owner.assurance), `${provider} image assurance`).toContain(`'${provider}'`)
    }

    expect(Object.keys(TTS_OPERATION_OWNERS).sort()).toEqual([...TTS_SYNTHESIS_OPERATIONS].sort())
    for (const operation of TTS_SYNTHESIS_OPERATIONS) {
      const owner = TTS_OPERATION_OWNERS[operation]
      expect(readRepoFile(owner.production), `${operation} TTS dispatch`).toContain(`case '${operation}'`)
      expect(readRepoFile(owner.assurance), `${operation} TTS assurance`).toContain(`'${operation}'`)
    }

    expect(readRepoFile(TRANSCRIPTION_OWNER.browser)).toContain('requestOpenAITranscription')
    expect(readRepoFile(TRANSCRIPTION_OWNER.production)).toContain('executeOpenAITranscription')
    expect(readRepoFile(TRANSCRIPTION_OWNER.route)).toContain('/api/v1/media/openai/transcriptions')
    expect(readRepoFile(TRANSCRIPTION_OWNER.assurance)).toContain('fixed Whisper VTT request')
  })
})

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

function parseSource(source: string): ts.SourceFile {
  return ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function setStringLiteralValues(source: string, variableName: string): string[] {
  const parsed = parseSource(source)
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== variableName) continue
      const initializer = declaration.initializer
      expect(initializer && ts.isNewExpression(initializer), variableName).toBe(true)
      const argument = (initializer as ts.NewExpression).arguments?.[0]
      expect(argument && ts.isArrayLiteralExpression(argument), `${variableName} values`).toBe(true)
      return (argument as ts.ArrayLiteralExpression).elements.map((element) => {
        expect(ts.isStringLiteral(element), element.getText()).toBe(true)
        return (element as ts.StringLiteral).text
      })
    }
  }
  throw new Error(`Missing Set declaration ${variableName}`)
}

function interfacePropertyNames(source: string, interfaceName: string): string[] {
  const declaration = parseSource(source).statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName,
  )
  expect(declaration, interfaceName).toBeDefined()
  return declaration!.members.flatMap((member) => {
    if (!ts.isPropertySignature(member) || member.name === undefined) return []
    return ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? [member.name.text] : []
  })
}

function typeAliasStringUnion(source: string, typeName: string): string[] {
  const declaration = parseSource(source).statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName,
  )
  expect(declaration, typeName).toBeDefined()
  const members = ts.isUnionTypeNode(declaration!.type) ? declaration!.type.types : [declaration!.type]
  return members.map((member) => {
    expect(ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal), member.getText()).toBe(true)
    return (member as ts.LiteralTypeNode & { literal: ts.StringLiteral }).literal.text
  })
}
