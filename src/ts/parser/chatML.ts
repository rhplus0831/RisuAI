import { risuChatParser } from './parser.svelte'
import { parseChatMLRows } from '@risuai/shared-core/chatml-rows'

export function parseChatML(data: string): OpenAIChat[] | null {
  return parseChatMLRows(data, risuChatParser)
}
