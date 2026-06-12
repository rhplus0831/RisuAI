import { CCardLib } from '@risuai/ccardlib'
import type { Chat, Database, Message, character, loreBook } from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { pickHashRand } from '../../../../src/ts/util/loreHash'
import { getActiveModules } from './modules.js'
import { compileBoundedRegex, isBoundedRegexError, testBoundedRegex } from './boundedRegex.js'
import { encodingForModel, tokenize, type TokenEncoding } from './tokens.js'
import { expandVariables, type ExpandContext } from './variables.js'

/**
 * Lorebook activation: constant + keyword + recursive.
 *
 * Ports the always-on, keyword-driven, and recursive-scanning paths of
 * `loadLoreBookV3Prompt` into a Svelte-free, request-scoped function. The
 * decorator parser scaffold handles shared parsing for:
 *
 *   - token-budget truncation.
 *   - depth-prompt emission into history.
 *
 * In-scope decorators (parsed, applied, and stripped from prompt text
 * unless noted):
 *   - `role`, `position`, `depth`/`reverse_depth`, `end`,
 *     `priority`, `ignore_on_max_context`, the four `inject_*` forms,
 *     `disable_ui_prompt`.
 *   - `additional_keys`, `exclude_keys`, `exclude_keys_all`,
 *     `match_full_word`, `match_partial_word`, `scan_depth`,
 *     `activate_only_after`, `activate_only_every`, `is_greeting`,
 *     `probability`, `activate`, `dont_activate`,
 *     `keep_activate_after_match`, `dont_activate_after_match`.
 *   - `recursive`, `unrecursive`, `no_recursive_search`.
 *
 * `instruct_*` and `is_user_icon` stay on the `default: return false`
 * path until their use cases come up.
 *
 * Note on `CCardLib.decorator.parse`: every leading `@@`-line is
 * stripped from the body regardless of the hook's return value. The
 * hook's `return false` only sets a flag that enables a following
 * `@@@`-conditional decorator. For
 * the two `*_after_match` decorators we still `return false` to
 * preserve SPA parity in case a preset chains a `@@@` line after them.
 *
 * Note on `additional_keys`: SPA semantics are **AND** between the
 * entry's `key` and each `additional_keys` decorator (each pushed as
 * a separate positive query that must all match). Keys *within* a
 * single decorator are OR-combined inside `searchMatch`.
 *
 * Note on recursion: after an entry activates, its
 * decorator-stripped body is pushed into `recursivePrompt` (subject
 * to the per-entry `recursive`/`unrecursive` decorator or the global
 * `char.loreSettings.recursiveScanning`, default true per SPA `:85`).
 * The outer `while (matching)` loop re-walks the entries against the
 * growing recursive layer; `activatedIndexes` keeps each entry firing
 * at most once, which bounds the loop at O(N) outer passes.
 * `@@no_recursive_search` lets a single entry's search ignore the
 * recursive layer (its `key` still has to be in the actual messages).
 */

export interface LoreInject {
  operation: 'append' | 'prepend' | 'replace'
  location: string
  param: string
  lore: boolean
}

export type LorePosition =
  | ''
  | 'depth'
  | 'reverse_depth'
  | 'after_desc'
  | 'before_desc'
  | 'personality'
  | 'scenario'
  | `pt_${string}`

export interface LoreEntryActive {
  depth: number
  pos: LorePosition
  prompt: string
  role: 'system' | 'user' | 'assistant'
  order: number
  priority: number
  /**
   * Token count of the decorator-stripped `prompt` under the
   * encoding resolved by `encodingForModel(input.model)`. Populated
   * so the priority-desc budget filter has something to
   * drop. Like the SPA (`lorebook.svelte.ts:584`), this is computed
   * once at activation time and not refreshed after `inject_lore`
   * mutates `prompt`.
   */
  tokens: number
  source: string
  inject: LoreInject | null
}

export interface LoreMatchLogEntry {
  prompt: string
  source: string
  activated: string
}

export interface LorebookActivationReport {
  actives: LoreEntryActive[]
  disabledUIPrompts: string[]
  /**
   * Keyword-search trace. Empty until `searchMatch` runs;
   * downstream `prompt`-stage SSE consumers can render the activation
   * reason tree from this.
   */
  matchLog: LoreMatchLogEntry[]
}

