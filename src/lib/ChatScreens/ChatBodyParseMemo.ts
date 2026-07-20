import { get } from 'svelte/store'
import { untrack } from 'svelte'
import { ParseMarkdown, type CbsConditions, type simpleCharacterArgument } from '../../ts/parser/parser.svelte'
import { getModules } from '../../ts/process/modules'
import {
  getCurrentChat,
  getDatabase,
  type customscript,
  type triggerscript,
  type character,
  type Database,
} from '../../ts/storage/database.svelte'
import {
  CurrentTriggerIdStore,
  ReloadGUIPointer,
  VariableReloadGUIPointer,
  selectedCharID,
} from '../../ts/stores.svelte'
import { getLLMCache, getLLMCacheMutationEpoch } from '../../ts/translator/translator'
import { getActivePromptPresetRegexScripts } from '../../ts/process/promptPresetRegex'

type ChatBodyParseMode = 'normal' | 'back' | 'pretranslate' | 'notrim'

interface ChatBodyParseMemoInput {
  data: string
  charArg: string | simpleCharacterArgument | character | null
  mode: ChatBodyParseMode
  chatID: number
  cbsConditions: CbsConditions
  memoKey?: string
}

interface ChatBodyCachedOnlyInput {
  data: string
  charArg: string | simpleCharacterArgument | character | null
  chatID: number
  cbsConditions: CbsConditions
  fallbackMode: ChatBodyParseMode
  cachedOnlyParseKey?: string
  detectionKey?: string
}

const PARSE_MEMO_LIMIT = 180
const LLM_DETECTION_MEMO_LIMIT = 180
const SIGNATURE_MEMO_LIMIT = 48
const LARGE_SIGNATURE_STRING_LIMIT = 512
const SIGNATURE_STRING_HASH_MEMO_LIMIT = 256

const parseMemo = new Map<string, Promise<string>>()
const llmDetectionMemo = new Map<string, Promise<boolean>>()
const characterSignatureMemo = new Map<string, string>()
const activeChatSignatureMemo = new Map<string, string>()
const moduleSignatureMemo = new Map<string, string>()
const settingsSignatureMemo = new Map<string, string>()
const signatureStringHashMemo = new Map<string, string>()

const debugStats = {
  parseKeyBuilds: 0,
  characterSignatureBuilds: 0,
  activeChatSignatureBuilds: 0,
  moduleSignatureBuilds: 0,
  settingsSignatureBuilds: 0,
}

function remember<T>(memo: Map<string, T>, key: string, value: T, limit: number) {
  memo.set(key, value)
  while (memo.size > limit) {
    const oldest = memo.keys().next().value
    if (oldest === undefined) break
    memo.delete(oldest)
  }
}

function refresh<T>(memo: Map<string, T>, key: string, value: T) {
  memo.delete(key)
  memo.set(key, value)
  return value
}

function normalizeForSignature(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForSignature(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const normalized: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const next = (value as Record<string, unknown>)[key]
    if (next === undefined || typeof next === 'function') {
      continue
    }
    normalized[key] = normalizeForSignature(next)
  }
  return normalized
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForSignature(value))
}

function stableFragment(value: unknown): string {
  return stableStringify(value) ?? 'null'
}

function signatureStringFragment(value: string): string {
  if (value.length <= LARGE_SIGNATURE_STRING_LIMIT) return value
  const cached = signatureStringHashMemo.get(value)
  if (cached !== undefined) {
    return refresh(signatureStringHashMemo, value, cached)
  }

  let hash = 0x811c9dc5
  let check = 0x1505
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    hash ^= code
    hash = Math.imul(hash, 0x01000193)
    check = Math.imul(check, 33) ^ code
  }
  const hashed = `${value.length}:${(hash >>> 0).toString(36)}:${(check >>> 0).toString(36)}`
  remember(signatureStringHashMemo, value, hashed, SIGNATURE_STRING_HASH_MEMO_LIMIT)
  return hashed
}

