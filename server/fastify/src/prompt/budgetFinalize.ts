import type { Database } from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { tokenizeChat } from './tokens.js'
import { tokenizerOptionsFromDb } from './tokenizerConfig.js'

/**
 * Phase 7-8c request budget finalization ported from the SPA's
 * `src/ts/process/promptBudget/finalizeRequestBudget.ts`.
 *
 * Operates on an already-flattened `OpenAIChat[]` (the render-final
 * walker lands in 7-11a). Re-tokenizes the whole array, trims
 * `removable` rows front-to-back until the request fits under
 * `maxContextTokens`, drops the now-empty rows (keeping
 * multimodal-only rows), and clamps the response budget.
 *
 * `finalizeRequestBudget` re-tokenizes from scratch; it does **not**
 * consume `preflightTemplateTokens`' output. Preflight feeds the
 * memory-window budget (Phase 8); finalize is the independent final
 * re-check the SPA runs at `index.svelte.ts:329` right before
 * dispatch.
 *
 * The `removable` flag is set upstream (the SPA marks non-memory
 * history rows `removable: true` in `buildMemoryWindow.ts:147`); this
 * slice only honors it. Non-removable rows are pinned and can force
 * an `overflow` result.
 *
 * Divergence from the SPA: the server's `tokenizeChat` is text-only
 * (7-8a deferred multimodal image-token math), so multimodal rows
 * contribute only their content + overhead here. The multimodal-only
 * survival filter still applies. Exact image-token accounting lands
 * only when a fixture forces it (ROADMAP 2026-05-23 scope
 * re-verification).
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

export function finalizeRequestBudget(
  input: FinalizeRequestBudgetInput,
): FinalizeRequestBudgetResult {
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