export interface ActivateLorebookInput {
  database: Database
  currentChar: character
  currentChat: Chat
  /**
   * Optional model id used to pick the tiktoken encoding for the
   * per-entry `tokens` count. Resolved through `encodingForModel`;
   * leaving it `undefined` falls back to `cl100k_base`, matching the
   * SPA's `tikJS` default (`tokenizer.ts:244`).
   */
  model?: string
  /**
   * Optional assembly-owned writer for chat vars that must survive beyond the
   * cloned working chat. The local working chat is still updated first so the
   * current activation pass observes its own sticky-state writes.
   */
  writeChatVar?: (key: string, value: string) => void
}

const POSITION_NAMED = new Set(['after_desc', 'before_desc', 'personality', 'scenario'])

function collectEntries(input: ActivateLorebookInput): loreBook[] {
  const { database, currentChar, currentChat } = input
  const characterLore = currentChar.globalLore ?? []
  const chatLore = currentChat.localLore ?? []
  const moduleLore = getActiveModules(database, currentChar, currentChat).flatMap((m) => m.lorebook ?? [])
  return [...characterLore, ...chatLore, ...moduleLore]
}

function findCharByChaId(database: Database, chaId: string | undefined): character | undefined {
  if (!chaId) return undefined
  return database.characters?.find((c) => c?.chaId === chaId)
}

function readChatVar(chat: Chat, key: string): string {
  const stored = chat.scriptstate?.['$' + key]
  if (stored === undefined || stored === null) return 'null'
  return String(stored)
}

function writeChatVar(chat: Chat, key: string, value: string): void {
  chat.scriptstate ??= {}
  chat.scriptstate['$' + key] = value
}

function writeStickyChatVar(input: ActivateLorebookInput, key: string, value: string): void {
  writeChatVar(input.currentChat, key, value)
  input.writeChatVar?.(key, value)
}

function loreId(entry: loreBook): string {
  return entry.id ?? String(pickHashRand(5555, entry.content))
}

interface SearchArg {
  keys: string[]
  searchDepth: number
  regex: boolean
  fullWordMatching: boolean
  all?: boolean
  dontSearchWhenRecursive?: boolean
}

interface RecursivePromptEntry {
  prompt: string
  data: string
  source: string
}

interface SearchableMessageBase {
  prompt: string
  data: string
  strippedPrompt: string
  strippedData: string
  compactData: string
  wordData: string[]
  speakerType: 'user' | 'char'
}

interface SearchableMessageEntry extends SearchableMessageBase {
  source: string
}

interface SearchableMessageCorpus {
  baseEntries: SearchableMessageBase[]
  depthSlices: Map<number, SearchableMessageEntry[]>
  recursiveEntries: SearchableMessageEntry[]
}

const NO_SEARCH_ENTRIES: SearchableMessageEntry[] = []

export interface LorebookSearchNormalizationInstrumentation {
  baseMessageNormalizations: number
  recursivePromptNormalizations: number
}

export interface LorebookSearchEntryListInstrumentation {
  searchMatchCalls: number
  depthSliceBuilds: number
  combinedSearchEntryArrayBuilds: number
}

const lorebookSearchNormalizationInstrumentation: LorebookSearchNormalizationInstrumentation = {
  baseMessageNormalizations: 0,
  recursivePromptNormalizations: 0,
}

const lorebookSearchEntryListInstrumentation: LorebookSearchEntryListInstrumentation = {
  searchMatchCalls: 0,
  depthSliceBuilds: 0,
  combinedSearchEntryArrayBuilds: 0,
}

export function resetLorebookSearchNormalizationInstrumentation(): void {
  lorebookSearchNormalizationInstrumentation.baseMessageNormalizations = 0
  lorebookSearchNormalizationInstrumentation.recursivePromptNormalizations = 0
}

export function getLorebookSearchNormalizationInstrumentation(): LorebookSearchNormalizationInstrumentation {
  return { ...lorebookSearchNormalizationInstrumentation }
}

