import { randomUUID } from 'node:crypto'
import type { FastifyChat as Chat, FastifyCharacter as character, FastifyMessage as Message } from './serverTypes.js'
import { expandVariables, type ExpandContext } from './variables.js'
import { processScriptAsync, type ScriptInjectMutation, type ScriptMutationHooks } from './scripts.js'
import { getDepthPrompts, resolvePosition, type LoreEntryActive, type LorebookActivationReport } from './lorebook.js'
import { tokenizeChat } from './tokens.js'
import { ensureTokenizerLoadedForDb, tokenizerOptionsFromDb } from './tokenizerConfig.js'
import { runStartTrigger, type TriggerRunResult } from './triggers.js'
import { isRisuChatParserFixedPoint } from './parserFixedPoint.js'
import { buildPromptAssetTable, type PromptAssetTable } from './promptAssets.js'
import type { PromptMessage, PromptMultimodal } from './promptMessage.js'

type MaybePromise<T> = T | Promise<T>

/**
 * History walk ported from the SPA's `buildHistoryWindow.ts`,
 * `formatHistoryMessage.ts`, and `exampleMessages.ts`.
 *
 * Includes the examples block, `[Start a new chat]` marker gated by
 * `!aiModel.startsWith('novelai') && !promptSettings.trimStartNewChat`,
 * first-message selection, `makeMs` filter for `disabled === true` /
 * `'allBefore'`, and per-message role mapping.
 *
 * History formatting:
 *   - First message and per-message bodies flow through
 *     `processScript(ctx, char, data, 'editprocess', cbsConditions)`
 *     after a pre-pass through `expandVariables` (mirrors the SPA's
 *     `processScriptFull(char, risuChatParser(data, {chara, role}), 'editprocess', ...)`
 *     call at `formatHistoryMessage.ts`).
 *   - First message and per-message `sendName` wrapper (gated by
 *     `usingPromptTemplate && db.promptSettings.sendName`). The first
 *     message gets a `${char.name}: ` prefix and `attr: ['nameAdded']`.
 *     Per-message bodies use `db.groupTemplate` when present, otherwise
 *     `<{{char}}'s Message>\n{{slot}}\n</{{char}}'s Message>`, and every
 *     wrapped row uses `db.groupOtherBotRole` (normally defaulted to `user`).
 *     `{{char}}` is resolved against the active `currentChar` (matches the
 *     SPA's effective behavior — the `chara: msg.saying` override at
 *     formatHistoryMessage.ts is shadowed by the cbs `char` callback
 *     reading currentChar from scope first; see cbs.ts).
 *   - `<Thoughts>...</Thoughts>` extraction with the
 *     `maxThoughtTagDepth` clamp: always stripped from `content`,
 *     captured into `chat.thoughts: string[]` when
 *     `maxThoughtDepth === -1 || maxThoughtDepth - totalCount <= index`.
 *   - Per-message `memo` defaults to `msg.chatId`, using a local UUID v4 when
 *     missing so prompt rows keep stable shape without mutating the transcript.
 *
 * Multimodal inlays + `{{asset_prompt::}}`. Adds an
 * `AssetLookup` DI seam so the route layer can resolve inlay ids and
 * asset names to `MultiModal` bytes from the server asset store. Legacy
 * inlay ids may be aliased by request metadata, but bytes stay server-owned.
 * Defaults to a no-op lookup so prompt-leaf
 * tests can assert tag stripping without standing up the storage path.
 *
 * Inlay tag handling mirrors `formatHistoryMessage.ts`:
 *   - `char` role: strip ALL three tag types from content; only
 *     `{{inlayeddata::id}}` ids reach the lookup. (The SPA quirk —
 *     `inlay::` / `inlayed::` get stripped from text but their assets
 *     aren't surfaced even if they exist.)
 *   - non-`char` role: collect all three tag types, look each one up,
 *     then strip from content.
 *   - `video` / `audio` cap at one entry in `multimodals` total (SPA
 *     `formatHistoryMessage.ts`).
 *   - The SPA's `runImageEmbedding` caption fallback for non-vision
 *     models is browser-only and skipped on the server.
 *
 * `{{asset_prompt::name}}` handling mirrors `formatHistoryMessage.ts`:
 *   - match against `currentChar.additionalAssets ∪ moduleAssets`.
 *   - on a match, resolve via `assetLookup.getAsset(name)`.
 *   - on `name === 'icon'` with no asset match, resolve via
 *     `assetLookup.getCharIcon()`.
 *   - tag always stripped from content even when no asset resolves.
 *   - regex accepts both `asset_prompt::` and `assetprompt::` (the SPA
 *     uses `asset_?prompt::` with `i` flag).
 *
 * `addedTokens` accumulator over every emitted
 * chat row (examples, start-new-chat marker, first message, per-message
 * bodies) plus a depth-prompt token preflight when the caller supplies
 * a `LorebookActivationReport`. Splicing depth prompts into history is
 * still `applyDepthPrompts`' job; this preflight only tallies counts so
 * the assemble root can read a single number for the history block
 * (mirrors `buildHistoryWindow.ts` in the SPA). Tokenizer
 * config (encoding, per-message overhead, name accounting) is derived
 * from `db.aiModel` the same way `sendChatContext.ts` does:
 * `gpt*` → overhead 5, `useName: 'noName'`; everything else → overhead
 * 3, `useName: 'name'`. `tokenizerOptionsFromDb` resolves the portable
 * tokenizer family through the server-safe model catalog.
 *
 * Start-trigger handoff. After the first-message
 * push, `buildHistoryWindow` runs `runStartTrigger` (the `triggers.ts`
 * adapter), re-runs `makeMs` against the possibly-mutated chat, folds
 * `triggerResult.tokens` into `addedTokens`, early-returns on
 * `stopSending`, and surfaces `triggerResult` / `currentChat` /
 * `varChanged` for the assemble root (which applies
 * `additonalSysPrompt` and persists the db). This makes the history
 * walk feature-complete. `buildHistoryWindow` is async because
 * `runStartTrigger` is.
 *
 * Each first-message / per-message body additionally flows through the
 * injectable `editProcess` seam between `expandVariables` and `processScript`.
 * Lua `editprocess` is currently a browser no-op, so the default seam is
 * identity.
 */

