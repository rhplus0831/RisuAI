import type { character } from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import type { PromptItem } from '../../../../src/ts/process/prompt'
import type { ExpandContext } from './variables.js'
import {
  resolvePosition,
  type LorebookActivationReport,
} from './lorebook.js'
import { tokenizeChat } from './tokens.js'
import { tokenizerOptionsFromDb } from './tokenizerConfig.js'
import {
  renderContentCard,
  type UnformatedPromptSlots as PromptUnformatedSlots,
} from './templates.js'

/**
 * Phase 7-8b template-wide token preflight ported from the SPA's
 * `src/ts/process/promptBudget/preflightTemplateTokens.ts`.
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
 * Out of scope per ROADMAP.md (2026-05-23 scope re-verification):
 * multimodal image-token math (the SPA's `tokenizeMultiModal` is
 * fixture-gated; the server adds it only when a fixture forces the
 * issue), final budget pruning + fallback chains (7-8c), card
 * normalization / alias resolution (7-10a), cache-marker emission
 * as actual prompt rows (7-10c), and wiring through the route
 * layer (7-11a).
 *
 * `positionParser`: the SPA injects `inject_lore` location-targeted
 * lorebooks here too, but 7-7d already filters those entries out of
 * `report.actives` (`lorebook.ts:603-619`), so the SPA's
 * `injectionLorebooks` branch is dead at this layer. The shim just
 * delegates to `resolvePosition`; the `loc` argument is kept for
 * SPA parity so 7-10a can grow it.
 */

/**
 * Aggregated slot arrays the SPA assembly root passes into the
 * preflight. The canonical definition lives in `templates.ts`
 * (`UnformatedPromptSlots`, 7-10a); re-exported here as
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
}

/**
 * Inlined `systemizeChat` from
 * `src/ts/process/promptAssembly/systemizeChat.ts:9-23`. Mutates
 * rows in place: user/assistant roles become system with the role
 * (or `example_*` name) folded into the content.
 */
function systemizeChat(chats: OpenAIChat[]): OpenAIChat[] {
  for (let i = 0; i < chats.length; i++) {
    const row = chats[i]
    if (row.role === 'user' || row.role === 'assistant') {
      const attr = row.attr ?? []
      if (row.name?.startsWith('example_')) {
        row.content = row.name + ': ' + row.content
      } else if (!attr.includes('nameAdded')) {
        row.content = row.role + ': ' + row.content
      }
      row.role = 'system'
      delete row.memo
      delete row.name
    }
  }
  return chats
}

function positionParserFor(
  report: LorebookActivationReport | undefined,
): (text: string, loc: string) => string {
  if (!report) return (text) => text
  return (text) => resolvePosition(text, report)
}

export function preflightTemplateTokens(input: PreflightInput): PreflightResult {
  const { ctx, currentChar, unformated, promptTemplate, usingPromptTemplate, report } = input
  const db = ctx.database
  const { encoding, options } = tokenizerOptionsFromDb(db)
  const positionParser = positionParserFor(report)

  let addedTokens = 0
  let memoryCardUsed = false
  let hasCachePoint = false

  const tokenizeAll = (rows: OpenAIChat[]): void => {
    for (const row of rows) {
      addedTokens += tokenizeChat(row, encoding, options)
    }
  }

  // Null-template fallback (SPA `:48-56`): tokenize every slot once
  // and return.
  if (!promptTemplate) {
    for (const key of Object.keys(unformated) as Array<keyof PromptUnformatedSlots>) {
      tokenizeAll(unformated[key])
    }
    return { addedTokens, memoryCardUsed, hasCachePoint }
  }

  for (const card of promptTemplate) {
    // Content cards (persona / description / authornote / lorebook /
    // postEverything / plain / jailbreak / cot / chatML) share the
    // 7-10b `renderContentCard` builder; here we tokenize its rows.
    const contentRows = renderContentCard(card, {
      ctx,
      currentChar,
      unformated,
      usingPromptTemplate,
      positionParser,
    })
    if (contentRows) {
      tokenizeAll(contentRows)
      continue
    }

    switch (card.type) {
      case 'chat': {
        const chats = unformated.chats
        let start = card.rangeStart
        let end = card.rangeEnd === 'end' ? chats.length : card.rangeEnd

        if (start === -1000) {
          start = 0
          end = chats.length
        }
        if (start < 0) {
          start = chats.length + start
          if (start < 0) start = 0
        }
        if (end < 0) {
          end = chats.length + end
          if (end < 0) end = 0
        }
        if (start >= end) break

        let slice = chats.slice(start, end)
        if (
          usingPromptTemplate &&
          db.promptSettings?.sendChatAsSystem &&
          !card.chatAsOriginalOnSystem
        ) {
          slice = systemizeChat(structuredClone(slice))
        }
        tokenizeAll(slice)
        break
      }
      case 'memory': {
        memoryCardUsed = true
        break
      }
      case 'cache': {
        hasCachePoint = true
        break
      }
    }
  }

  return { addedTokens, memoryCardUsed, hasCachePoint }
}