export function resetLorebookSearchEntryListInstrumentation(): void {
  lorebookSearchEntryListInstrumentation.searchMatchCalls = 0
  lorebookSearchEntryListInstrumentation.depthSliceBuilds = 0
  lorebookSearchEntryListInstrumentation.combinedSearchEntryArrayBuilds = 0
}

export function getLorebookSearchEntryListInstrumentation(): LorebookSearchEntryListInstrumentation {
  return { ...lorebookSearchEntryListInstrumentation }
}

const SEARCH_COMMENT_RE = /\{\{\/\/(.+?)\}\}/g
const SEARCH_COMMENT_BLOCK_RE = /\{\{comment:(.+?)\}\}/g

function stripSearchText(text: string): string {
  return text.toLocaleLowerCase().replace(SEARCH_COMMENT_RE, '').replace(SEARCH_COMMENT_BLOCK_RE, '')
}

function normalizeSearchableBase(input: {
  prompt: string
  data: string
  speakerType: 'user' | 'char'
  source?: string
  kind: 'base' | 'recursive'
}): SearchableMessageBase | SearchableMessageEntry {
  if (input.kind === 'base') {
    lorebookSearchNormalizationInstrumentation.baseMessageNormalizations++
  } else {
    lorebookSearchNormalizationInstrumentation.recursivePromptNormalizations++
  }
  const strippedPrompt = stripSearchText(input.prompt)
  const strippedData = stripSearchText(input.data)
  const normalized = {
    prompt: input.prompt,
    data: input.data,
    strippedPrompt,
    strippedData,
    compactData: strippedData.replace(/ /g, ''),
    wordData: strippedData.split(' '),
    speakerType: input.speakerType,
  }
  return input.source ? { ...normalized, source: input.source } : normalized
}

function buildSearchableCorpus(
  messages: Message[],
  database: Database,
  currentChar: character,
): SearchableMessageCorpus {
  const username = database.username ?? 'user'
  const baseEntries = messages.map((msg) => {
    if (msg.role === 'user') {
      return normalizeSearchableBase({
        prompt: `\x01{{${username}}}:` + msg.data + '\x01',
        data: msg.data,
        speakerType: 'user',
        kind: 'base',
      }) as SearchableMessageBase
    }
    const speakerName = msg.name ?? findCharByChaId(database, msg.saying)?.name ?? currentChar.name
    return normalizeSearchableBase({
      prompt: `\x01{{${speakerName}}}:` + msg.data + '\x01',
      data: msg.data,
      speakerType: 'char',
      kind: 'base',
    }) as SearchableMessageBase
  })
  return {
    baseEntries,
    depthSlices: new Map(),
    recursiveEntries: [],
  }
}

function baseSearchEntriesForDepth(corpus: SearchableMessageCorpus, searchDepth: number): SearchableMessageEntry[] {
  const cached = corpus.depthSlices.get(searchDepth)
  if (cached) return cached

  const start = Math.max(corpus.baseEntries.length - searchDepth, 0)
  lorebookSearchEntryListInstrumentation.depthSliceBuilds++
  const sliced = corpus.baseEntries.slice(start, corpus.baseEntries.length).map((entry, i) => ({
    ...entry,
    source: `message ${i} by ${entry.speakerType}`,
  }))
  corpus.depthSlices.set(searchDepth, sliced)
  return sliced
}

function appendRecursiveSearchEntry(corpus: SearchableMessageCorpus, entry: RecursivePromptEntry): void {
  corpus.recursiveEntries.push(
    normalizeSearchableBase({
      prompt: entry.prompt,
      data: entry.data,
      source: 'lorebook ' + entry.source,
      speakerType: 'char',
      kind: 'recursive',
    }) as SearchableMessageEntry,
  )
}

function visitSearchEntries(
  baseEntries: SearchableMessageEntry[],
  recursiveEntries: SearchableMessageEntry[],
  visit: (entry: SearchableMessageEntry) => boolean,
): boolean {
  for (const entry of baseEntries) {
    if (visit(entry)) return true
  }
  for (const entry of recursiveEntries) {
    if (visit(entry)) return true
  }
  return false
}