export interface AssetLookup {
  /** Char + module asset rows built for this assembly/history walk. */
  assetTable?: PromptAssetTable
  /** Resolves an inlay id from `{{inlay/inlayed/inlayeddata::id}}`. */
  getInlay?(id: string): MaybePromise<PromptMultimodal | undefined>
  /** Resolves an `{{asset_prompt::name}}` against char + module assets. */
  getAsset?(name: string): MaybePromise<PromptMultimodal | undefined>
  /** Resolves the `{{asset_prompt::icon}}` fallback. */
  getCharIcon?(): MaybePromise<PromptMultimodal | undefined>
}

export const NO_ASSETS: AssetLookup = {}

export interface PromptAssetDropDiagnostic {
  name: string
  reference?: string
  reason: 'metadata_missing' | 'bytes_missing'
}

/**
 * The `editprocess` history-edit seam. Runs over each first-message /
 * per-message body between the `expandVariables` pre-pass and the regex
 * `processScript`, mirroring the leading
 * `runLuaEditTrigger(char, 'editprocess', data, { index })` inside the SPA's
 * `processScriptFull` (`scripts.ts`). `index` is the per-row index the SPA
 * threads as `{ index: chatID }` meta (`-1` for the first message). Lua
 * `editprocess` is currently a browser no-op, so the default is identity.
 */
export type EditProcessHook = (content: string, index: number) => string | Promise<string>

/** Identity `editProcess` seam — the Lua `editprocess` browser no-op. */
const IDENTITY_EDIT_PROCESS: EditProcessHook = (content) => content

const INLAY_RE = /\{\{(inlay|inlayed|inlayeddata)::(.+?)\}\}/g
const ASSET_PROMPT_RE = /\{\{asset_?prompt::(.+?)\}\}/gimsu

/**
 * `video` and `audio` inlays cap at one entry total
 * (`formatHistoryMessage.ts`). Other types append freely.
 */
function pushMultimodal(arr: PromptMultimodal[], m: PromptMultimodal): void {
  if (m.type === 'video' || m.type === 'audio') {
    if (arr.length === 0) arr.push(m)
    return
  }
  arr.push(m)
}

const SEND_NAME_WRAPPER = `<{{char}}'s Message>\n{{slot}}\n</{{char}}'s Message>`
const THOUGHTS_RE = /<Thoughts>(.+)<\/Thoughts>/gms

