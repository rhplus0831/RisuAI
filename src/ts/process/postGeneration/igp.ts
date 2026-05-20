import { DBState } from '../../stores.svelte'
import { parseChatML } from '../../parser/chatML'
import { requestChatData } from '../request/request'
import { risuChatParser } from '../scripts'

export interface EvaluateIgpOptions {
  promptTemplate: string
  abortSignal: AbortSignal
  selectedChar: number
  selectedChat: number
}

export async function evaluateIgp(opts: EvaluateIgpOptions): Promise<void> {
  const parsed = risuChatParser(opts.promptTemplate ?? '')
  if (!parsed) return
  const formated = parseChatML(parsed)
  const rq = await requestChatData(
    { formated, bias: {} },
    'emotion',
    opts.abortSignal,
  )
  const messages =
    DBState.db.characters[opts.selectedChar].chats[opts.selectedChat].message
  // Behavior preserved verbatim from sendChat: the upstream code appended the
  // full `requestDataResponse` object, which coerces to "[object Object]". A
  // fix (e.g. `+= rq.result`) belongs in its own slice.
  messages[messages.length - 1].data += rq as unknown as string
}