/**
 * Compiled `/pattern/flags` lorebook-key cache. The recursive
 * `while (matching)` activation loop re-runs `searchMatch` over the same
 * entry keys once per pass, and the regex path used to compile
 * `new RegExp(pattern, flags)` per message × per key × per pass. Compile
 * once, memoized by the raw key string; `lastIndex` resets on retrieval so
 * a cached global/sticky regex behaves exactly like a fresh compile. The
 * bounded-regex helper runs before cache insertion; JS RegExp execution is
 * synchronous and cannot be interrupted once started, so unsafe imported keys
 * must fail before `test()` receives card/chat text.
 * Malformed keys (no leading `/`, no closing `/`, bad pattern) cache `null`
 * — the caller returns false for the whole query, matching the SPA
 * (`lorebook.svelte.ts:155`). Bounded like the SPA's `getCompiledRegex`
 * (drop the oldest entry past 1000).
 */
const compiledLoreKeyRegexCache = new Map<string, RegExp | null>()

function getCompiledLoreKeyRegex(regexString: string): RegExp | null {
  let cached = compiledLoreKeyRegexCache.get(regexString)
  if (cached === undefined) {
    const flagsIdx = regexString.lastIndexOf('/')
    if (!regexString.startsWith('/') || flagsIdx <= 0) {
      cached = null
    } else {
      try {
        cached = compileBoundedRegex(
          regexString.slice(1, flagsIdx),
          regexString.slice(flagsIdx + 1),
          'lorebook useRegex key',
        )
      } catch (err) {
        if (isBoundedRegexError(err)) throw err
        cached = null
      }
    }
    compiledLoreKeyRegexCache.set(regexString, cached)
    if (compiledLoreKeyRegexCache.size > 1000) {
      compiledLoreKeyRegexCache.delete(compiledLoreKeyRegexCache.keys().next().value!)
    }
  }
  if (cached) cached.lastIndex = 0
  return cached
}

/**
 * Ports `searchMatch` from
 * `src/ts/process/lorebook.svelte.ts:97-239`. Walks the last
 * `searchDepth` messages, builds SPA-shaped `\x01{{name}}:body\x01`
 * log prompts, and matches keys against the lowercased message data
 * with the SPA's exact full-word / partial-word and `all`-mode
 * semantics. Concatenates the accumulated `recursivePrompt` layer
 * (SPA `:141-150`) unless the current query opted out via
 * `@@no_recursive_search`.
 *
 * The regex path requires `/pattern/flags`; on malformed input it
 * returns false (SPA `:155`). Matched entries push into `matchLog`
 * so the caller can surface them on the `prompt` SSE event later.
 */
function searchMatch(corpus: SearchableMessageCorpus, arg: SearchArg, matchLog: LoreMatchLogEntry[]): boolean {
  lorebookSearchEntryListInstrumentation.searchMatchCalls++
  const trimmedKeys: string[] = []
  for (const k of arg.keys) {
    const t = k.trim()
    if (t.length > 0) trimmedKeys.push(t)
  }
  if (trimmedKeys.length === 0) return false

  const baseEntries = baseSearchEntriesForDepth(corpus, arg.searchDepth)
  const recursiveEntries = arg.dontSearchWhenRecursive ? NO_SEARCH_ENTRIES : corpus.recursiveEntries

  if (arg.regex) {
    let malformedRegex = false
    const matched = visitSearchEntries(baseEntries, recursiveEntries, (m) => {
      for (const regexString of trimmedKeys) {
        // Compiled once per key string (memoized across messages, passes,
        // and activations) instead of per message × per key × per pass.
        const r = getCompiledLoreKeyRegex(regexString)
        if (!r) {
          malformedRegex = true
          return true
        }
        if (testBoundedRegex(r, m.data, 'lorebook useRegex search text')) {
          matchLog.push({ prompt: m.prompt, source: m.source, activated: regexString })
          return true
        }
      }
      return false
    })
    return matched && !malformedRegex
  }

  const allMode = arg.all ?? false
  let allModeMatched = true
  const lowerKeys = trimmedKeys.map((key) => key.toLocaleLowerCase())
  const compactKeys = lowerKeys.map((key) => key.replace(/ /g, ''))

  const matched = visitSearchEntries(baseEntries, recursiveEntries, (m) => {
    if (arg.fullWordMatching) {
      for (let i = 0; i < trimmedKeys.length; i++) {
        if (m.wordData.includes(lowerKeys[i])) {
          matchLog.push({ prompt: m.strippedPrompt, source: m.source, activated: trimmedKeys[i] })
          if (!allMode) return true
        } else if (allMode) {
          allModeMatched = false
        }
      }
    } else {
      for (let i = 0; i < trimmedKeys.length; i++) {
        if (m.compactData.includes(compactKeys[i])) {
          matchLog.push({ prompt: m.strippedPrompt, source: m.source, activated: trimmedKeys[i] })
          if (!allMode) return true
        } else if (allMode) {
          allModeMatched = false
        }
      }
    }
    return false
  })
  if (matched) return true

  return allMode && allModeMatched
}

