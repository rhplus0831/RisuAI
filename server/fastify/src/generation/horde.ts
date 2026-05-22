import type { CompletionResult } from './frames.js'

/**
 * Stable Horde text dispatcher. Mirrors the local SPA path at
 * `src/ts/process/request/request.ts:1418-1523`:
 *
 *   1. `POST /api/v2/generate/text/async` with the flattened prompt +
 *      sampler params → `{id, kudos?, message?}`. Returns 202 on accept.
 *   2. Poll `GET /api/v2/generate/text/status/<id>` every
 *      `pollIntervalMs` (default 2 s) until `done: true` or until the
 *      wall-clock `timeoutMs` (default 5 min) elapses.
 *   3. On abort, fire `DELETE /api/v2/generate/text/status/<id>` so the
 *      Horde worker stops the in-flight job.
 *
 * The client pre-flattens the prompt via the SPA's `applyChatTemplate`
 * (Jinja chat templates driven by `db.instructChatTemplate`) and ships
 * the resulting string in `options.horde.prompt`. The server keeps no
 * character / user context; the unstringlize step happens client-side
 * after the result lands. This matches the strategy laid out in
 * `docs/fastify/design/novelai-novellist-stringlize.md` (option B);
 * Phase 7 may move the flatten + unstringlize work server-side, at
 * which point the wire contract here can switch back to `messages`.
 *
 * Streaming is intentionally deferred: Horde's poll-loop wire isn't
 * incremental in any useful way (workers return either nothing or the
 * full generation), so per-poll `kind:'token'` frames would only emit
 * one chunk before `done`. The buffered envelope captures it cleanly.
 */

const HORDE_BASE_URL = 'https://stablehorde.net/api/v2'
const DEFAULT_POLL_INTERVAL_MS = 2000
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_ANON_KEY = '0000000000'

export interface HordeRequest {
  prompt: string
  model: string
  apiKey: string
  maxTokens?: number
  maxContextLength?: number
  temperature?: number
  topK?: number
  topP?: number
  /** Override poll interval for deterministic tests. Defaults to 2 s. */
  pollIntervalMs?: number
  /** Override wall-clock timeout. Defaults to 5 min. */
  timeoutMs?: number
  signal: AbortSignal
}

interface HordeResolveInput {
  prompt?: unknown
  model?: unknown
  apiKey?: unknown
  maxTokens?: unknown
  maxContextLength?: unknown
  temperature?: unknown
  topK?: unknown
  topP?: unknown
  pollIntervalMs?: unknown
  timeoutMs?: unknown
  signal: AbortSignal
}

export function resolveHordeRequest(input: HordeResolveInput): HordeRequest | null {
  if (typeof input.prompt !== 'string' || input.prompt.length === 0) return null
  if (typeof input.model !== 'string' || input.model.length === 0) return null
  const apiKey =
    typeof input.apiKey === 'string' && input.apiKey.length > 0 ? input.apiKey : DEFAULT_ANON_KEY
  const maxTokens =
    typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? input.maxTokens
      : undefined
  const maxContextLength =
    typeof input.maxContextLength === 'number' &&
    Number.isFinite(input.maxContextLength) &&
    input.maxContextLength > 0
      ? input.maxContextLength
      : undefined
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? input.temperature
      : undefined
  const topK =
    typeof input.topK === 'number' && Number.isFinite(input.topK) ? input.topK : undefined
  const topP =
    typeof input.topP === 'number' && Number.isFinite(input.topP) ? input.topP : undefined
  const pollIntervalMs =
    typeof input.pollIntervalMs === 'number' &&
    Number.isFinite(input.pollIntervalMs) &&
    input.pollIntervalMs > 0
      ? input.pollIntervalMs
      : undefined
  const timeoutMs =
    typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
      ? input.timeoutMs
      : undefined

  return {
    prompt: input.prompt,
    model: input.model,
    apiKey,
    maxTokens,
    maxContextLength,
    temperature,
    topK,
    topP,
    pollIntervalMs,
    timeoutMs,
    signal: input.signal,
  }
}

function buildAsyncPayload(req: HordeRequest): Record<string, unknown> {
  const params: Record<string, unknown> = { n: 1, singleline: false }
  if (req.maxContextLength !== undefined) params.max_context_length = req.maxContextLength
  if (req.maxTokens !== undefined) params.max_length = req.maxTokens
  if (req.temperature !== undefined) params.temperature = req.temperature
  if (req.topK !== undefined) params.top_k = req.topK
  if (req.topP !== undefined) params.top_p = req.topP

  const payload: Record<string, unknown> = {
    prompt: req.prompt,
    params,
    trusted_workers: false,
    workerslow_workers: true,
    _blacklist: false,
    dry_run: false,
  }
  if (req.model !== 'auto') {
    // Mirror the SPA quirk that adds whitespace variants to widen worker
    // matching: see request.ts:1453.
    payload.models = [req.model, req.model.trim(), ' ' + req.model, req.model + ' ']
  }
  return payload
}

