import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HORDE_DELETE_CLEANUP_TIMEOUT_MS, resolveHordeRequest, runHorde } from '../src/generation/horde.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('resolveHordeRequest', () => {
  it('returns null when prompt is missing', () => {
    expect(
      resolveHordeRequest({
        model: 'koboldcpp/Mistral',
        signal: new AbortController().signal,
      }),
    ).toBeNull()
  })

  it('returns null when model is missing', () => {
    expect(
      resolveHordeRequest({
        prompt: 'hi',
        signal: new AbortController().signal,
      }),
    ).toBeNull()
  })

  it('defaults apiKey to the anonymous "0000000000" string', () => {
    const r = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      signal: new AbortController().signal,
    })
    expect(r?.apiKey).toBe('0000000000')
  })

  it('keeps a non-empty apiKey verbatim', () => {
    const r = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      apiKey: 'my-key',
      signal: new AbortController().signal,
    })
    expect(r?.apiKey).toBe('my-key')
  })

  it('keeps active sampler fields verbatim', () => {
    const r = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      temperature: 0.8,
      topK: 40,
      topP: 0.9,
      signal: new AbortController().signal,
    })
    expect(r?.temperature).toBe(0.8)
    expect(r?.topK).toBe(40)
    expect(r?.topP).toBe(0.9)
  })
})