export function activateLorebook(input: ActivateLorebookInput): LorebookActivationReport {
  const { database, currentChar, currentChat } = input
  const entries = collectEntries(input)
  const actives: LoreEntryActive[] = []
  const disabledUIPrompts: string[] = []
  const matchLog: LoreMatchLogEntry[] = []
  const activatedIndexes = new Set<number>()
  const searchCorpus = buildSearchableCorpus(currentChat.message ?? [], database, currentChar)

  // Includes the (implicit) first message, matching SPA `:84`.
  const chatLength = (currentChat.message?.length ?? 0) + 1
  const defaultScanDepth = currentChar.loreSettings?.scanDepth ?? database.loreBookDepth ?? 5
  const defaultFullWord = currentChar.loreSettings?.fullWordMatching ?? false
  const recursiveScanning = currentChar.loreSettings?.recursiveScanning ?? true

  // SPA `:82`: `loreSettings.tokenBudget ?? db.loreBookToken`. The SPA
  // migrator (`database.svelte.ts:87`) defaults `loreBookToken` to
  // 800, so we fall back to the same value here when neither override
  // is present.
  const loreBudget = currentChar.loreSettings?.tokenBudget ?? database.loreBookToken ?? 800
  const encoding: TokenEncoding = encodingForModel(input.model)

  // SPA `:263`: walk every unfired entry; if any new entry
  // activates with recursion enabled, flip `matching = true` for
  // another pass against the grown `recursivePrompt` layer.
  // `activatedIndexes.has(i)` bounds the outer loop at O(entries.length)
  // passes since each entry can only contribute once.
  let matching = true
  while (matching) {
    matching = false

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry) continue
      if (activatedIndexes.has(i)) continue
      if (entry.mode === 'folder') continue
      // SPA `:269`: skip entries that have neither always-on nor a key.
      if (!entry.alwaysActive && !entry.key) continue

      let activated = true
      let forceState: 'none' | 'activate' | 'deactivate' = 'none'
      let keepAfterMatch = false
      let dontAfterMatch = false
      let pos: LorePosition = ''
      let depth = 0
      let role: 'system' | 'user' | 'assistant' = 'system'
      let order = entry.insertorder
      let priority = entry.insertorder
      let inject: LoreInject | null = null
      let scanDepth = defaultScanDepth
      let fullWordMatching = defaultFullWord
      let itemRecursive: 'global' | true | false = 'global'
      let dontSearchWhenRecursive = false
      const searchQueries: { keys: string[]; negative: boolean; all?: boolean }[] = []

      // SPA `:294-307` child mirror: take over parent's content+comment
      // and force-activate iff the parent at index j hasn't fired yet.
      if (entry.mode === 'child') {
        activated = false
        for (let j = 0; j < i; j++) {
          if (entries[j] && entries[j].id === entry.id) {
            if (!activatedIndexes.has(j)) {
              entry.comment = entries[j].comment
              entry.content = entries[j].content
              entry.alwaysActive = true
              activated = true
            }
            break
          }
        }
      }

      const stripped = CCardLib.decorator.parse(entry.content, (name, arg) => {
        switch (name) {
          case 'end': {
            pos = 'depth'
            depth = 0
            return
          }
          case 'depth':
          case 'reverse_depth': {
            const int = parseInt(arg[0])
            if (Number.isNaN(int)) return false
            depth = int
            pos = name === 'depth' ? 'depth' : 'reverse_depth'
            return
          }
          case 'role': {
            if (arg[0] === 'user' || arg[0] === 'assistant' || arg[0] === 'system') {
              role = arg[0]
              return
            }
            return false
          }
          case 'position': {
            const value = arg[0]
            if (value.startsWith('pt_')) {
              pos = value as LorePosition
              return
            }
            if (POSITION_NAMED.has(value)) {
              pos = value as LorePosition
              return
            }
            return false
          }
          case 'inject_lore': {
            inject ??= { operation: 'append', location: '', param: '', lore: true }
            inject.location = arg.join(' ')
            inject.lore = true
            return
          }
          case 'inject_at': {
            inject ??= { operation: 'append', location: '', param: '', lore: false }
            inject.location = arg.join(' ')
            inject.lore = false
            return
          }
          case 'inject_replace': {
            inject ??= { operation: 'replace', location: '', param: '', lore: false }
            inject.operation = 'replace'
            inject.param = arg.join(' ')
            return
          }
          case 'inject_prepend': {
            inject ??= { operation: 'prepend', location: '', param: '', lore: false }
            inject.operation = 'prepend'
            inject.param = arg.join(' ')
            return
          }
          case 'ignore_on_max_context': {
            priority = -1000
            return
          }
          case 'priority': {
            const int = parseInt(arg[0])
            if (Number.isNaN(int)) return false
            priority = int
            return
          }
          case 'disable_ui_prompt': {
            if (arg[0] === 'post_history_instructions' || arg[0] === 'system_prompt') {
              disabledUIPrompts.push(arg[0])
              return
            }
            return false
          }
          case 'additional_keys': {
            searchQueries.push({ keys: arg, negative: false })
            return
          }
          case 'exclude_keys': {
            searchQueries.push({ keys: arg, negative: true })
            return
          }
          case 'exclude_keys_all': {
            searchQueries.push({ keys: arg, negative: true, all: true })
            return
          }
          case 'match_full_word': {
            fullWordMatching = true
            return
          }
          case 'match_partial_word': {
            fullWordMatching = false
            return
          }
          case 'scan_depth': {
            const int = parseInt(arg[0])
            if (Number.isNaN(int)) return false
            scanDepth = int
            return
          }
          case 'activate_only_after': {
            const int = parseInt(arg[0])
            if (Number.isNaN(int)) return false
            if (chatLength < int) activated = false
            return
          }
          case 'activate_only_every': {
            const int = parseInt(arg[0])
            if (Number.isNaN(int)) return false
            if (chatLength % int !== 0) activated = false
            return
          }
          case 'is_greeting': {
            const int = parseInt(arg[0])
            if (Number.isNaN(int)) return false
            if ((currentChat.fmIndex ?? -1) + 1 !== int) activated = false
            return
          }
          case 'probability': {
            const int = parseInt(arg[0])
            if (Number.isNaN(int)) return false
            if (Math.random() * 100 > int) activated = false
            return
          }
          case 'activate': {
            forceState = 'activate'
            return
          }
          case 'dont_activate': {
            forceState = 'deactivate'
            return
          }
          case 'keep_activate_after_match': {
            if (readChatVar(currentChat, '__internal_ka_' + loreId(entry)) === 'true') {
              forceState = 'activate'
            } else {
              keepAfterMatch = true
            }
            // `return false` matches SPA `:346`. The decorator line is
            // stripped from the body by ccardlib regardless; the return
            // value only enables a following `@@@` conditional, which is
            // ignored by this parser.
            return false
          }
          case 'dont_activate_after_match': {
            if (readChatVar(currentChat, '__internal_da_' + loreId(entry)) === 'true') {
              forceState = 'deactivate'
            } else {
              dontAfterMatch = true
            }
            return false
          }
          case 'recursive': {
            itemRecursive = true
            return
          }
          case 'unrecursive': {
            itemRecursive = false
            return
          }
          case 'no_recursive_search': {
            dontSearchWhenRecursive = true
            return
          }
          default: {
            return false
          }
        }
      })

      if (activated && forceState === 'none' && !entry.alwaysActive) {
        searchQueries.push({ keys: entry.key.split(','), negative: false })
        if (entry.secondkey && entry.selective) {
          searchQueries.push({ keys: entry.secondkey.split(','), negative: false })
        }
        for (const q of searchQueries) {
          const hit = searchMatch(
            searchCorpus,
            {
              keys: q.keys,
              searchDepth: scanDepth,
              regex: entry.useRegex ?? false,
              fullWordMatching,
              all: q.all,
              dontSearchWhenRecursive,
            },
            matchLog,
          )
          if (q.negative) {
            if (hit) {
              activated = false
              break
            }
          } else {
            if (!hit) {
              activated = false
              break
            }
          }
        }
      }

      const effectiveForceState = forceState as 'none' | 'activate' | 'deactivate'
      if (effectiveForceState === 'activate') activated = true
      else if (effectiveForceState === 'deactivate') activated = false

      if (!activated) continue

      actives.push({
        depth,
        pos,
        prompt: stripped,
        role,
        order,
        priority,
        tokens: tokenize(stripped, encoding),
        source: entry.comment || `lorebook ${i}`,
        inject,
      })
      activatedIndexes.add(i)

      if (keepAfterMatch) {
        writeStickyChatVar(input, '__internal_ka_' + loreId(entry), 'true')
      }
      if (dontAfterMatch) {
        writeStickyChatVar(input, '__internal_da_' + loreId(entry), 'true')
      }

      // SPA `:606-618`: seed the recursive layer with the
      // decorator-stripped body. Per-entry `@@recursive` / `@@unrecursive`
      // overrides the global `loreSettings.recursiveScanning` default.
      const recurse = itemRecursive === 'global' ? recursiveScanning : itemRecursive
      if (recurse) {
        matching = true
        appendRecursiveSearchEntry(searchCorpus, {
          prompt: stripped,
          data: stripped,
          source: entry.comment || `lorebook ${i}`,
        })
      }
    }
  } // end while(matching)

  // Priority desc (SPA :623).
  actives.sort((a, b) => b.priority - a.priority)

  // Budget-aware truncation (SPA :627-635). Strictly sequential
  // through the priority-desc list: an entry that doesn't fit is
  // skipped, but later (lower-priority) entries that *do* fit still
  // slip in. `@@ignore_on_max_context` was already demoted to
  // `priority = -1000` by the decorator, so those entries sit
  // at the tail of this list and get dropped first. Token counts
  // are not refreshed after the `inject_lore` mutations below; this
  // matches the SPA comment at `:649` ("performance over accuracy").
  let usedTokens = 0
  const budgeted = actives.filter((a) => {
    if (usedTokens + a.tokens <= loreBudget) {
      usedTokens += a.tokens
      return true
    }
    return false
  })

  // Order desc (SPA :637).
  budgeted.sort((a, b) => b.order - a.order)

  // Apply lore-targeting injections, then drop the injectors from the
  // active list. Mirrors SPA :641-673; cheap and self-contained, so
  // this keeps placement self-contained.
  const injectors = budgeted.filter((a) => a.inject?.lore)
  const survivors = budgeted.filter((a) => !a.inject?.lore)
  for (const inj of injectors) {
    const target = survivors.find((s) => s.source === inj.inject!.location)
    if (!target) continue
    switch (inj.inject!.operation) {
      case 'append':
        target.prompt += ' ' + inj.prompt
        break
      case 'prepend':
        target.prompt = inj.prompt + ' ' + target.prompt
        break
      case 'replace':
        target.prompt = target.prompt.replace(inj.inject!.param, inj.prompt)
        break
    }
  }

  // Final reverse to match the SPA's return order so downstream
  // template/root slices can append in document order.
  survivors.reverse()

  return {
    actives: survivors,
    disabledUIPrompts,
    matchLog,
  }
}