function compactForSignature(value: unknown): unknown {
  if (typeof value === 'string') {
    return signatureStringFragment(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => compactForSignature(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const normalized: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const next = (value as Record<string, unknown>)[key]
    if (next === undefined || typeof next === 'function') {
      continue
    }
    normalized[key] = compactForSignature(next)
  }
  return normalized
}

function scalarListSignature(value: unknown) {
  return Array.isArray(value) ? value.map((item) => normalizeForSignature(item)) : []
}

function cachedSerializedSignature(
  memo: Map<string, string>,
  token: unknown,
  build: () => unknown,
  stat: keyof Omit<typeof debugStats, 'parseKeyBuilds'>,
): string {
  const key = stableFragment(token)
  const cached = memo.get(key)
  if (cached !== undefined) {
    return refresh(memo, key, cached)
  }

  debugStats[stat] += 1
  const serialized = stableFragment(build())
  remember(memo, key, serialized, SIGNATURE_MEMO_LIMIT)
  return serialized
}

function scriptSignature(script?: customscript | null) {
  if (!script) return null
  return {
    id: compactForSignature(script.id),
    comment: compactForSignature(script.comment),
    in: compactForSignature(script.in),
    out: compactForSignature(script.out),
    type: compactForSignature(script.type),
    flag: compactForSignature(script.flag),
    ableFlag: script.ableFlag,
  }
}

function triggerSignature(trigger?: triggerscript | null) {
  if (!trigger) return null
  return compactForSignature(trigger)
}

function scriptListSignature(scripts?: readonly customscript[] | null) {
  return (scripts ?? []).map(scriptSignature)
}

function untrackedScriptListSignature(readScripts: () => readonly customscript[] | null | undefined) {
  return untrack(() => scriptListSignature(readScripts()))
}

function triggerListSignature(triggers?: readonly triggerscript[] | null) {
  return (triggers ?? []).map(triggerSignature)
}

function tupleListSignature(tuples?: readonly unknown[] | null) {
  return (tuples ?? []).map((tuple) =>
    Array.isArray(tuple) ? tuple.map((value) => compactForSignature(value)) : compactForSignature(tuple),
  )
}

function findCharacterByArg(charArg: ChatBodyParseMemoInput['charArg']) {
  if (!charArg || typeof charArg !== 'string') {
    return charArg
  }
  return getDatabase().characters?.find((char: character) => char?.chaId === charArg) ?? charArg
}

function characterSignature(charArg: ChatBodyParseMemoInput['charArg']) {
  const char = untrack(() => findCharacterByArg(charArg))
  if (!char || typeof char === 'string') {
    return char
  }

  return {
    type: char.type,
    chaId: char.chaId,
    customscript: untrackedScriptListSignature(() => char.customscript),
    triggerscript: (char.triggerscript ?? []).map(triggerSignature),
    additionalAssets: char.additionalAssets ?? [],
    emotionImages: char.emotionImages ?? [],
    virtualscript: char.virtualscript,
    modules: 'modules' in char ? char.modules : undefined,
    scriptstate: 'scriptstate' in char ? char.scriptstate : undefined,
    defaultVariables: 'defaultVariables' in char ? char.defaultVariables : undefined,
  }
}

function characterSignatureToken(charArg: ChatBodyParseMemoInput['charArg']) {
  const reloadEpoch = get(ReloadGUIPointer)
  const char = untrack(() => findCharacterByArg(charArg))
  if (!char || typeof char === 'string') {
    return {
      reloadEpoch,
      primitive: char ?? null,
    }
  }

  const modules = 'modules' in char ? char.modules : undefined
  return {
    reloadEpoch,
    type: char.type,
    chaId: char.chaId,
    customscript: untrackedScriptListSignature(() => char.customscript),
    triggerscript: triggerListSignature(char.triggerscript),
    additionalAssets: tupleListSignature(char.additionalAssets),
    emotionImages: tupleListSignature(char.emotionImages),
    virtualscript: char.virtualscript,
    modules: scalarListSignature(modules),
    scriptstate: normalizeForSignature('scriptstate' in char ? char.scriptstate : undefined),
    defaultVariables: 'defaultVariables' in char ? char.defaultVariables : undefined,
  }
}

function serializedCharacterSignature(charArg: ChatBodyParseMemoInput['charArg']) {
  return cachedSerializedSignature(
    characterSignatureMemo,
    characterSignatureToken(charArg),
    () => characterSignature(charArg),
    'characterSignatureBuilds',
  )
}

function safeGetModules() {
  try {
    return getModules()
  } catch {
    return []
  }
}

function safeGetActivePromptPresetRegexScripts() {
  try {
    return getActivePromptPresetRegexScripts(getDatabase())
  } catch {
    const db = getDatabase() as Partial<Database>
    return Array.isArray(db.presetRegex) ? db.presetRegex : []
  }
}

function moduleSignature(modules = safeGetModules()) {
  try {
    return modules.map((module) => ({
      id: module?.id,
      namespace: module?.namespace,
      regex: untrackedScriptListSignature(() => module?.regex),
      assets: module?.assets ?? [],
      trigger: triggerListSignature(module?.trigger),
      lowLevelAccess: module?.lowLevelAccess,
      customModuleToggle: module?.customModuleToggle,
    }))
  } catch {
    return []
  }
}

function moduleSignatureToken(modules = safeGetModules()) {
  return {
    reloadEpoch: get(ReloadGUIPointer),
    modules: modules.map((module) => ({
      id: module?.id,
      namespace: module?.namespace,
      regex: untrackedScriptListSignature(() => module?.regex),
      assets: tupleListSignature(module?.assets),
      trigger: triggerListSignature(module?.trigger),
      lowLevelAccess: module?.lowLevelAccess,
      customModuleToggle: module?.customModuleToggle,
    })),
  }
}

function serializedModuleSignature(modules = safeGetModules()) {
  return cachedSerializedSignature(
    moduleSignatureMemo,
    moduleSignatureToken(modules),
    () => moduleSignature(modules),
    'moduleSignatureBuilds',
  )
}

function activeChatSignature() {
  const selectedChar = get(selectedCharID)
  const char = getDatabase().characters?.[selectedChar]
  let chatId: string | undefined
  let chatModules: unknown
  let scriptstate: unknown
  try {
    const currentChat = getCurrentChat()
    chatId = currentChat?.id
    chatModules = currentChat?.modules
    scriptstate = currentChat?.scriptstate
  } catch {
    const fallbackChat = char?.chats?.[char?.chatPage]
    chatId = fallbackChat?.id
    chatModules = fallbackChat?.modules
    scriptstate = fallbackChat?.scriptstate
  }

  return {
    selectedChar,
    chaId: char?.chaId,
    chatPage: char?.chatPage,
    chatId,
    chatModules,
    scriptstate: normalizeForSignature(scriptstate ?? null),
  }
}

function activeChatSignatureToken() {
  const selectedChar = get(selectedCharID)
  const char = getDatabase().characters?.[selectedChar]
  let chatId: string | undefined
  let chatModules: unknown
  let scriptstate: unknown
  try {
    const currentChat = getCurrentChat()
    chatId = currentChat?.id
    chatModules = currentChat?.modules
    scriptstate = currentChat?.scriptstate
  } catch {
    const fallbackChat = char?.chats?.[char?.chatPage]
    chatId = fallbackChat?.id
    chatModules = fallbackChat?.modules
    scriptstate = fallbackChat?.scriptstate
  }

  return {
    reloadEpoch: get(ReloadGUIPointer),
    selectedChar,
    chaId: char?.chaId,
    chatPage: char?.chatPage,
    chatId,
    chatModules: scalarListSignature(chatModules),
    scriptstate: normalizeForSignature(scriptstate ?? null),
  }
}

function serializedActiveChatSignature() {
  return cachedSerializedSignature(
    activeChatSignatureMemo,
    activeChatSignatureToken(),
    activeChatSignature,
    'activeChatSignatureBuilds',
  )
}

function moduleRegexSignature(modules = safeGetModules()) {
  return modules.flatMap((module) => scriptListSignature(module?.regex))
}

function moduleAssetsSignature(modules = safeGetModules()) {
  return modules.flatMap((module) => module?.assets ?? [])
}

function parseSettingsSignature(modules = safeGetModules()) {
  const db = getDatabase() as Partial<Database>
  return {
    reloadEpoch: get(ReloadGUIPointer),
    currentTriggerId: get(CurrentTriggerIdStore),
    globalRegex: untrackedScriptListSignature(() => db.globalscript),
    presetRegex: untrackedScriptListSignature(() => safeGetActivePromptPresetRegexScripts()),
    moduleRegex: untrack(() => moduleRegexSignature(modules)),
    moduleAssets: moduleAssetsSignature(modules),
    hideAllImages: db.hideAllImages,
    customQuotes: db.customQuotes,
    customQuotesData: db.customQuotesData,
    unformatQuotes: db.unformatQuotes,
    blockquoteStyling: db.blockquoteStyling,
    assetWidth: db.assetWidth,
    assetMaxDifference: db.assetMaxDifference,
    legacyMediaFindings: db.legacyMediaFindings,
    dynamicAssets: db.dynamicAssets,
    dynamicAssetsEditDisplay: db.dynamicAssetsEditDisplay,
    returnCSSError: db.returnCSSError,
  }
}

function settingsSignatureToken(modules = safeGetModules()) {
  const db = getDatabase() as Partial<Database>
  return {
    reloadEpoch: get(ReloadGUIPointer),
    currentTriggerId: get(CurrentTriggerIdStore),
    globalRegex: untrackedScriptListSignature(() => db.globalscript),
    presetRegex: untrackedScriptListSignature(() => safeGetActivePromptPresetRegexScripts()),
    moduleRegex: untrack(() => moduleRegexSignature(modules)),
    moduleAssets: tupleListSignature(moduleAssetsSignature(modules)),
    hideAllImages: db.hideAllImages,
    customQuotes: db.customQuotes,
    customQuotesData: db.customQuotesData ?? [],
    unformatQuotes: db.unformatQuotes,
    blockquoteStyling: db.blockquoteStyling,
    assetWidth: db.assetWidth,
    assetMaxDifference: db.assetMaxDifference,
    legacyMediaFindings: db.legacyMediaFindings,
    dynamicAssets: db.dynamicAssets,
    dynamicAssetsEditDisplay: db.dynamicAssetsEditDisplay,
    returnCSSError: db.returnCSSError,
  }
}

function serializedSettingsSignature(modules = safeGetModules()) {
  return cachedSerializedSignature(
    settingsSignatureMemo,
    settingsSignatureToken(modules),
    () => parseSettingsSignature(modules),
    'settingsSignatureBuilds',
  )
}

export function getChatBodyParseMemoKey(input: ChatBodyParseMemoInput): string {
  return untrack(() => {
    debugStats.parseKeyBuilds += 1
    const modules = safeGetModules()
    return `{"activeChat":${serializedActiveChatSignature()},"cbsConditions":${stableFragment(
      input.cbsConditions ?? {},
    )},"character":${serializedCharacterSignature(input.charArg)},"chatID":${stableFragment(
      input.chatID,
    )},"data":${stableFragment(input.data ?? '')},"kind":"chat-body-parse","mode":${stableFragment(
      input.mode,
    )},"modules":${serializedModuleSignature(modules)},"settings":${serializedSettingsSignature(
      modules,
    )},"variableReloadEpoch":${stableFragment(get(VariableReloadGUIPointer))}}`
  })
}

function getTranslateSettingsSignature() {
  const db = getDatabase() as Partial<Database>
  const chat = getCurrentChat()
  return {
    autoTranslate: chat?.autoTranslate,
    autoTranslateBotOnly: chat?.autoTranslateBotOnly,
    autoTranslateCachedOnly: db.autoTranslateCachedOnly,
    translatorType: db.translatorType,
    translator: db.translator,
    translatorInputLanguage: db.translatorInputLanguage,
    legacyTranslation: db.legacyTranslation,
    translateBeforeHTMLFormatting: db.translateBeforeHTMLFormatting,
    cacheEpoch: getLLMCacheMutationEpoch(),
  }
}

export function getChatBodyCachedOnlyLlmDetectionMode(
  input: Pick<ChatBodyCachedOnlyInput, 'fallbackMode'>,
): ChatBodyParseMode | 'raw' {
  const db = getDatabase() as Partial<Database>
  return db.translateBeforeHTMLFormatting ? 'raw' : db.legacyTranslation ? input.fallbackMode : 'pretranslate'
}

export function getChatBodyCachedOnlyLlmDetectionKey(input: ChatBodyCachedOnlyInput): string {
  const db = getDatabase() as Partial<Database>
  const detectionMode = getChatBodyCachedOnlyLlmDetectionMode(input)
  const parseKey =
    detectionMode === 'raw'
      ? undefined
      : (input.cachedOnlyParseKey ??
        getChatBodyParseMemoKey({
          data: input.data,
          charArg: input.charArg,
          mode: detectionMode,
          chatID: input.chatID,
          cbsConditions: input.cbsConditions,
        }))

  const parseKeyFragment = detectionMode === 'raw' ? '' : `,"parseKey":${stableFragment(parseKey ?? '')}`
  const rawDataFragment = db.translateBeforeHTMLFormatting ? `,"rawData":${stableFragment(input.data ?? '')}` : ''

  return `{"detectionMode":${stableFragment(
    detectionMode,
  )},"kind":"chat-body-llm-cache-exists"${parseKeyFragment}${rawDataFragment},"translateSettings":${stableFragment(
    getTranslateSettingsSignature(),
  )}}`
}

export function memoizedChatBodyParse(input: ChatBodyParseMemoInput): Promise<string> {
  return untrack(() => {
    const key = input.memoKey ?? getChatBodyParseMemoKey(input)
    const cached = parseMemo.get(key)
    if (cached) {
      return refresh(parseMemo, key, cached)
    }

    const promise = ParseMarkdown(input.data, input.charArg, input.mode, input.chatID, input.cbsConditions).catch(
      (error) => {
        parseMemo.delete(key)
        throw error
      },
    )
    remember(parseMemo, key, promise, PARSE_MEMO_LIMIT)
    return promise
  })
}

export async function getChatBodyCachedOnlyLlmDecision(input: ChatBodyCachedOnlyInput): Promise<boolean> {
  const key = input.detectionKey ?? getChatBodyCachedOnlyLlmDetectionKey(input)
  const cached = llmDetectionMemo.get(key)
  if (cached) {
    return refresh(llmDetectionMemo, key, cached)
  }

  const promise = (async () => {
    const db = getDatabase() as Partial<Database>
    const cacheKey = db.translateBeforeHTMLFormatting
      ? input.data
      : await memoizedChatBodyParse({
          data: input.data,
          charArg: input.charArg,
          mode: getChatBodyCachedOnlyLlmDetectionMode(input) as ChatBodyParseMode,
          chatID: input.chatID,
          cbsConditions: input.cbsConditions,
          memoKey: input.cachedOnlyParseKey,
        })
    return (await getLLMCache(cacheKey)) !== null
  })().catch((error) => {
    llmDetectionMemo.delete(key)
    throw error
  })

  remember(llmDetectionMemo, key, promise, LLM_DETECTION_MEMO_LIMIT)
  return promise
}

export function clearChatBodyParseMemo() {
  parseMemo.clear()
  llmDetectionMemo.clear()
  characterSignatureMemo.clear()
  activeChatSignatureMemo.clear()
  moduleSignatureMemo.clear()
  settingsSignatureMemo.clear()
  signatureStringHashMemo.clear()
  resetChatBodyParseMemoDebugStats()
}

export function getChatBodyParseMemoStats() {
  return {
    parseEntries: parseMemo.size,
    llmDetectionEntries: llmDetectionMemo.size,
    characterSignatureEntries: characterSignatureMemo.size,
    activeChatSignatureEntries: activeChatSignatureMemo.size,
    moduleSignatureEntries: moduleSignatureMemo.size,
    settingsSignatureEntries: settingsSignatureMemo.size,
  }
}

export function getChatBodyParseMemoDebugStats() {
  return { ...debugStats }
}

export function resetChatBodyParseMemoDebugStats() {
  debugStats.parseKeyBuilds = 0
  debugStats.characterSignatureBuilds = 0
  debugStats.activeChatSignatureBuilds = 0
  debugStats.moduleSignatureBuilds = 0
  debugStats.settingsSignatureBuilds = 0
}
