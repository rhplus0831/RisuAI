import type {
  Database,
  character,
} from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import type { PromptItem } from '../../../../src/ts/process/prompt'
import { expandVariables, type ExpandContext } from './variables.js'

/**
 * Phase 7-10a template normalization + slot contract, ported from the
 * SPA's `src/ts/process/promptAssembly/{normalizeTemplate,
 * renderFinalPrompt}.ts`.
 *
 * 7-10a ported the branch-free renderer foundation:
 *   - the canonical slot contract (`UnformatedPromptSlots`),
 *   - `normalizeTemplate` (utility-bot forced template + implicit
 *     `postEverything`),
 *   - `buildFormatOrder` (the null-template `formatingOrder` fallback),
 *   - `coalesceRows` (the shared empty-row filter + system-row
 *     coalescing helper that every later card branch reuses), and
 *   - `renderByFormatOrder` (the branch-free non-template walk).
 *
 * 7-10b adds the content-card renderer:
 *   - `renderContentCard` (`renderFinalPrompt.ts:140-300`): the per-card
 *     row builder. This is the single source of truth for per-card
 *     content: `preflight.ts` (7-8b) consumes the same builder to count
 *     tokens, so the two never drift.
 *   - `renderByTemplate`: the template-walk path (`renderFinalPrompt.ts`
 *     `if (promptTemplate)` branch) that dispatches content cards
 *     through `renderContentCard` + `coalesceRows`.
 *
 * 7-10c adds the `chat` card to `renderContentCard` (range math + the
 * `systemizeChat` lift) so the builder now covers `persona` /
 * `description` / `authornote` / `lorebook` / `postEverything` /
 * `plain` / `jailbreak` / `cot` / `chatML` / `chat`, returning `null`
 * only for `memory` / `cache`.
 *
 * 7-10d adds `memory` / `cache` and the automatic cache-point walk-back.
 * `renderContentCard` still returns `null` for `memory` / `cache`
 * because they are not pure row-builders: `memory` needs the injected
 * `memories` input and `cache` (plus the automatic walk-back) mutates
 * the accumulated `formated` array. Both are handled directly in
 * `renderByTemplate`.
 *
 * 7-10e adds prompt-info capture + the content trim. `renderByTemplate`
 * now returns `{ formated, promptInfo }` (a `RenderedTemplate`): when
 * both `promptInfoInsideChat` and `promptTextInfoInsideChat` are on it
 * collects a parallel info array via the `deps.promptInfo` sink, and it
 * trims row contents on both the template and (via `renderByFormatOrder`)
 * the non-template paths. The injected `positionParser` is already the
 * position seam (Tier 3 builds the real `resolvePosition`).
 *
 * Deferred to 7-10f: the `depth_prompt` splice, the
 * `runLuaEditTrigger('editRequest')` handoff, the `isContinue`
 * `[Continue the last response]` push, and the unifying top-level
 * `renderFinalPrompt` entry. The assemble root that fills these slots,
 * builds the injection-lore-aware `positionParser`, and applies
 * `triggerResult.additonalSysPrompt` is Tier 3 (7-11a/b).
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
 * walk `formatOrder`, pushing each slot through `coalesceRows`, then
 * trim row contents (7-10e). This path has no prompt-info capture (the
 * SPA's `else` branch). The remaining finalization (`depth_prompt`
 * splice, `editRequest` Lua hook) is deferred to 7-10f.
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
  // SPA trailing trim (`renderFinalPrompt.ts:359-362`); this path has no
  // prompt-info capture (SPA `:352-356`). `depth_prompt` + `editRequest`
  // stay 7-10f.
  trimContentsInPlace(formated)
  return formated
}

/** SPA `convertRole` (`renderFinalPrompt.ts:217-221`). */
const CONVERT_ROLE = {
  system: 'system',
  user: 'user',
  bot: 'assistant',
} as const

/**
 * The global-note prebuilt image instruction, copied verbatim from
 * `src/ts/util.ts:1198` (`util.ts` pulls in Svelte/Tauri imports the
 * server can't load). Appended to a `globalNote` card when the
 * character opts in. The `{{join}}` / `{{ele}}` CBS is expanded later.
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

/**
 * Inlined `parseChatML` from `src/ts/parser/chatML.ts`, expanding each
 * row through the server `expandVariables` (matches the prior copy in
 * `preflight.ts`). Returns `null` when the text is not a ChatML block.
 */