/**
 * Depth-prompt helpers. The SPA inserts these at the assemble root, not inside
 * the history walk, so they are standalone helpers called between
 * `buildHistoryWindow` and the final render.
 */

export function getDepthPrompts(report: LorebookActivationReport): LoreEntryActive[] {
  return report.actives.filter((a) => (a.pos === 'depth' && a.depth > 0) || a.pos === 'reverse_depth')
}

const POSITION_REGEX = /\{\{position::(.+?)\}\}/g

/**
 * Substitutes `{{position::<name>}}` markers in `text` with the
 * concatenated prompts of every active entry whose `pos` is
 * `pt_<name>`. Mirrors `src/ts/process/promptAssembly/buildLorebookContext.ts:36-63`:
 * iterates up to `maxDepth` times so a `pt_X` slot whose body
 * references another `{{position::Y}}` can resolve transitively;
 * any markers still present after the cap are stripped. Default
 * cap of 5 matches the SPA.
 */
export function resolvePosition(text: string, report: LorebookActivationReport, maxDepth = 5): string {
  let result = text
  for (let i = 0; i < maxDepth; i++) {
    let replaced = false
    result = result.replace(POSITION_REGEX, (_, name: string) => {
      replaced = true
      const posKey = ('pt_' + name) as `pt_${string}`
      return report.actives
        .filter((a) => a.pos === posKey)
        .map((a) => a.prompt)
        .join('\n')
    })
    if (!replaced) break
  }
  return result.replace(POSITION_REGEX, '')
}