export function exampleMessage(ctx: ExpandContext, char: character): PromptMessage[] {
  const raw = char.exampleMessage ?? ''
  if (raw === '') return []

  const lines = raw.split('\n')
  const collected: PromptMessage[] = []
  let current: PromptMessage | null = null

  const flush = () => {
    if (current) collected.push(current)
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const lowered = trimmed.toLocaleLowerCase()

    if (lowered === '<start>') {
      flush()
      collected.push({
        role: 'system',
        content: '[Start a new chat]',
        memo: 'NewChatExample',
      })
      current = null
    } else if (lowered.startsWith('{{char}}:') || lowered.startsWith('<bot>:') || lowered.startsWith(`${char.name}:`)) {
      flush()
      current = {
        role: 'assistant',
        content: trimmed.split(':', 2)[1].trimStart(),
        name: 'example_assistant',
      }
    } else if (lowered.startsWith('{{user}}:') || lowered.startsWith('<user>:')) {
      flush()
      current = {
        role: 'user',
        content: trimmed.split(':', 2)[1].trimStart(),
        name: 'example_user',
      }
    } else if (current) {
      current.content += '\n' + trimmed
    }
  }
  flush()

  return collected.map((entry) => {
    const expanded: PromptMessage = {
      role: entry.role,
      content: expandVariables(entry.content, { ...ctx, chara: char }).text,
    }
    if (entry.name !== undefined) expanded.name = entry.name
    if (entry.memo !== undefined) expanded.memo = entry.memo
    return expanded
  })
}

function extractThoughts(
  content: string,
  index: number,
  totalCount: number,
  maxThoughtDepth: number,
): { content: string; thoughts: string[] } {
  const thoughts: string[] = []
  const stripped = content.replace(THOUGHTS_RE, (_match, body: string) => {
    if (maxThoughtDepth === -1 || maxThoughtDepth - totalCount <= index) {
      thoughts.push(body)
    }
    return ''
  })
  return { content: stripped, thoughts }
}

async function processInlays(
  text: string,
  role: Message['role'],
  lookup: AssetLookup,
): Promise<{ text: string; multimodals: PromptMultimodal[] }> {
  let formatted = text
  const multimodals: PromptMultimodal[] = []

  if (role === 'char') {
    const ids: string[] = []
    formatted = formatted.replace(INLAY_RE, (_match, tag: string, id: string) => {
      if (id && tag === 'inlayeddata') ids.push(id)
      return ''
    })
    for (const id of ids) {
      const resolved = await lookup.getInlay?.(id)
      if (resolved) pushMultimodal(multimodals, resolved)
    }
  } else {
    const matches = Array.from(formatted.matchAll(INLAY_RE))
    for (const match of matches) {
      const id = match[2]
      const resolved = await lookup.getInlay?.(id)
      if (resolved) pushMultimodal(multimodals, resolved)
      formatted = formatted.replace(match[0], '')
    }
  }

  return { text: formatted, multimodals }
}

async function processAssetPrompts(
  text: string,
  assetTable: PromptAssetTable,
  lookup: AssetLookup,
  iconReference: string | undefined,
  diagnostics: PromptAssetDropDiagnostic[],
): Promise<{ text: string; multimodals: PromptMultimodal[] }> {
  const multimodals: PromptMultimodal[] = []
  const matches = Array.from(text.matchAll(ASSET_PROMPT_RE))
  for (const match of matches) {
    const name = match[1]
    const asset = assetTable.find((v) => v[0] === name)
    if (asset) {
      const resolved = await lookup.getAsset?.(name)
      if (resolved) {
        multimodals.push(resolved)
      } else {
        diagnostics.push({ name, reference: asset[1], reason: 'bytes_missing' })
      }
    } else if (name === 'icon') {
      const resolved = await lookup.getCharIcon?.()
      if (resolved) {
        multimodals.push(resolved)
      } else {
        diagnostics.push({
          name,
          ...(iconReference ? { reference: iconReference } : {}),
          reason: iconReference ? 'bytes_missing' : 'metadata_missing',
        })
      }
    } else {
      diagnostics.push({ name, reason: 'metadata_missing' })
    }
  }
  const formatted = text.replace(ASSET_PROMPT_RE, '')
  return { text: formatted, multimodals }
}

