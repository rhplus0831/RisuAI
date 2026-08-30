import type { character } from '../../../../src/ts/storage/database.svelte'
import type { PromptItem } from './promptTemplate.js'
import { expandVariables, type ExpandContext } from './variables.js'
import { createPositionParser, type LorebookActivationReport } from './lorebook.js'
import { tokenizeChat } from './tokens.js'
import { tokenizerOptionsFromDb } from './tokenizerConfig.js'
import {
  renderContentCardWithStableCache,
  type StableCardRenderCache,
  type UnformatedPromptSlots as PromptUnformatedSlots,
} from './templates.js'
import type { PromptMessage } from './promptMessage.js'

/**
 * Template-wide token preflight ported from the SPA's
 * `preflightTemplateTokens.ts`.
 *
 * Walks the active `promptTemplate` card list, tokenizes every row
 * it would emit, and returns `{ addedTokens, memoryCardUsed,
 * hasCachePoint }` — the same shape the SPA's coordinator passes to
 * the memory window and final budget pruning.
 *
 * Sync (matches `tokens.ts` API): each card path tokenizes its
 * rows with `tokenizeChat(row, encoding, options)` resolved from
 * `tokenizerOptionsFromDb(db)` (gpt → overhead 5 / `noName`;
 * everything else → overhead 3 / `name`).
 *
 * Out of scope: multimodal image-token math, final budget pruning + fallback
 * chains, card normalization / alias resolution, cache-marker emission as actual
 * prompt rows, and route-layer wiring.
 *
 * `positionParser`: preflight uses the same `{{position::}}` and
 * `@@inject_at` resolver as final rendering. This is important when stable
 * cards are cached during preflight and reused by the final template walk.
 */

/**
 * Aggregated slot arrays the SPA assembly root passes into the
 * preflight. The canonical definition lives in `templates.ts`
 * (`UnformatedPromptSlots`); re-exported here as
 * `PromptUnformatedSlots` for the existing consumers.
 */
export type { PromptUnformatedSlots }

export interface PreflightResult {
  addedTokens: number
  memoryCardUsed: boolean
  hasCachePoint: boolean
}

export interface PreflightInput {
  ctx: ExpandContext
  currentChar: character
  unformated: PromptUnformatedSlots
  promptTemplate: PromptItem[] | null
  usingPromptTemplate: boolean
  report?: LorebookActivationReport
  stableCardCache?: StableCardRenderCache
  descriptionBaseIndex?: number
}

function positionParserFor(report: LorebookActivationReport | undefined): (text: string, loc: string) => string {
  if (!report) return (text) => text
  return createPositionParser(report)
}

export function preflightTemplateTokens(input: PreflightInput): PreflightResult {
  const {
    ctx,
    currentChar,
    unformated,
    promptTemplate,
    usingPromptTemplate,
    report,
    stableCardCache,
    descriptionBaseIndex,
  } = input
  const db = ctx.database
  const { encoding, options } = tokenizerOptionsFromDb(db)
  const positionParser = positionParserFor(report)

  let addedTokens = 0
  let memoryCardUsed = false
  let hasCachePoint = false

  const tokenizeAll = (rows: PromptMessage[]): void => {
    for (const row of rows) {
      addedTokens += tokenizeChat(row, encoding, options)
    }
  }

  const tokenizeCharacterDepthPrompt = (): void => {
    const depthPrompt = currentChar.depth_prompt
    if (!depthPrompt?.prompt) return
    tokenizeAll([
      {
        role: 'system',
        content: expandVariables(depthPrompt.prompt, { ...ctx, chara: currentChar }).text,
      },
    ])
  }

  // Match the SPA's `preflightTemplateTokens` null-template fallback:
  // tokenize every slot once and return.
  if (!promptTemplate) {
    for (const key of Object.keys(unformated) as Array<keyof PromptUnformatedSlots>) {
      tokenizeAll(unformated[key])
    }
    tokenizeCharacterDepthPrompt()
    return { addedTokens, memoryCardUsed, hasCachePoint }
  }

  for (let templateIndex = 0; templateIndex < promptTemplate.length; templateIndex++) {
    const card = promptTemplate[templateIndex]
    // Content + chat cards share the `renderContentCard`
    // builder; here we tokenize its rows. Only `memory` / `cache`
    // return `null` and are handled inline below.
    const contentRows = renderContentCardWithStableCache(
      card,
      {
        ctx,
        currentChar,
        unformated,
        usingPromptTemplate,
        positionParser,
        descriptionBaseIndex,
      },
      stableCardCache,
      templateIndex,
    )
    if (contentRows) {
      tokenizeAll(contentRows)
      continue
    }

    if (card.type === 'memory') {
      memoryCardUsed = true
    } else if (card.type === 'cache') {
      hasCachePoint = true
    }
  }

  tokenizeCharacterDepthPrompt()

  return { addedTokens, memoryCardUsed, hasCachePoint }
}