/** The slots `buildLorebookContext` distributes activated entries into. */
export interface UnformatedLorebookSlots {
  lorebook: OpenAIChat[]
  description: OpenAIChat[]
  postEverything: OpenAIChat[]
}

export interface LorebookContext {
  /**
   * `{{position::}}` resolver for the template / render walkers. The
   * SPA's injection-lore branch is dead server-side because filtering removes
   * location-targeted injection entries out of `report.actives`), so
   * this just delegates to `resolvePosition` and ignores `loc` —
   * matching `preflight.ts`'s `positionParserFor` so preflight and the
   * final render agree.
   */
  positionParser: (text: string, loc: string) => string
  /** `pos === 'depth' && depth > 0` or `reverse_depth` (via `getDepthPrompts`). */
  depthPrompts: LoreEntryActive[]
}

/**
 * Distribute an activation report into the prompt slots, ported from
 * `src/ts/process/promptAssembly/buildLorebookContext.ts:65-145`:
 *
 *   - `pos === '' && inject === null` → `lorebook`,
 *   - `after_desc` / `personality` / `scenario` → `description` (push);
 *     `before_desc` → `description` (unshift),
 *   - `pos === 'depth' && depth === 0 && role !== 'assistant'` →
 *     `postEverything`, then the `role === 'assistant'` (prefill) ones
 *     after so the assistant prefill stays at the very end,
 *   - `pt_<name>` positions are left for `{{position::}}` resolution.
 *
 * Each row's content is `resolvePosition` then `expandVariables` (with
 * `chara`), mirroring the SPA's `risuChatParser(resolvePosition(...))`.
 * Mutates `unformated`; returns the `positionParser` + `depthPrompts`.
 */