async function formatHistoryMessage(
  ctx: ExpandContext,
  currentChar: character,
  currentChat: Chat,
  msg: Message,
  index: number,
  totalCount: number,
  usingPromptTemplate: boolean,
  assetLookup: AssetLookup,
  assetTable: PromptAssetTable,
  editProcess: EditProcessHook,
  assetDiagnostics: PromptAssetDropDiagnostic[],
  preparedSendNameWrapper?: string,
  sendNameRole?: PromptMessage['role'],
  scriptMutationHooks?: ScriptMutationHooks,
): Promise<PromptMessage> {
  const db = ctx.database
  const maxThoughtDepth = db.promptSettings?.maxThoughtTagDepth ?? -1

  const rawData = msg.data ?? ''
  const preExpanded = isRisuChatParserFixedPoint(rawData)
    ? rawData
    : expandVariables(rawData, {
        ...ctx,
        chatID: index,
        chara: currentChar,
        role: msg.role,
      }).text

  // Lua `editprocess` stays at the browser call position before regex
  // `processScript`; it is currently an identity hook.
  const luaProcessed = await editProcess(preExpanded, index)

  let formatted = await processScriptAsync(
    ctx,
    currentChar,
    luaProcessed,
    'editprocess',
    { chatRole: msg.role },
    index,
    currentChat,
    scriptMutationHooks,
  )

  const memo = msg.chatId || randomUUID()

  const multimodals: PromptMultimodal[] = []

  const inlayResult = await processInlays(formatted, msg.role, assetLookup)
  formatted = inlayResult.text
  for (const m of inlayResult.multimodals) pushMultimodal(multimodals, m)

  if (usingPromptTemplate && preparedSendNameWrapper) {
    formatted = preparedSendNameWrapper.replace('{{slot}}', formatted)
  }

  const { content: postThoughts, thoughts } = extractThoughts(formatted, index, totalCount, maxThoughtDepth)
  formatted = postThoughts

  const assetResult = await processAssetPrompts(formatted, assetTable, assetLookup, currentChar.image, assetDiagnostics)
  formatted = assetResult.text
  for (const m of assetResult.multimodals) pushMultimodal(multimodals, m)

  const chat: PromptMessage = {
    role: sendNameRole ?? (msg.role === 'user' ? 'user' : 'assistant'),
    content: formatted,
    memo,
  }
  if (thoughts.length > 0) chat.thoughts = thoughts
  if (multimodals.length > 0) chat.multimodals = multimodals
  return chat
}

export interface HistoryWindowResult {
  messages: PromptMessage[]
  /**
   * Sum of `tokenizeChat` over every emitted row plus the depth-prompt
   * preflight when `report` is provided and the start trigger's
   * `triggerResult.tokens`. Mirrors the SPA's
   * `buildHistoryWindow.addedTokens` (`buildHistoryWindow.ts`).
   */
  addedTokens: number
  /**
   * The start trigger asked to abort the send (`stop` /
   * `v2StopPromptSending`). The assemble root aborts when true, matching
   * the SPA's `{ stopSending: true }` early return
   * (`buildHistoryWindow.ts`). `messages` is then incomplete and
   * should be ignored.
   */
  stopSending: boolean
  /**
   * The working chat, possibly mutated by the start trigger
   * (impersonate / cutchat / modifychat). The assemble root threads this
   * forward (`assembleLocalSendChatPrompt` in `sendChatPromptAssembly.ts`).
   */
  currentChat: Chat
  /**
   * The raw start-trigger result, or `null` when no triggers ran. The
   * assemble root applies `triggerResult.additonalSysPrompt` to the
   * prompt slots (`assembleLocalSendChatPrompt` in `sendChatPromptAssembly.ts`).
   */
  triggerResult: TriggerRunResult | null
  /**
   * A start-trigger `setvar` wrote chat state; the route persists the
   * database when true (the `expandVariables` → `dirty` pattern).
   */
  varChanged: boolean
  /**
   * Depth prompts expanded once during history token preflight. The final
   * splice still computes insertion indexes against the live post-memory
   * message array.
   */
  preparedDepthPrompts: PreparedDepthPrompt[]
  /** Prompt assets omitted while preserving the text-only history row. */
  assetDiagnostics: PromptAssetDropDiagnostic[]
  /** Identity-addressed transcript rewrites caused only by matched `@@inject` scripts. */
  injectMutations: ScriptInjectMutation[]
}

function groupOtherBotRole(value: unknown): PromptMessage['role'] {
  if (value === 'user' || value === 'assistant' || value === 'system') return value
  if (value === undefined || value === null || value === '') return 'user'
  // Baseline's switch fell back to assistant for an invalid persisted value.
  return 'assistant'
}