export function parseChatML(text: string, ctx: ExpandContext): OpenAIChat[] | null {
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
 * `src/ts/process/promptAssembly/systemizeChat.ts:9-23`. Mutates rows
 * in place: `user` / `assistant` rows become `system` with the role
 * (or the `example_*` name) folded into the content, dropping
 * `memo` / `name`. Callers clone first when the source must be
 * preserved (see the `chat` card).
 */
export function systemizeChat(chats: OpenAIChat[]): OpenAIChat[] {
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

/**
 * SPA `pushPromptInfoBody` (`renderFinalPrompt.ts:121-133`): append a
 * prompt-info row to the prompt-info-inside-chat capture array. Skips
 * an empty `fmt`. `fmt` is expanded with the bare `ctx` (no `chara`),
 * matching the SPA's `risuChatParser(fmt)`.
 */
function pushPromptInfoBody(
  store: OpenAIChat[],
  role: OpenAIChat['role'],
  fmt: string,
  ctx: ExpandContext,
): void {
  if (!fmt.trim()) return
  store.push({ role, content: expandVariables(fmt, ctx).text })
}

/** SPA trailing content trim (`renderFinalPrompt.ts:359-369`). */
function trimContentsInPlace(rows: OpenAIChat[]): void {
  for (const row of rows) {
    row.content = row.content.trim()
  }
}

export interface ContentCardDeps {
  ctx: ExpandContext
  currentChar: character
  unformated: UnformatedPromptSlots
  usingPromptTemplate: boolean
  /** `{{position::}}` + injection-lore substitution (Tier 3 builds the real one). */
  positionParser: (text: string, loc: string) => string
  /**
   * Prompt-info capture sink (7-10e). When present, persona /
   * description / authornote (raw `innerFormat`) and non-globalNote
   * plain / jailbreak / cot (parsed content) rows append a parallel
   * info row here. `renderByTemplate` only supplies it when both
   * `promptInfoInsideChat` and `promptTextInfoInsideChat` are on;
   * `preflight.ts` never supplies it.
   */
  promptInfo?: OpenAIChat[]
}

/** Render result for the template-walk path (7-10e). */
export interface RenderedTemplate {
  formated: OpenAIChat[]
  /** Parallel prompt-info rows; defined only when capture is on. */
  promptInfo?: OpenAIChat[]
}

/**
 * Build the OpenAIChat rows for a single content card
 * (`renderFinalPrompt.ts:140-266`). Returns `null` only for `memory` /
 * `cache`, which `renderByTemplate` handles directly (7-10d) because
 * they mutate injected/accumulated state rather than producing rows. A
 * gated-off `jailbreak` / `cot` card returns `[]`.
 *
 * Shared by `preflight.ts` (which tokenizes the rows) and
 * `renderByTemplate` (which coalesces them), so the per-card content
 * logic has a single source of truth.
 *
 * 7-10e: when `deps.promptInfo` is supplied, persona / description /
 * authornote (raw `innerFormat`) and non-globalNote plain / jailbreak /
 * cot (parsed content) rows also append a parallel prompt-info row.
 * `preflight.ts` never supplies the sink, so its tokenization is
 * unaffected.
 */
export function renderContentCard(
  card: PromptItem,
  deps: ContentCardDeps,
): OpenAIChat[] | null {
  const { ctx, currentChar, unformated, usingPromptTemplate, positionParser } = deps
  const db = ctx.database

  const wrapInnerFormat = (
    rows: OpenAIChat[],
    innerFormat: string | undefined,
    loc: string,
    fallback?: (row: OpenAIChat) => string,
  ): OpenAIChat[] => {
    if (innerFormat && rows.length > 0) {
      const wrap = expandVariables(positionParser(innerFormat, loc), {
        ...ctx,
        chara: currentChar,
      }).text
      for (const row of rows) {
        row.content = wrap.replace('{{slot}}', fallback ? fallback(row) : row.content)
        // Prompt-info capture uses the RAW `innerFormat` (no positionParser,
        // no chara), once per row — `renderFinalPrompt.ts:148-150`.
        if (deps.promptInfo) {
          pushPromptInfoBody(deps.promptInfo, row.role, innerFormat, ctx)
        }
      }
    }
    return rows
  }

  switch (card.type) {
    case 'persona':
      return wrapInnerFormat(structuredClone(unformated.personaPrompt), card.innerFormat, card.type)
    case 'description':
      return wrapInnerFormat(structuredClone(unformated.description), card.innerFormat, card.type)
    case 'authornote':
      return wrapInnerFormat(
        structuredClone(unformated.authorNote),
        card.innerFormat,
        card.type,
        (row) => row.content || card.defaultText || '',
      )
    case 'lorebook':
      return structuredClone(unformated.lorebook)
    case 'postEverything': {
      const rows = structuredClone(unformated.postEverything)
      if (usingPromptTemplate && db.promptSettings?.postEndInnerFormat) {
        rows.push({ role: 'system', content: db.promptSettings.postEndInnerFormat })
      }
      return rows
    }
    case 'plain':
    case 'jailbreak':
    case 'cot': {
      if (card.type === 'jailbreak' && !db.jailbreakToggle) return []
      if (card.type === 'cot' && !db.chainOfThought) return []

      const posType = card.type === 'plain' ? card.type2 : card.type
      let content = positionParser(card.text, posType)

      if (card.type === 'plain' && card.type2 === 'globalNote') {
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

      const promptRow: OpenAIChat = { role: CONVERT_ROLE[card.role], content }
      // Prompt-info capture re-expands the parsed content with the bare
      // ctx, excluding globalNote — `renderFinalPrompt.ts:251-257`.
      if (deps.promptInfo && card.type2 !== 'globalNote') {
        pushPromptInfoBody(deps.promptInfo, promptRow.role, promptRow.content, ctx)
      }
      return [promptRow]
    }
    case 'chatML':
      return parseChatML(card.text, { ...ctx, chara: currentChar }) ?? []
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
      if (start >= end) return []

      const slice = chats.slice(start, end)
      if (
        usingPromptTemplate &&
        db.promptSettings?.sendChatAsSystem &&
        !card.chatAsOriginalOnSystem
      ) {
        // Clone before systemizing so the shared `unformated.chats` is
        // not mutated between the preflight pass and the render pass.
        // The SPA mutates in place (`renderFinalPrompt.ts:297`); the
        // output rows are identical either way.
        return systemizeChat(structuredClone(slice))
      }
      return slice
    }
    default:
      // `memory` / `cache` — 7-10d.
      return null
  }
}

/**
 * The template-walk render path (`renderFinalPrompt.ts` `if
 * (promptTemplate)` branch). Dispatches content + `chat` cards through
 * `renderContentCard` + `coalesceRows`, and handles `memory` / `cache`
 * plus the automatic cache-point walk-back inline (7-10d). When both
 * `promptInfoInsideChat` and `promptTextInfoInsideChat` are on, it also
 * collects the parallel prompt-info rows, then trims both arrays and
 * returns them (7-10e). The remaining finalization (`depth_prompt`
 * splice, Lua `editRequest`, and the unifying top-level entry) is 7-10f.
 */
export function renderByTemplate(
  ctx: ExpandContext,
  currentChar: character,
  unformated: UnformatedPromptSlots,
  promptTemplate: PromptItem[],
  usingPromptTemplate: boolean,
  positionParser: (text: string, loc: string) => string = (text) => text,
  memories: OpenAIChat[] = [],
): RenderedTemplate {
  const db = ctx.database
  const aiModel = db.aiModel ?? ''

  // Prompt-info-inside-chat capture (`renderFinalPrompt.ts:120-133`):
  // collect a parallel info array, gated on both db flags.
  const capture = !!(db.promptInfoInsideChat && db.promptTextInfoInsideChat)
  const promptInfo: OpenAIChat[] | undefined = capture ? [] : undefined

  const deps: ContentCardDeps = {
    ctx,
    currentChar,
    unformated,
    usingPromptTemplate,
    positionParser,
    promptInfo,
  }

  // SPA `hasCachePoint` (from `preflightTemplateTokens`) is true iff the
  // template contains an explicit `cache` card; the whole-template scan
  // here is identical and keeps the renderer self-contained. It
  // suppresses the automatic cache-point walk-back below.
  const hasCachePoint = promptTemplate.some((card) => card.type === 'cache')

  const formated: OpenAIChat[] = []
  for (const card of promptTemplate) {
    // `memory` builds rows from the injected `memories` and `cache`
    // mutates the accumulated `formated` array, so both live here rather
    // than in the pure `renderContentCard` row-builder.
    if (card.type === 'memory') {
      // `renderFinalPrompt.ts:317-333`. Memory deliberately does **not**
      // run `positionParser` (unlike persona / description); it only
      // wraps each row via `innerFormat` + `{{slot}}`.
      const rows = structuredClone(memories)
      if (card.innerFormat && rows.length > 0) {
        const wrap = expandVariables(card.innerFormat, {
          ...ctx,
          chara: currentChar,
        }).text
        for (const row of rows) {
          row.content = wrap.replace('{{slot}}', row.content)
          // Capture the raw `innerFormat` per row (`renderFinalPrompt.ts:326-328`).
          if (promptInfo) {
            pushPromptInfoBody(promptInfo, row.role, card.innerFormat, ctx)
          }
        }
      }
      coalesceRows(formated, rows, aiModel)
      continue
    }

    if (card.type === 'cache') {
      // `renderFinalPrompt.ts:335-348`: walk `formated` from the end,
      // marking up to `depth` rows whose role matches (`all` matches any).
      let pointer = formated.length - 1
      let depthRemaining = card.depth
      while (pointer >= 0 && depthRemaining > 0) {
        if (formated[pointer].role === card.role || card.role === 'all') {
          formated[pointer].cachePoint = true
          depthRemaining--
        }
        pointer--
      }
      continue
    }

    const rows = renderContentCard(card, deps)
    if (rows) {
      coalesceRows(formated, rows, aiModel)
    }

    // Automatic cache point at the tail of a `chat` card
    // (`renderFinalPrompt.ts:301-314`): when enabled and no explicit
    // `cache` card suppresses it, mark the last 3 `user` rows.
    if (card.type === 'chat' && db.automaticCachePoint && !hasCachePoint) {
      let pointer = formated.length - 1
      let depthRemaining = 3
      while (pointer >= 0 && depthRemaining > 0) {
        if (formated[pointer].role === 'user') {
          formated[pointer].cachePoint = true
          depthRemaining--
        }
        pointer--
      }
    }
  }

  // SPA trailing trim (`renderFinalPrompt.ts:359-369`). `depth_prompt`
  // splice + `editRequest` Lua hook stay deferred to 7-10f.
  trimContentsInPlace(formated)
  if (promptInfo) trimContentsInPlace(promptInfo)

  return { formated, promptInfo }
}
