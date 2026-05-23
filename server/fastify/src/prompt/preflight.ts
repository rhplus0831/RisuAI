import type { character } from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import type { PromptItem } from '../../../../src/ts/process/prompt'
import { expandVariables, type ExpandContext } from './variables.js'
import {
  resolvePosition,
  type LorebookActivationReport,
} from './lorebook.js'
import { tokenizeChat } from './tokens.js'
import { tokenizerOptionsFromDb } from './tokenizerConfig.js'

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
 * preflight. Matches `preflightTemplateTokens.ts:11-22` exactly so
 * the future assemble root (7-11a) can build this shape without
 * re-inventing it.
 */
export interface PromptUnformatedSlots {
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
 * Copied verbatim from `src/ts/util.ts:1217`. Inlined because
 * `util.ts` pulls in Svelte/Tauri imports that the server can't
 * load; 7-10a will lift this into a shared helper if a render-side
 * caller needs it.
 */
const PREBUILT_ASSET_COMMAND = `
<Image Tag Instruction>Insert HTML image tags between paragraphs based on context.
Set src as keywords from the list below that matches current character, outfit, situation sentiment and etc.
print as many different images as possible. Use only available keywords.
if there are no matching keywords, try to put clostest matching image src.
try to put at least 1 image per output.
<keywords>{{join::{{chardisplayasset}}::,}}</keywords>
Example: <img src="{{ele::{{chardisplayasset}}::0}}">
<Image Tag Instruction>
`

const CONVERT_ROLE = {
  system: 'system',
  user: 'user',
  bot: 'assistant',
} as const

/**
 * Inlined `parseChatML` from `src/ts/parser/chatML.ts`. The original
 * runs `risuChatParser` on each row; here we use the server's
 * `expandVariables` so CBS expansion goes through the same scope as
 * the rest of `prompt/`.
 */
function parseChatML(text: string, ctx: ExpandContext): OpenAIChat[] | null {
  const starter = '<|im_start|>'
  const seperator = '<|im_sep|>'
  const ender = '<|im_end|>'

  const trimmed = text.trim()
  if (!trimmed.startsWith(starter)) return null

  return trimmed
    .split(starter)
    .filter((f) => f !== '')
    .map((v) => {
      let role: 'system' | 'user' | 'assistant' = 'user'
      if (v.startsWith('user' + seperator)) {
        role = 'user'
        v = v.substring(4 + seperator.length)
      } else if (v.startsWith('system' + seperator)) {
        role = 'system'
        v = v.substring(6 + seperator.length)
      } else if (v.startsWith('assistant' + seperator)) {
        role = 'assistant'
        v = v.substring(9 + seperator.length)
      } else if (v.startsWith('user ') || v.startsWith('user\n')) {
        role = 'user'
        v = v.substring(5)
      } else if (v.startsWith('system ') || v.startsWith('system\n')) {
        role = 'system'
        v = v.substring(7)
      } else if (v.startsWith('assistant ') || v.startsWith('assistant\n')) {
        role = 'assistant'
        v = v.substring(10)
      }

      v = v.trim()
      if (v.endsWith(ender)) {
        v = v.substring(0, v.length - ender.length)
      }

      const thoughts: string[] = []
      v = v.replace(/<Thoughts>(.+)<\/Thoughts>/gms, (_match, body: string) => {
        thoughts.push(body)
        return ''
      })

      return {
        role,
        content: expandVariables(v, ctx).text,
        thoughts,
      } satisfies OpenAIChat
    })
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
    switch (card.type) {
      case 'persona': {
        const rows = structuredClone(unformated.personaPrompt)
        if (card.innerFormat && rows.length > 0) {
          const wrap = expandVariables(positionParser(card.innerFormat, card.type), {
            ...ctx,
            chara: currentChar,
          }).text
          for (let i = 0; i < rows.length; i++) {
            rows[i].content = wrap.replace('{{slot}}', rows[i].content)
          }
        }
        tokenizeAll(rows)
        break
      }
      case 'description': {
        const rows = structuredClone(unformated.description)
        if (card.innerFormat && rows.length > 0) {
          const wrap = expandVariables(positionParser(card.innerFormat, card.type), {
            ...ctx,
            chara: currentChar,
          }).text
          for (let i = 0; i < rows.length; i++) {
            rows[i].content = wrap.replace('{{slot}}', rows[i].content)
          }
        }
        tokenizeAll(rows)
        break
      }
      case 'authornote': {
        const rows = structuredClone(unformated.authorNote)
        if (card.innerFormat && rows.length > 0) {
          const wrap = expandVariables(positionParser(card.innerFormat, card.type), {
            ...ctx,
            chara: currentChar,
          }).text
          for (let i = 0; i < rows.length; i++) {
            rows[i].content = wrap.replace(
              '{{slot}}',
              rows[i].content || card.defaultText || '',
            )
          }
        }
        tokenizeAll(rows)
        break
      }
      case 'lorebook': {
        tokenizeAll(unformated.lorebook)
        break
      }
      case 'postEverything': {
        tokenizeAll(unformated.postEverything)
        if (usingPromptTemplate && db.promptSettings?.postEndInnerFormat) {
          tokenizeAll([
            { role: 'system', content: db.promptSettings.postEndInnerFormat },
          ])
        }
        break
      }
      case 'plain':
      case 'jailbreak':
      case 'cot': {
        if (card.type === 'jailbreak' && !db.jailbreakToggle) continue
        if (card.type === 'cot' && !db.chainOfThought) continue

        const posType = card.type === 'plain' ? card.type2 : card.type
        let content = positionParser(card.text, posType)

        if (card.type2 === 'globalNote') {
          if (currentChar.replaceGlobalNote) {
            content = positionParser(currentChar.replaceGlobalNote, posType).replaceAll(
              '{{original}}',
              content,
            )
          }
          if (
            currentChar.prebuiltAssetCommand &&
            !card.text.includes('{{//@customimageinstruction}}')
          ) {
            content += PREBUILT_ASSET_COMMAND
          }
        }

        content = expandVariables(content, {
          ...ctx,
          chara: currentChar,
          role: card.role,
        }).text

        tokenizeAll([{ role: CONVERT_ROLE[card.role], content }])
        break
      }
      case 'chatML': {
        const rows = parseChatML(card.text, { ...ctx, chara: currentChar })
        tokenizeAll(rows ?? [])
        break
      }
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