export interface PreparedDepthPrompt {
  active: LoreEntryActive
  content: string
}

export function prepareDepthPrompts(
  ctx: ExpandContext,
  currentChar: character,
  report: LorebookActivationReport,
): PreparedDepthPrompt[] {
  return getDepthPrompts(report).map((active) => {
    const body = resolvePosition(active.prompt, report)
    return {
      active,
      content: expandVariables(body, {
        ...ctx,
        chara: currentChar,
      }).text,
    }
  })
}

export async function buildHistoryWindow(
  ctx: ExpandContext,
  currentChar: character,
  currentChat: Chat,
  usingPromptTemplate: boolean = false,
  assetLookup: AssetLookup = NO_ASSETS,
  report?: LorebookActivationReport,
  editProcess: EditProcessHook = IDENTITY_EDIT_PROCESS,
  promptAssetTable?: PromptAssetTable,
): Promise<HistoryWindowResult> {
  await ensureTokenizerLoadedForDb(ctx.database)
  const db = ctx.database
  const messages: PromptMessage[] = []
  const assetTable =
    promptAssetTable ?? assetLookup.assetTable ?? buildPromptAssetTable({ database: db, currentChar, currentChat })
  const { encoding, options } = tokenizerOptionsFromDb(db)
  let addedTokens = 0
  const assetDiagnostics: PromptAssetDropDiagnostic[] = []
  const injectMutations = new Map<string, ScriptInjectMutation>()
  const preparedSendNameWrapper =
    usingPromptTemplate && db.promptSettings?.sendName
      ? expandVariables(db.groupTemplate || SEND_NAME_WRAPPER, {
          ...ctx,
          chara: currentChar,
        }).text
      : undefined
  const sendNameRole = preparedSendNameWrapper ? groupOtherBotRole(db.groupOtherBotRole) : undefined
  let preparedDepthPrompts: PreparedDepthPrompt[] = []

  for (const example of exampleMessage(ctx, currentChar)) {
    messages.push(example)
    addedTokens += tokenizeChat(example, encoding, options)
  }

  const aiModel = db.aiModel ?? ''
  const trimStart = db.promptSettings?.trimStartNewChat ?? false
  if (!aiModel.startsWith('novelai') && !trimStart) {
    const marker: PromptMessage = {
      role: 'system',
      content: '[Start a new chat]',
      memo: 'NewChat',
    }
    messages.push(marker)
    addedTokens += tokenizeChat(marker, encoding, options)
  }

  // `makeMs` mirrors the SPA closure (`buildHistoryWindow.ts`):
  // walk newest-to-oldest, drop `disabled === true`, stop at the first
  // `'allBefore'` reset, and set the outer `msReseted`. It runs again
  // after the start trigger so the per-message loop sees the mutated
  // chat.
  let msReseted = false
  const makeMs = (chat: Chat): Message[] => {
    const mss: Message[] = []
    msReseted = false
    for (let i = chat.message.length - 1; i >= 0; i--) {
      const d = chat.message[i]
      if (d.disabled === true) continue
      if (d.disabled === 'allBefore') {
        msReseted = true
        break
      }
      mss.unshift(d)
    }
    return mss
  }
  let ms = makeMs(currentChat)

  if (!msReseted) {
    const fmIndex = currentChat.fmIndex ?? -1
    const firstMsgSource =
      fmIndex === -1 ? (currentChar.firstMessage ?? '') : (currentChar.alternateGreetings?.[fmIndex] ?? '')
    const preExpanded = expandVariables(firstMsgSource, {
      ...ctx,
      chara: currentChar,
    }).text
    // Lua `editprocess` no-op hook. The SPA threads the first message through
    // `processScript` with `chatID = -1`, so `runLuaEditTrigger` sees `{ index: -1 }`.
    const luaProcessed = await editProcess(preExpanded, -1)
    let content = await processScriptAsync(ctx, currentChar, luaProcessed, 'editprocess')
    const firstMessage: PromptMessage = { role: 'assistant', content }
    if (usingPromptTemplate && db.promptSettings?.sendName) {
      firstMessage.content = `${currentChar.name}: ${content}`
      firstMessage.attr = ['nameAdded']
    }
    messages.push(firstMessage)
    addedTokens += tokenizeChat(firstMessage, encoding, options)
  }

  // Start-trigger handoff (SPA `buildHistoryWindow.ts`). The
  // trigger may mutate the chat, so re-run `makeMs` and add its token
  // contribution; on `stopSending` the assemble root aborts the send.
  const rawTriggerResult = await runStartTrigger(ctx, currentChar, currentChat)
  const triggerResult = rawTriggerResult?.aborted ? null : rawTriggerResult
  let varChanged = false
  if (rawTriggerResult?.aborted) {
    varChanged = rawTriggerResult.varChanged
  }
  if (triggerResult) {
    currentChat = triggerResult.chat
    ms = makeMs(currentChat)
    addedTokens += triggerResult.tokens
    varChanged = triggerResult.varChanged
    if (triggerResult.stopSending) {
      return {
        messages,
        addedTokens,
        stopSending: true,
        currentChat,
        triggerResult,
        varChanged,
        preparedDepthPrompts,
        assetDiagnostics,
        injectMutations: [],
      }
    }
  }

  for (let i = 0; i < ms.length; i++) {
    const formatted = await formatHistoryMessage(
      ctx,
      currentChar,
      currentChat,
      ms[i],
      i,
      ms.length,
      usingPromptTemplate,
      assetLookup,
      assetTable,
      editProcess,
      assetDiagnostics,
      preparedSendNameWrapper,
      sendNameRole,
      {
        injectTarget: ms[i],
        onInject(mutation) {
          const previous = injectMutations.get(mutation.messageId)
          injectMutations.set(mutation.messageId, previous ? { ...mutation, before: previous.before } : mutation)
        },
      },
    )
    messages.push(formatted)
    addedTokens += tokenizeChat(formatted, encoding, options)
  }

  // Depth-prompt preflight (SPA `buildHistoryWindow.ts`).
  // The actual splice still happens in `applyDepthPrompts` to match
  // the SPA's `assembleLocalSendChatPrompt` call order; here we only
  // tokenize so the assemble root sees a single `addedTokens` total.
  if (report) {
    preparedDepthPrompts = prepareDepthPrompts(ctx, currentChar, report)
    for (const { active, content } of preparedDepthPrompts) {
      addedTokens += tokenizeChat({ role: active.role, content }, encoding, options)
    }
  }

  return {
    messages,
    addedTokens,
    stopSending: false,
    currentChat,
    triggerResult,
    varChanged,
    preparedDepthPrompts,
    assetDiagnostics,
    injectMutations: [...injectMutations.values()],
  }
}

