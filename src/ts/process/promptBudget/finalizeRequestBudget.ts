import type { ChatTokenizer } from '../../tokenizer'
import type { OpenAIChat } from '../index.svelte'

export type FinalizeRequestBudgetResult =
  | {
      ok: true
      formated: OpenAIChat[]
      inputTokens: number
      outputTokens: number
    }
  | {
      ok: false
      reason: 'overflow'
      inputTokens: number
    }

export async function finalizeRequestBudget(
  formated: OpenAIChat[],
  maxContextTokens: number,
  maxResponse: number,
  tokenizer: ChatTokenizer,
): Promise<FinalizeRequestBudgetResult> {
  let inputTokens = 0
  for (const chat of formated) {
    inputTokens += await tokenizer.tokenizeChat(chat)
  }

  let trimmed = formated
  if (inputTokens > maxContextTokens) {
    let pointer = 0
    while (inputTokens > maxContextTokens) {
      if (pointer >= trimmed.length) {
        return { ok: false, reason: 'overflow', inputTokens }
      }
      if (trimmed[pointer].removable) {
        const tokensBeforeTrim = await tokenizer.tokenizeChat(trimmed[pointer])
        trimmed[pointer].content = ''
        const tokensAfterTrim = await tokenizer.tokenizeChat(trimmed[pointer])
        inputTokens -= tokensBeforeTrim - tokensAfterTrim
      }
      pointer++
    }
    trimmed = trimmed.filter((v) => {
      return v.content !== '' || (v.multimodals && v.multimodals.length > 0)
    })
  }

  let outputTokens = maxResponse
  if (inputTokens + outputTokens > maxContextTokens) {
    outputTokens = maxContextTokens - inputTokens
  }

  return { ok: true, formated: trimmed, inputTokens, outputTokens }
}
