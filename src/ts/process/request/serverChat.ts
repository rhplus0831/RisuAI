/**
 * Phase 7-12a: browser client adapter for `POST /api/v1/generate/chat`.
 *
 * Mirrors the Phase 6 `serverCompletion.ts` precedent: POST an intent body,
 * authenticate with the `risu-auth` header, and stream-parse the SSE
 * response. Unlike `/completion` (which dispatches an already-assembled
 * prompt to a provider), `/chat` performs server-side prompt *assembly* and
 * streams back the assembled `prompt` payload plus `info` telemetry.
 *
 * This adapter consumes `stage` / `prompt` / `info` / `error` / `done` and
 * tolerates (ignores) the dispatch-coupled `token` / `message_patch` /
 * `side_effect` / `warning` events until the 7-12d send-path dispatch
 * cluster lands. It is wired for read-only preview paths behind
 * `db.useServerPromptAssembly`; send/continue/regenerate still run locally.
 * The `prompt` event now carries the full `formated` rows and `biases`
 * additively (7-12b), so previews can use the server payload directly.
 */

import { getNodeServerProxyAuth } from '../../storage/nodeStorage'
import { iterateSseEvents } from './sseParse'
import type { InfoEvent, PromptEvent } from './serverChatEvents'

const CHAT_ENDPOINT = '/api/v1/generate/chat'

/** The request body the `/chat` route expects (mirrors server `AssembleInput`). */
export interface ServerChatInput {
  chatId: string
  characterId: string
  mode: 'send' | 'continue' | 'preview' | 'preview_prompt' | 'regenerate'
  userMessage?: string
  regenerateMessageId?: string
  presetId?: string
  loadoutId?: string
  resetMessages?: boolean
  expectedRevision?: number
  inlayAssets?: unknown[]
}

/** The assembled prompt payload, parsed from the `prompt` SSE event. */
export type ServerChatPrompt = Omit<PromptEvent, 'type'>

/** Telemetry parsed from the `info` SSE event (7-11i). */
export type ServerChatInfo = Omit<InfoEvent, 'type'>

export type ServerChatResult =
  | { status: 'ok'; prompt: ServerChatPrompt; info?: ServerChatInfo }
  | { status: 'error'; error: string }
  | { status: 'aborted' }

function parseData(data: string): Record<string, unknown> | null {
  try {
    return JSON.parse(data) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Call the `/chat` route and resolve the assembled prompt. The terminal
 * `done` event (or stream end) closes a successful run; an `error` event is
 * terminal and surfaces its message; an abort resolves as `aborted`.
 */
export async function requestServerChat(
  input: ServerChatInput,
  signal: AbortSignal | null,
): Promise<ServerChatResult> {
  const auth = await getNodeServerProxyAuth()

  let response: Response
  try {
    response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'risu-auth': auth,
      },
      body: JSON.stringify(input),
      signal: signal ?? undefined,
    })
  } catch (err) {
    if (signal?.aborted) return { status: 'aborted' }
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${msg}` }
  }

  // Body validation failures (bad mode, missing chatId) are a pre-stream 400
  // with a JSON `{ error }` body — the route only opens the SSE stream after
  // validation passes.
  if (!response.ok) {
    let reason = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: unknown; reason?: unknown }
      if (typeof body?.error === 'string') reason = body.error
      else if (typeof body?.reason === 'string') reason = body.reason
    } catch {
      // ignore parse failure
    }
    return { status: 'error', error: reason }
  }

  if (!response.body) {
    return { status: 'error', error: 'No streaming body returned' }
  }

  let prompt: ServerChatPrompt | null = null
  let info: ServerChatInfo | undefined
  let error: string | null = null
  let done = false

  // The SSE event *name* (`frame.event`) is the discriminator; the `data:`
  // payload carries the remaining fields with `type` stripped (see the
  // server's `writePromptChatEvent`).
  for await (const frame of iterateSseEvents(response.body, signal)) {
    const data = parseData(frame.data)
    if (!data) continue
    switch (frame.event) {
      case 'prompt':
        prompt = data as unknown as ServerChatPrompt
        break
      case 'info':
        info = data as unknown as ServerChatInfo
        break
      case 'error':
        error = typeof data.error === 'string' ? data.error : 'prompt assembly failed'
        done = true
        break
      case 'done':
        done = true
        break
      // stage + dispatch-coupled events (token / message_patch / side_effect /
      // warning) are ignored in the read-only 7-12a path.
      default:
        break
    }
    if (done) break
  }

  if (signal?.aborted) return { status: 'aborted' }
  if (error !== null) return { status: 'error', error }
  if (!prompt) {
    return { status: 'error', error: 'stream ended without a prompt event' }
  }
  return { status: 'ok', prompt, info }
}
