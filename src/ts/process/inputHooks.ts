import { parseChatML } from '../parser/chatML'
import type { InputHook } from '../storage/database.svelte'
import { encodeWithTokenizer } from '../tokenizer'
import {
  containsHistorySlot,
  createAsyncHistorySlotResolver,
  historySlotCounts,
  resolveHistorySlot,
  type HistorySlotContext,
  type HistorySlotResolver,
} from '../translator/historySlots'
import { requestChatData } from './request/request'

const INPUT_HOOK_SLOT_PATTERN = /{{slot::(content|draft)}}|{{slot::(history|historytrans)::([^}]*)}}/g

export interface InputHookHistoryContext extends HistorySlotContext {
  maxTokens: number
}

function inputHookProfileId(hook: InputHook): string | undefined {
  if (hook.model?.mode !== 'modelProfile' || typeof hook.model.profileId !== 'string') return undefined
  return hook.model.profileId.trim() || undefined
}

export async function runInputHook(
  hook: InputHook,
  slots: { content: string; draft: string },
  abortSignal?: AbortSignal | null,
  historyContext?: InputHookHistoryContext,
): Promise<string> {
  const hasHistorySlot = containsHistorySlot(hook.prompt)
  let historyResolver: HistorySlotResolver | undefined
  if (hasHistorySlot) {
    const counts = historySlotCounts(hook.prompt)
    historyResolver = historyContext
      ? await createAsyncHistorySlotResolver({
          context: historyContext,
          counts,
          maxTokens: historyContext.maxTokens,
          countTokens: async (text) => (await encodeWithTokenizer(text, 'cl100k_base')).length,
        })
      : undefined
  }
  const promptWithSlots = hook.prompt.replace(
    INPUT_HOOK_SLOT_PATTERN,
    (_match, simpleSlot: string | undefined, historySlot: string | undefined, rawCount: string | undefined) => {
      if (simpleSlot === 'content') return slots.content
      if (simpleSlot === 'draft') return slots.draft
      return resolveHistorySlot(historySlot ?? '', rawCount ?? '', historyResolver)
    },
  )
  const parsedPrompt = parseChatML(promptWithSlots)
  const hasSlotMarker =
    hook.prompt.includes('{{slot::content}}') || hook.prompt.includes('{{slot::draft}}') || hasHistorySlot
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
  const profileIdOverride = inputHookProfileId(hook)
  const rq = await requestChatData(
    {
      formated,
      bias: {},
      useStreaming: false,
      noMultiGen: true,
      ...(profileIdOverride ? { profileIdOverride } : {}),
    },
    'otherAx',
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