/**
 * Splice lorebook depth-prompts into a built history window. Mirrors the SPA
 * root, which runs this after `buildHistoryWindow` and `buildMemoryWindow`
 * against the final flattened chats array.
 *
 * Index semantics:
 *   - `@@depth N`         → splice at index `N` (counts from start).
 *   - `@@reverse_depth N` → splice at index `messages.length - N`
 *                           (counts from end), recomputed per
 *                           insertion so prior splices shift the
 *                           target.
 *
 * Iteration order follows `report.actives` (which `activateLorebook`
 * already sorted + reversed) so the final layout matches the SPA
 * fixture `__fixtures__/db/lorebook-position-depth.json`.
 *
 * `{{position::pt_<name>}}` markers inside each depth-prompt body
 * are resolved against the same `report` (a `pt_<name>` entry's
 * decorator-stripped prompt is inlined), then CBS / `{{user}}` etc.
 * are expanded via `expandVariables`.
 *
 * Mutates `messages` in place to preserve the SPA's splice semantics
 * (a single growing array, so subsequent `reverse_depth` calculations
 * see the post-insert length); returns it for chaining.
 *
 * `pos === 'depth' && depth === 0` entries are intentionally excluded
 * — those belong to the `postEverything` slot owned by the template
 * walker or the assemble root.
 */
export function applyDepthPrompts(
  messages: PromptMessage[],
  ctx: ExpandContext,
  currentChar: character,
  report: LorebookActivationReport,
  preparedDepthPrompts?: PreparedDepthPrompt[],
): PromptMessage[] {
  const rows = preparedDepthPrompts ?? prepareDepthPrompts(ctx, currentChar, report)
  for (const { active: dp, content } of rows) {
    const idx = dp.pos === 'depth' ? dp.depth : messages.length - dp.depth
    messages.splice(idx, 0, { role: dp.role, content })
  }
  return messages
}