interface AsyncResponse {
  id?: unknown
  kudos?: unknown
  message?: unknown
}

interface StatusResponse {
  done?: unknown
  is_possible?: unknown
  generations?: Array<{ text?: unknown }>
  faulted?: unknown
  message?: unknown
}

/**
 * Sleep until either `ms` elapses or `signal` aborts. Resolves on time-
 * out; rejects with `aborted` when the signal fires.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function fireDeleteJob(jobId: string, apiKey: string): void {
  // Fire-and-forget; we're already aborting or shutting down.
  fetch(`${HORDE_BASE_URL}/generate/text/status/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: { apikey: apiKey },
  }).catch(() => {
    // ignore; the worker may have already finished
  })
}

export async function runHorde(req: HordeRequest): Promise<CompletionResult> {
  if (req.signal.aborted) {
    return { type: 'fail', result: 'aborted', aborted: true }
  }

  const pollIntervalMs = req.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs

  // Step 1: submit the async job.
  let asyncResp: Response
  try {
    asyncResp = await fetch(`${HORDE_BASE_URL}/generate/text/async`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: req.apiKey },
      body: JSON.stringify(buildAsyncPayload(req)),
      signal: req.signal,
    })
  } catch (err) {
    if (req.signal.aborted) return { type: 'fail', result: 'aborted', aborted: true }
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `upstream fetch failed: ${msg}` }
  }

  // Horde returns 202 on accept. Anything else is an error worth
  // surfacing verbatim.
  if (asyncResp.status !== 202) {
    let raw = ''
    try {
      raw = await asyncResp.text()
    } catch {
      // ignore
    }
    return { type: 'fail', result: raw.length > 0 ? raw : `HTTP ${asyncResp.status}` }
  }

  let asyncBody: AsyncResponse
  try {
    asyncBody = (await asyncResp.json()) as AsyncResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `invalid async response JSON: ${msg}` }
  }
  if (typeof asyncBody.id !== 'string' || asyncBody.id.length === 0) {
    return { type: 'fail', result: 'horde async response missing job id' }
  }
  const jobId = asyncBody.id

  // Wire up abort → DELETE.
  let abortHandled = false
  const onAbort = (): void => {
    if (abortHandled) return
    abortHandled = true
    fireDeleteJob(jobId, req.apiKey)
  }
  if (req.signal.aborted) {
    onAbort()
    return { type: 'fail', result: 'aborted', aborted: true }
  }
  req.signal.addEventListener('abort', onAbort, { once: true })

  try {
    while (true) {
      if (req.signal.aborted) {
        return { type: 'fail', result: 'aborted', aborted: true }
      }
      if (Date.now() >= deadline) {
        fireDeleteJob(jobId, req.apiKey)
        return { type: 'fail', result: 'horde job timed out' }
      }
      try {
        await sleep(pollIntervalMs, req.signal)
      } catch {
        return { type: 'fail', result: 'aborted', aborted: true }
      }

      let statusResp: Response
      try {
        statusResp = await fetch(
          `${HORDE_BASE_URL}/generate/text/status/${encodeURIComponent(jobId)}`,
          { method: 'GET', headers: { apikey: req.apiKey }, signal: req.signal },
        )
      } catch (err) {
        if (req.signal.aborted) {
          return { type: 'fail', result: 'aborted', aborted: true }
        }
        const msg = err instanceof Error ? err.message : String(err)
        return { type: 'fail', result: `horde status poll failed: ${msg}` }
      }

      let body: StatusResponse
      try {
        body = (await statusResp.json()) as StatusResponse
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { type: 'fail', result: `invalid horde status JSON: ${msg}` }
      }

      if (body.is_possible === false) {
        fireDeleteJob(jobId, req.apiKey)
        return { type: 'fail', result: 'horde reports the job is not possible' }
      }
      if (body.faulted === true) {
        fireDeleteJob(jobId, req.apiKey)
        const msg = typeof body.message === 'string' ? body.message : 'unknown'
        return { type: 'fail', result: `horde job faulted: ${msg}` }
      }
      if (body.done === true) {
        const gens = Array.isArray(body.generations) ? body.generations : []
        const text = typeof gens[0]?.text === 'string' ? gens[0].text : ''
        if (text.length === 0) {
          return { type: 'fail', result: 'horde finished with no generations' }
        }
        return { type: 'success', result: text }
      }
    }
  } finally {
    req.signal.removeEventListener('abort', onAbort)
  }
}
