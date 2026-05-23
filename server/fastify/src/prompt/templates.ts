import type {
  Database,
  character,
} from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import type { PromptItem } from '../../../../src/ts/process/prompt'

/**
 * Phase 7-10a template normalization + slot contract, ported from the
 * SPA's `src/ts/process/promptAssembly/{normalizeTemplate,
 * renderFinalPrompt}.ts`.
 *
 * This slice ports only the branch-free renderer foundation:
 *   - the canonical slot contract (`UnformatedPromptSlots`),
 *   - `normalizeTemplate` (utility-bot forced template + implicit
 *     `postEverything`),
 *   - `buildFormatOrder` (the null-template `formatingOrder` fallback),
 *   - `coalesceRows` (the shared empty-row filter + system-row
 *     coalescing helper that every later card branch reuses), and
 *   - `renderByFormatOrder` (the branch-free non-template walk).
 *
 * Deferred to later sub-slices (the per-card `switch` in
 * `renderFinalPrompt.ts`): content cards (7-10b), chat / systemized
 * cards (7-10c), memory / cache cards (7-10d), position / prompt-info
 * finalization (7-10e), and render finalization — the final trim,
 * `depth_prompt` splice, automatic cache-point walk-back, and
 * `runLuaEditTrigger('editRequest')` (7-10f). The assemble root that
 * fills these slots and applies `triggerResult.additonalSysPrompt` is
 * Tier 3 (7-11a/b).
 */

/**
 * Aggregated slot arrays the assembly root passes into the renderer.
 * Matches the SPA `renderFinalPrompt.ts:11-22` (`UnformatedPromptSlots`)
 * exactly. `preflight.ts` re-exports this as `PromptUnformatedSlots`.
 */
export interface UnformatedPromptSlots {
  main: OpenAIChat[]
  jailbreak: OpenAIChat[]
  chats: OpenAIChat[]
  lorebook: OpenAIChat[]
  globalNote: OpenAIChat[]
  authorNote: OpenAIChat[]
  lastChat: OpenAIChat[]
  description: OpenAIChat[]
  postEverything: OpenAIChat[]
  personaPrompt: OpenAIChat[]
}

export type FormatOrderKey = keyof UnformatedPromptSlots

export interface NormalizedTemplate {
  promptTemplate: PromptItem[] | null
  usingPromptTemplate: boolean
}

/**
 * Resolve the effective prompt template, ported from
 * `normalizeTemplate.ts:10-40`:
 *   - clone `db.promptTemplate` (never mutate the stored template),
 *   - `usingPromptTemplate` reflects whether one is set,
 *   - append an implicit `{ type: 'postEverything' }` when absent,
 *   - swap in the utility-bot forced template unless the user template
 *     opts in via `promptSettings.utilOverride`.
 */
export function normalizeTemplate(
  db: Database,
  currentChar: character,
): NormalizedTemplate {
  let promptTemplate = db.promptTemplate ? structuredClone(db.promptTemplate) : null
  const usingPromptTemplate = !!promptTemplate

  if (promptTemplate) {
    const hasPostEverything = promptTemplate.some(
      (card) => card.type === 'postEverything',
    )
    if (!hasPostEverything) {
      promptTemplate.push({ type: 'postEverything' })
    }
  }

  if (
    currentChar.utilityBot &&
    !(usingPromptTemplate && db.promptSettings?.utilOverride)
  ) {
    promptTemplate = [
      { type: 'plain', text: '', role: 'system', type2: 'main' },
      { type: 'description' },
      { type: 'lorebook' },
      { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
      { type: 'plain', text: '', role: 'system', type2: 'globalNote' },
      { type: 'postEverything' },
    ]
  }

  return { promptTemplate, usingPromptTemplate }
}

/**
 * The null-template `formatingOrder` fallback (`index.svelte.ts:308-311`):
 * a clone of `db.formatingOrder` with `postEverything` always appended.
 * Used only on the non-template render path.
 */
export function buildFormatOrder(db: Database): FormatOrderKey[] {
  const order = structuredClone(db.formatingOrder ?? []) as FormatOrderKey[]
  order.push('postEverything')
  return order
}

/** Models whose system rows are coalesced (`renderFinalPrompt.ts:96-101`). */
function coalescesSystemRows(aiModel: string): boolean {
  return (
    aiModel.startsWith('gpt') ||
    aiModel.startsWith('claude') ||
    aiModel === 'openrouter' ||
    aiModel === 'reverse_proxy'
  )
}

/**
 * The shared row-filter + system-coalescing helper (`pushPrompts`,
 * `renderFinalPrompt.ts:90-118`), mutating `formated` in place:
 *   - skip rows with empty `content` and no multimodals,
 *   - on non-coalescing models, push every row verbatim,
 *   - otherwise merge a `system` row into the previous one when both are
 *     `system` and share `memo` + `name`; everything else is pushed.
 *
 * The SPA's trailing `formated.at(-1).content += ''` no-op is omitted.
 */
export function coalesceRows(
  formated: OpenAIChat[],
  rows: OpenAIChat[],
  aiModel: string,
): void {
  for (const chat of rows) {
    if (!chat.content.trim() && !(chat.multimodals && chat.multimodals.length > 0)) {
      continue
    }
    if (!coalescesSystemRows(aiModel)) {
      formated.push(chat)
      continue
    }
    if (chat.role === 'system') {
      const endf = formated.at(-1)
      if (
        endf &&
        endf.role === 'system' &&
        endf.memo === chat.memo &&
        endf.name === chat.name
      ) {
        endf.content += '\n\n' + chat.content
      } else {
        formated.push(chat)
      }
    } else {
      formated.push(chat)
    }
  }
}

/**
 * The branch-free non-template render path (`renderFinalPrompt.ts:352-357`):
 * walk `formatOrder`, pushing each slot through `coalesceRows`. The
 * trailing finalization (trim, `depth_prompt` splice, cache-point
 * walk-back, `editRequest` Lua hook) is deferred to 7-10f.
 */
export function renderByFormatOrder(
  unformated: UnformatedPromptSlots,
  formatOrder: FormatOrderKey[],
  aiModel: string,
): OpenAIChat[] {
  const formated: OpenAIChat[] = []
  for (const key of formatOrder) {
    coalesceRows(formated, unformated[key], aiModel)
  }
  return formated
}
