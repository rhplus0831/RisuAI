import { isFastifyServer } from '../platform'
import { getNodeServerProxyAuth } from '../storage/nodeStorage'
import { iterateSseEvents } from '../process/request/sseParse'
import type { CommandEvent } from './commands'

const EVENTS_ENDPOINT = '/api/v1/events'

export type ServerCommandEventHandler = (event: CommandEvent) => void

export interface SubscribeServerCommandEventsInput {
  onCommandEvent: ServerCommandEventHandler
  onError?: (error: string) => void
  signal?: AbortSignal | null
}

export type ServerCommandEventSubscriptionResult =
  | { status: 'ok'; unsubscribe: () => void }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export function canUseServerEvents(): boolean {
  return isFastifyServer
}

export async function subscribeServerCommandEvents(
  input: SubscribeServerCommandEventsInput,
): Promise<ServerCommandEventSubscriptionResult> {
  if (!canUseServerEvents()) return { status: 'unavailable' }

  const controller = new AbortController()
  let stopped = false
  const stop = (): void => {
    stopped = true
    controller.abort()
  }

  if (input.signal) {
    if (input.signal.aborted) {
      stop()
    } else {
      input.signal.addEventListener('abort', stop, { once: true })
    }
  }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(EVENTS_ENDPOINT, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'risu-auth': auth,
      },
    })
  } catch (err) {
    if (input.signal) input.signal.removeEventListener('abort', stop)
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${message}` }
  }

  if (!response.ok) {
    if (input.signal) input.signal.removeEventListener('abort', stop)
    return { status: 'error', error: `HTTP ${response.status}` }
  }

  if (!response.body) {
    if (input.signal) input.signal.removeEventListener('abort', stop)
    return { status: 'error', error: 'Event stream response has no body' }
  }

  void (async () => {
    try {
      for await (const frame of iterateSseEvents(response.body!, controller.signal)) {
        if (stopped || frame.event !== 'command') continue
        const event = parseCommandEvent(frame.data)
        if (event) input.onCommandEvent(event)
      }
    } catch (err) {
      if (!stopped && !controller.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err)
        input.onError?.(`Event stream error: ${message}`)
      }
    } finally {
      if (input.signal) input.signal.removeEventListener('abort', stop)
    }
  })()

  return {
    status: 'ok',
    unsubscribe: stop,
  }
}

function parseCommandEvent(data: string): CommandEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  if (typeof record.type !== 'string') return null
  if (!Number.isInteger(record.revision) || (record.revision as number) < 0) return null
  if (typeof record.resource !== 'string') return null
  if (record.id !== undefined && typeof record.id !== 'string') return null
  if (record.parentId !== undefined && typeof record.parentId !== 'string') return null

  return {
    type: record.type,
    revision: record.revision as number,
    resource: record.resource,
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(typeof record.parentId === 'string' ? { parentId: record.parentId } : {}),
  }
}
