import type { Database } from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { tokenizeChat } from './tokens.js'
import { tokenizerOptionsFromDb } from './tokenizerConfig.js'

/**
 * Request budget finalization ported from the SPA's
 * `finalizeRequestBudget.ts`. Re-tokenizes the flattened `OpenAIChat[]`, trims
 * `removable` rows front-to-back until the request fits under `maxContextTokens`,
 * drops now-empty rows while keeping multimodal-only rows, and clamps the response
 * budget.
 *
 * `finalizeRequestBudget` re-tokenizes from scratch; it does **not**
 * consume `preflightTemplateTokens`' output. Finalize is the independent final
 * re-check the SPA runs right before dispatch.
 *
 * The `removable` flag is set upstream (the SPA marks non-memory
 * history rows `removable: true` in `buildMemoryWindow.ts`). Non-removable
 * rows are pinned and can force an `overflow` result.
 *
 * `tokenizeChat` includes the baseline's per-attachment multimodal charge. The
 * multimodal-only survival filter still applies after a removable row's text is
 * blanked, matching the baseline final re-check.
 */

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

export interface FinalizeRequestBudgetInput {
  /** Read for `db.aiModel` → tokenizer config; finalize never expands variables. */
  db: Database
  formated: OpenAIChat[]
  maxContextTokens: number
  maxResponse: number
}

export function finalizeRequestBudget(input: FinalizeRequestBudgetInput): FinalizeRequestBudgetResult {
  const { db, formated, maxContextTokens, maxResponse } = input
  const { encoding, options } = tokenizerOptionsFromDb(db)

  let inputTokens = 0
  for (const chat of formated) {
    inputTokens += tokenizeChat(chat, encoding, options)
  }

  let trimmed = formated
  if (inputTokens > maxContextTokens) {
    let pointer = 0
    while (inputTokens > maxContextTokens) {
      if (pointer >= trimmed.length) {
        return { ok: false, reason: 'overflow', inputTokens }
      }
      if (trimmed[pointer].removable) {
        inputTokens -= tokenizeChat(trimmed[pointer], encoding, options)
        trimmed[pointer].content = ''
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
