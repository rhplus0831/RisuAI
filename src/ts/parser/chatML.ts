import { risuChatParser } from './parser.svelte'
import { parseChatMLRows } from './chatMLCore'

export function parseChatML(data: string): OpenAIChat[] | null {
  return parseChatMLRows(data, risuChatParser)
}