describe('runHorde', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('submits the async job, polls until done, and returns generations[0].text', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let pollCount = 0
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.endsWith('/generate/text/async')) {
        return jsonResp({ id: 'job-1' }, 202)
      }
      if (url.endsWith('/generate/text/status/job-1')) {
        pollCount++
        if (pollCount < 2) return jsonResp({ done: false })
        return jsonResp({
          done: true,
          generations: [{ text: 'horde says hello' }],
        })
      }
      throw new Error('unexpected url: ' + url)
    })

    const resolved = resolveHordeRequest({
      prompt: 'hi',
      model: 'koboldcpp/Mistral-7B',
      apiKey: 'k',
      maxTokens: 256,
      maxContextLength: 4100,
      temperature: 0.7,
      topK: 40,
      topP: 0.9,
      pollIntervalMs: 1000,
      signal: new AbortController().signal,
    })!
    const p = runHorde(resolved)
    // Advance the fake timers past the polling sleep.
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    const r = await p
    expect(r).toEqual({ type: 'success', result: 'horde says hello', apiMetadata: { jobId: 'job-1' } })

    // First call is the async submit; subsequent are status polls.
    expect(calls[0].url).toBe('https://stablehorde.net/api/v2/generate/text/async')
    const submitted = JSON.parse(calls[0].init!.body as string)
    expect(submitted.prompt).toBe('hi')
    expect(submitted.params).toMatchObject({
      n: 1,
      max_length: 256,
      max_context_length: 4100,
      temperature: 0.7,
      top_k: 40,
      top_p: 0.9,
    })
    expect(submitted.models).toEqual([
      'koboldcpp/Mistral-7B',
      'koboldcpp/Mistral-7B',
      ' koboldcpp/Mistral-7B',
      'koboldcpp/Mistral-7B ',
    ])
  })

  it('omits the models array when model === "auto"', async () => {
    let captured: { init?: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/async')) {
        captured = { init }
        return jsonResp({ id: 'job-auto' }, 202)
      }
      return jsonResp({ done: true, generations: [{ text: 'x' }] })
    })

    const resolved = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      pollIntervalMs: 1,
      signal: new AbortController().signal,
    })!
    const p = runHorde(resolved)
    await vi.advanceTimersByTimeAsync(5)
    await p
    const sent = JSON.parse(captured!.init!.body as string)
    expect(sent.models).toBeUndefined()
  })

  it('omits absent sampler fields from the async payload', async () => {
    let captured: { init?: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/async')) {
        captured = { init }
        return jsonResp({ id: 'job-omitted' }, 202)
      }
      return jsonResp({ done: true, generations: [{ text: 'x' }] })
    })

    const resolved = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      pollIntervalMs: 1,
      signal: new AbortController().signal,
    })!
    const p = runHorde(resolved)
    await vi.advanceTimersByTimeAsync(5)
    await p
    const sent = JSON.parse(captured!.init!.body as string)
    expect(sent.params.temperature).toBeUndefined()
    expect(sent.params.top_k).toBeUndefined()
    expect(sent.params.top_p).toBeUndefined()
    expect(sent.params.logit_bias).toBeUndefined()
    expect(sent.params.biases).toBeUndefined()
  })

  it('returns fail when async submit returns non-202', async () => {
    vi.stubGlobal('fetch', async () => new Response('rate limited', { status: 429 }))
    const resolved = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      signal: new AbortController().signal,
    })!
    expect(await runHorde(resolved)).toEqual({ type: 'fail', result: 'rate limited' })
  })

  it('returns fail when async response is missing job id', async () => {
    vi.stubGlobal('fetch', async () => jsonResp({}, 202))
    const resolved = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      signal: new AbortController().signal,
    })!
    expect(await runHorde(resolved)).toEqual({
      type: 'fail',
      result: 'horde async response missing job id',
    })
  })

  it('returns fail and fires DELETE when is_possible: false', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/async')) return jsonResp({ id: 'job-x' }, 202)
      if (init?.method === 'DELETE') return jsonResp({})
      return jsonResp({ is_possible: false, done: false })
    })

    const resolved = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      pollIntervalMs: 1,
      signal: new AbortController().signal,
    })!
    const p = runHorde(resolved)
    await vi.advanceTimersByTimeAsync(5)
    expect(await p).toEqual({
      type: 'fail',
      result: 'horde reports the job is not possible',
      nonRetryable: true,
    })
    expect(calls).toContain('DELETE https://stablehorde.net/api/v2/generate/text/status/job-x')
  })

  it('returns fail and fires DELETE when the job faults', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/async')) return jsonResp({ id: 'job-f' }, 202)
      if (init?.method === 'DELETE') return jsonResp({})
      return jsonResp({ done: false, faulted: true, message: 'worker exploded' })
    })

    const resolved = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      pollIntervalMs: 1,
      signal: new AbortController().signal,
    })!
    const p = runHorde(resolved)
    await vi.advanceTimersByTimeAsync(5)
    const r = await p
    expect(r).toEqual({ type: 'fail', result: 'horde job faulted: worker exploded' })
    expect(calls).toContain('DELETE https://stablehorde.net/api/v2/generate/text/status/job-f')
  })

  it('aborts mid-poll and fires DELETE when the signal aborts', async () => {
    const calls: string[] = []
    const c = new AbortController()
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/async')) return jsonResp({ id: 'job-a' }, 202)
      if (init?.method === 'DELETE') return jsonResp({})
      return jsonResp({ done: false })
    })

    const resolved = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      pollIntervalMs: 1000,
      signal: c.signal,
    })!
    const p = runHorde(resolved)
    // Let the async submit land.
    await vi.advanceTimersByTimeAsync(0)
    c.abort()
    // Drain pending promise resolutions.
    await vi.advanceTimersByTimeAsync(0)
    const r = await p
    expect(r).toEqual({ type: 'fail', result: 'aborted', aborted: true })
    expect(calls).toContain('DELETE https://stablehorde.net/api/v2/generate/text/status/job-a')
  })

  it('times out after the wall-clock deadline and fires DELETE', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/async')) return jsonResp({ id: 'job-t' }, 202)
      if (init?.method === 'DELETE') return jsonResp({})
      return jsonResp({ done: false })
    })

    const resolved = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      pollIntervalMs: 100,
      timeoutMs: 250,
      signal: new AbortController().signal,
    })!
    const p = runHorde(resolved)
    // Three poll cycles puts us at 300 ms, past the 250 ms deadline.
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(100)
    const r = await p
    expect(r).toEqual({ type: 'fail', result: 'horde job timed out' })
    expect(calls).toContain('DELETE https://stablehorde.net/api/v2/generate/text/status/job-t')
  })

  it('L4: bounds a hung cleanup DELETE with its own abort signal', async () => {
    const deleteSignals: AbortSignal[] = []
    let deleteAborted: Promise<void> = Promise.resolve()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), ms)
      timeout.unref?.()
      return controller.signal
    })

    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/async')) return jsonResp({ id: 'job-hung-delete' }, 202)
      if (init?.method === 'DELETE' && init.signal instanceof AbortSignal) {
        const deleteSignal = init.signal
        deleteSignals.push(deleteSignal)
        deleteAborted = new Promise<void>((resolve) => {
          deleteSignal.addEventListener('abort', () => resolve(), { once: true })
        })
        return new Promise<Response>(() => {})
      }
      return jsonResp({ done: false })
    })

    const resolved = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      pollIntervalMs: 100,
      timeoutMs: 250,
      signal: new AbortController().signal,
    })!
    const p = runHorde(resolved)
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(100)

    expect(await p).toEqual({ type: 'fail', result: 'horde job timed out' })
    expect(timeoutSpy).toHaveBeenCalledWith(HORDE_DELETE_CLEANUP_TIMEOUT_MS)
    expect(deleteSignals).toHaveLength(1)
    const deleteSignal = deleteSignals[0]!
    expect(deleteSignal).toBeInstanceOf(AbortSignal)
    expect(deleteSignal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(HORDE_DELETE_CLEANUP_TIMEOUT_MS)
    await deleteAborted
    expect(deleteSignal.aborted).toBe(true)
  })

  it('returns aborted=true immediately when signal is pre-aborted', async () => {
    const c = new AbortController()
    c.abort()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return jsonResp({ id: 'x' }, 202)
    })
    const resolved = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      signal: c.signal,
    })!
    const r = await runHorde(resolved)
    expect(r.aborted).toBe(true)
    expect(called).toBe(false)
  })

  it('returns fail when done:true arrives with empty generations', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/async')) return jsonResp({ id: 'job-empty' }, 202)
      return jsonResp({ done: true, generations: [] })
    })
    const resolved = resolveHordeRequest({
      prompt: 'hi',
      model: 'auto',
      pollIntervalMs: 1,
      signal: new AbortController().signal,
    })!
    const p = runHorde(resolved)
    await vi.advanceTimersByTimeAsync(5)
    expect(await p).toEqual({
      type: 'fail',
      result: 'horde finished with no generations',
      nonRetryable: true,
    })
  })
})