export function buildLorebookContext(
  ctx: ExpandContext,
  currentChar: character,
  report: LorebookActivationReport,
  unformated: UnformatedLorebookSlots,
): LorebookContext {
  const toRow = (lore: LoreEntryActive): OpenAIChat => ({
    role: lore.role,
    content: expandVariables(resolvePosition(lore.prompt, report), {
      ...ctx,
      chara: currentChar,
    }).text,
  })

  for (const lore of report.actives) {
    if (lore.pos === '' && lore.inject === null) {
      unformated.lorebook.push(toRow(lore))
    } else if (lore.pos === 'after_desc' || lore.pos === 'personality' || lore.pos === 'scenario') {
      unformated.description.push(toRow(lore))
    } else if (lore.pos === 'before_desc') {
      unformated.description.unshift(toRow(lore))
    } else if (lore.pos === 'depth' && lore.depth === 0 && lore.role !== 'assistant') {
      unformated.postEverything.push(toRow(lore))
    }
  }

  // Assistant-prefill depth-0 lore lands after the user/system depth-0
  // lore so the prefill stays at the very end (`buildLorebookContext.ts:113-122`).
  for (const lore of report.actives) {
    if (lore.pos === 'depth' && lore.depth === 0 && lore.role === 'assistant') {
      unformated.postEverything.push(toRow(lore))
    }
  }

  return {
    positionParser: (text) => resolvePosition(text, report),
    depthPrompts: getDepthPrompts(report),
  }
}
