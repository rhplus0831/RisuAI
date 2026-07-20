import { parseChatML } from '../parser/chatML'
import { getDatabase, type InputHook } from '../storage/database.svelte'
import { requestChatData } from './request/request'

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export async function runInputHook(
  hook: InputHook,
  slots: { content: string; draft: string },
  abortSignal?: AbortSignal | null,
): Promise<string> {
  const promptWithSlots = hook.prompt
    .replaceAll('{{slot::content}}', slots.content)
    .replaceAll('{{slot::draft}}', slots.draft)
  const parsedPrompt = parseChatML(promptWithSlots)
  const hasSlotMarker = hook.prompt.includes('{{slot::content}}') || hook.prompt.includes('{{slot::draft}}')
  const formated: OpenAIChat[] =
    parsedPrompt ??
    (hasSlotMarker
      ? [
          {
            role: 'user',
            content: promptWithSlots,
          },
        ]
      : [
          {
            role: 'system',
            content: hook.prompt,
          },
          {
            role: 'user',
            content: slots.content,
          },
        ])
  const maxTokens = finiteNumber(getDatabase().translatorMaxResponse, 1000)
  const rq = await requestChatData(
    {
      formated,
      bias: {},
      useStreaming: false,
      noMultiGen: true,
      maxTokens,
    },
    'translate',
    abortSignal ?? null,
  )

  if (rq.type === 'fail') {
    throw new Error(rq.result)
  }
  if (rq.type === 'streaming' || rq.type === 'multiline') {
    throw new Error('Unexpected response type')
  }
  return rq.result.trim()
}
