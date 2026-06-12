import { mutateChatWithScopedCommand } from '../../chatCommands'
import { parseChatML } from '../../parser/chatML'
import { requestChatData } from '../request/request'
import { risuChatParser } from '../scripts'

export interface EvaluateIgpOptions {
  promptTemplate: string
  abortSignal: AbortSignal
  selectedChar: number
  selectedChat: number
}

function formatIgpAppendPayload(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'result' in value) {
    return formatIgpAppendPayload((value as { result?: unknown }).result)
  }
  if (value === null || value === undefined) return ''
  try {
    const json = JSON.stringify(value)
    if (json !== undefined) return json
  } catch {
    // Fall through to String for non-serializable objects.
  }
  return String(value)
}

export async function evaluateIgp(opts: EvaluateIgpOptions): Promise<void> {
  const parsed = risuChatParser(opts.promptTemplate ?? '')
  if (!parsed) return
  const formated = parseChatML(parsed)
  const rq = await requestChatData({ formated, bias: {} }, 'emotion', opts.abortSignal)
  const appended = formatIgpAppendPayload(rq)
  mutateChatWithScopedCommand(
    (chat) => {
      const messages = chat.message
      const last = messages[messages.length - 1]
      if (!last) return
      last.data += appended
    },
    { selectedChar: opts.selectedChar, selectedChat: opts.selectedChat },
  )
}
