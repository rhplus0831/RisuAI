import { get } from 'svelte/store'
import { ParseMarkdown, type CbsConditions, type simpleCharacterArgument } from '../../ts/parser/parser.svelte'
import { getModules } from '../../ts/process/modules'
import type { customscript, triggerscript, character, Database } from '../../ts/storage/database.svelte'
import { getCurrentChat } from '../../ts/storage/database.svelte'
import { DBState, CurrentTriggerIdStore, ReloadGUIPointer, selectedCharID } from '../../ts/stores.svelte'
import { getLLMCache, getLLMCacheMutationEpoch } from '../../ts/translator/translator'

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

const parseMemo = new Map<string, Promise<string>>()
const llmDetectionMemo = new Map<string, Promise<boolean>>()
const characterSignatureMemo = new Map<string, string>()
const activeChatSignatureMemo = new Map<string, string>()
const moduleSignatureMemo = new Map<string, string>()
const settingsSignatureMemo = new Map<string, string>()

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
    id: script.id,
    comment: script.comment,
    in: script.in,
    out: script.out,
    type: script.type,
    flag: script.flag,
    ableFlag: script.ableFlag,
  }
}

function triggerSignature(trigger?: triggerscript | null) {
  if (!trigger) return null
  return normalizeForSignature(trigger)
}

function scriptListSignature(scripts?: readonly customscript[] | null) {
  return (scripts ?? []).map(scriptSignature)
}

function triggerListSignature(triggers?: readonly triggerscript[] | null) {
  return (triggers ?? []).map(triggerSignature)
}

function tupleListSignature(tuples?: readonly unknown[] | null) {
  return (tuples ?? []).map((tuple) =>
    Array.isArray(tuple) ? tuple.map((value) => normalizeForSignature(value)) : normalizeForSignature(tuple),
  )
}

function findCharacterByArg(charArg: ChatBodyParseMemoInput['charArg']) {
  if (!charArg || typeof charArg !== 'string') {
    return charArg
  }
  return DBState.db?.characters?.find((char: character) => char?.chaId === charArg) ?? charArg
}

function characterSignature(charArg: ChatBodyParseMemoInput['charArg']) {
  const char = findCharacterByArg(charArg)
  if (!char || typeof char === 'string') {
    return char
  }

  return {
    type: char.type,
    chaId: char.chaId,
    customscript: (char.customscript ?? []).map(scriptSignature),
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
  const char = findCharacterByArg(charArg)
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
    customscript: scriptListSignature(char.customscript),
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

function moduleSignature(modules = safeGetModules()) {
  try {
    return modules.map((module) => ({
      id: module?.id,
      namespace: module?.namespace,
      regex: scriptListSignature(module?.regex),
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
      regex: scriptListSignature(module?.regex),
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
  const char = DBState.db?.characters?.[selectedChar]
  let chatId: string | undefined
  let chatModules: unknown
  try {
    const currentChat = getCurrentChat()
    chatId = currentChat?.id
    chatModules = currentChat?.modules
  } catch {
    chatId = char?.chats?.[char?.chatPage]?.id
    chatModules = char?.chats?.[char?.chatPage]?.modules
  }

  return {
    selectedChar,
    chaId: char?.chaId,
    chatPage: char?.chatPage,
    chatId,
    chatModules,
  }
}

function activeChatSignatureToken() {
  const selectedChar = get(selectedCharID)
  const char = DBState.db?.characters?.[selectedChar]
  let chatId: string | undefined
  let chatModules: unknown
  try {
    const currentChat = getCurrentChat()
    chatId = currentChat?.id
    chatModules = currentChat?.modules
  } catch {
    chatId = char?.chats?.[char?.chatPage]?.id
    chatModules = char?.chats?.[char?.chatPage]?.modules
  }

  return {
    reloadEpoch: get(ReloadGUIPointer),
    selectedChar,
    chaId: char?.chaId,
    chatPage: char?.chatPage,
    chatId,
    chatModules: scalarListSignature(chatModules),
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
  const db = DBState.db as Partial<Database>
  return {
    reloadEpoch: get(ReloadGUIPointer),
    currentTriggerId: get(CurrentTriggerIdStore),
    presetRegex: scriptListSignature(db.presetRegex),
    moduleRegex: moduleRegexSignature(modules),
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
  const db = DBState.db as Partial<Database>
  return {
    reloadEpoch: get(ReloadGUIPointer),
    currentTriggerId: get(CurrentTriggerIdStore),
    presetRegex: scriptListSignature(db.presetRegex),
    moduleRegex: moduleRegexSignature(modules),
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
  debugStats.parseKeyBuilds += 1
  const modules = safeGetModules()
  return `{"activeChat":${serializedActiveChatSignature()},"cbsConditions":${stableFragment(
    input.cbsConditions ?? {},
  )},"character":${serializedCharacterSignature(input.charArg)},"chatID":${stableFragment(
    input.chatID,
  )},"data":${stableFragment(input.data ?? '')},"kind":"chat-body-parse","mode":${stableFragment(
    input.mode,
  )},"modules":${serializedModuleSignature(modules)},"settings":${serializedSettingsSignature(modules)}}`
}

function getTranslateSettingsSignature() {
  const db = DBState.db as Partial<Database>
  return {
    autoTranslate: db.autoTranslate,
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
  const db = DBState.db as Partial<Database>
  return db.translateBeforeHTMLFormatting ? 'raw' : db.legacyTranslation ? input.fallbackMode : 'pretranslate'
}

export function getChatBodyCachedOnlyLlmDetectionKey(input: ChatBodyCachedOnlyInput): string {
  const db = DBState.db as Partial<Database>
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
}

export async function getChatBodyCachedOnlyLlmDecision(input: ChatBodyCachedOnlyInput): Promise<boolean> {
  const key = input.detectionKey ?? getChatBodyCachedOnlyLlmDetectionKey(input)
  const cached = llmDetectionMemo.get(key)
  if (cached) {
    return refresh(llmDetectionMemo, key, cached)
  }

  const promise = (async () => {
    const db = DBState.db as Partial<Database>
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
