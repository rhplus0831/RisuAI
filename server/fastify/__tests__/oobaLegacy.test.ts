import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveOobaLegacyRequest, runOobaLegacy } from '../src/generation/oobaLegacy.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('resolveOobaLegacyRequest', () => {
  it('returns null when baseUrl is missing', () => {
    expect(
      resolveOobaLegacyRequest({
        messages: [{ role: 'user', content: 'hi' }],
        baseUrl: '',
        signal: new AbortController().signal,
      }),
    ).toBeNull()
  })

  it('pins the retained legacy-instruct flattening', () => {
    // Accepted divergence (PR-18/PR-7 sunset): Ooba keeps this fixed flattening
    // instead of baseline `src/ts/process/templates/chatTemplate.ts` templates.
    const resolved = resolveOobaLegacyRequest({
      messages: [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'prior' },
      ],
      baseUrl: 'http://localhost:5000',
      signal: new AbortController().signal,
    })

    expect(resolved?.prompt).toBe('\n## Instruction\nrules\n## User\nhi\n## Assistant\nprior\n## Response\n')
  })
})

describe('runOobaLegacy', () => {
  it('normalizes the URL to /api/v1/generate and posts a flattened prompt', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({ results: [{ text: 'ooba ok' }] })
    })
    const resolved = resolveOobaLegacyRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5000/api/v1/blocking',
      maxTokens: 128,
      temperature: 0.5,
      signal: new AbortController().signal,
    })!
    const r = await runOobaLegacy(resolved)
    expect(r).toEqual({ type: 'success', result: 'ooba ok' })
    expect(captured!.url).toBe('http://localhost:5000/api/v1/generate')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.prompt).toBe('\n## User\nhi\n## Response\n')
    expect(sent.max_new_tokens).toBe(128)
    expect(sent.temperature).toBe(0.5)
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-API-KEY']).toBeUndefined()
  })

  it('normalizes only the path when the hostname contains api', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url
      return ok({ results: [{ text: 'ooba ok' }] })
    })
    const resolved = resolveOobaLegacyRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'https://api.example.com/v1',
      signal: new AbortController().signal,
    })!

    await runOobaLegacy(resolved)

    expect(capturedUrl).toBe('https://api.example.com/v1/api/v1/generate')
  })

  it('forwards X-API-KEY when apiKey is provided (Mancer-style)', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ results: [{ text: 'x' }] })
    })
    const resolved = resolveOobaLegacyRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://example.com/api',
      apiKey: 'mancer-key',
      signal: new AbortController().signal,
    })!
    await runOobaLegacy(resolved)
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-API-KEY']).toBe('mancer-key')
  })

  it('applies additional parameters after building the body and injects headers', async () => {
    let captured: RequestInit | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = init
      return ok({ results: [{ text: 'x' }] })
    })
    const resolved = resolveOobaLegacyRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5000',
      temperature: 0.5,
      additionalParams: [
        ['temperature', '0.15'],
        ['custom_flag', 'true'],
        ['header::X-Global-Trace', 'ooba'],
      ],
      signal: new AbortController().signal,
    })!

    await runOobaLegacy(resolved)

    expect(JSON.parse(captured!.body as string)).toMatchObject({ temperature: 0.15, custom_flag: true })
    expect((captured!.headers as Record<string, string>)['X-Global-Trace']).toBe('ooba')
  })

  it('forwards the retained Ooba sampler block instead of replacing it with hard-coded defaults', async () => {
    let captured: RequestInit | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = init
      return ok({ results: [{ text: 'x' }] })
    })
    const resolved = resolveOobaLegacyRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://example.com/api',
      doSample: false,
      seed: 42,
      topP: 0.81,
      topK: 73,
      typicalP: 0.92,
      repetitionPenalty: 1.17,
      encoderRepetitionPenalty: 1.03,
      minLength: 4,
      noRepeatNgramSize: 3,
      numBeams: 2,
      penaltyAlpha: 0.2,
      lengthPenalty: 1.1,
      topA: 0.08,
      tfs: 0.95,
      epsilonCutoff: 0.001,
      etaCutoff: 0.002,
      earlyStopping: true,
      addBosToken: false,
      banEosToken: true,
      skipSpecialTokens: false,
      stoppingStrings: ['STOP'],
      signal: new AbortController().signal,
    })!

    await runOobaLegacy(resolved)

    expect(JSON.parse(captured!.body as string)).toMatchObject({
      do_sample: false,
      seed: 42,
      top_p: 0.81,
      top_k: 73,
      typical_p: 0.92,
      repetition_penalty: 1.17,
      encoder_repetition_penalty: 1.03,
      min_length: 4,
      no_repeat_ngram_size: 3,
      num_beams: 2,
      penalty_alpha: 0.2,
      length_penalty: 1.1,
      top_a: 0.08,
      tfs: 0.95,
      epsilon_cutoff: 0.001,
      eta_cutoff: 0.002,
      early_stopping: true,
      add_bos_token: false,
      ban_eos_token: true,
      skip_special_tokens: false,
      stopping_strings: ['STOP'],
    })
  })

  it('returns fail with raw body on non-2xx', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }))
    const resolved = resolveOobaLegacyRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5000',
      signal: new AbortController().signal,
    })!
    expect((await runOobaLegacy(resolved)).result).toBe('nope')
  })

  it('returns aborted=true on pre-aborted signal', async () => {
    const c = new AbortController()
    c.abort()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return ok({ results: [{ text: 'x' }] })
    })
    const resolved = resolveOobaLegacyRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5000',
      signal: c.signal,
    })!
    expect((await runOobaLegacy(resolved)).aborted).toBe(true)
    expect(called).toBe(false)
  })
})
