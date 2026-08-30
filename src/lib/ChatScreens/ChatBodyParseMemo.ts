import { get } from 'svelte/store'
import { untrack } from 'svelte'
import { ParseMarkdown, type CbsConditions, type simpleCharacterArgument } from '../../ts/parser/parser.svelte'
import { getModules } from '../../ts/process/modules'
import {
  type Chat,
  type customscript,
  type triggerscript,
  type character,
  type Database,
} from '../../ts/storage/database.svelte'
import { getSelectedCharacterOwner } from '../../ts/characterState'
import {
  collectionsResourceState,
  getCharacterResourceOwner,
  getChatMetadataOwnerState,
  settingsResourceState,
} from '../../ts/server/resourceState.svelte'
import { CurrentTriggerIdStore, ReloadGUIPointer, VariableReloadGUIPointer } from '../../ts/stores.svelte'
import { getLLMCache, getLLMCacheMutationEpoch } from '../../ts/translator/translator'
import { getActivePromptPresetRegexScripts } from '../../ts/process/promptPresetRegex'
import {
  normalizeDisplayDependencyValue as normalizeForSignature,
  stableDisplayDependencyJson as stableStringify,
} from '@risuai/protocol/display-source'
import type { DisplaySourceLayer } from '@risuai/protocol/display-source'
import type { DisplaySourcePriority } from '../../ts/server/displaySources'

export type ChatBodyParseMode = 'normal' | 'back' | 'pretranslate' | 'notrim'

export interface ChatBodyParseOwnerReaders {
  characterOwner: (
    charArg: string | simpleCharacterArgument | character | null,
  ) => simpleCharacterArgument | character | undefined
  activeCharacterOwner: () => character | undefined
  activeChatOwner: () => Chat | undefined
  settingsOwner: () => Partial<Database>
  promptPresetOwners: () => Database['promptPresets'] | undefined
}

export function createChatBodyParseOwnerReaders(): ChatBodyParseOwnerReaders {
  const activeChatOwner = (): Chat | undefined => {
    const character = getSelectedCharacterOwner()
    const chat = character?.chats?.[character.chatPage]
    if (!chat?.id || getChatMetadataOwnerState(chat.id)?.chatId !== chat.id) return undefined
    return chat
  }

  return {
    characterOwner: (charArg) => {
      if (typeof charArg === 'string') return getCharacterResourceOwner(charArg)
      return charArg ?? undefined
    },
    activeCharacterOwner: getSelectedCharacterOwner,
    activeChatOwner,
    settingsOwner: () => settingsResourceState.value as Partial<Database>,
    promptPresetOwners: () => collectionsResourceState.values.promptPresets,
  }
}

export interface ChatBodyParseMemoInput {
  data: string
  charArg: string | simpleCharacterArgument | character | null
  owners: ChatBodyParseOwnerReaders
  mode: ChatBodyParseMode
  chatID: number
  cbsConditions: CbsConditions
  displayLayer?: DisplaySourceLayer
  messageId?: string
  name?: string
  streaming?: boolean
  displayPriority?: DisplaySourcePriority
  memoKey?: string
}

export interface ChatBodyCachedOnlyInput {
  data: string
  charArg: string | simpleCharacterArgument | character | null
  owners: ChatBodyParseOwnerReaders
  chatID: number
  cbsConditions: CbsConditions
  fallbackMode: ChatBodyParseMode
  displayLayer?: DisplaySourceLayer
  messageId?: string
  name?: string
  streaming?: boolean
  displayPriority?: DisplaySourcePriority
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

function findCharacterByArg(charArg: ChatBodyParseMemoInput['charArg'], owners: ChatBodyParseOwnerReaders) {
  return owners.characterOwner(charArg)
}

function characterSignature(charArg: ChatBodyParseMemoInput['charArg'], owners: ChatBodyParseOwnerReaders) {
  const char = untrack(() => findCharacterByArg(charArg, owners))
  if (!char) return null

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

function characterSignatureToken(charArg: ChatBodyParseMemoInput['charArg'], owners: ChatBodyParseOwnerReaders) {
  const reloadEpoch = get(ReloadGUIPointer)
  const char = untrack(() => findCharacterByArg(charArg, owners))
  if (!char) {
    return {
      reloadEpoch,
      primitive: null,
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

function serializedCharacterSignature(charArg: ChatBodyParseMemoInput['charArg'], owners: ChatBodyParseOwnerReaders) {
  return cachedSerializedSignature(
    characterSignatureMemo,
    characterSignatureToken(charArg, owners),
    () => characterSignature(charArg, owners),
    'characterSignatureBuilds',
  )
}

function safeGetModules(owners: ChatBodyParseOwnerReaders) {
  try {
    return getModules({ character: owners.activeCharacterOwner(), chat: owners.activeChatOwner() })
  } catch {
    return []
  }
}

function safeGetActivePromptPresetRegexScripts(owners: ChatBodyParseOwnerReaders) {
  try {
    const settings = owners.settingsOwner()
    return getActivePromptPresetRegexScripts(
      {
        ...settings,
        promptPresets: owners.promptPresetOwners() ?? [],
      } as Database,
      owners.activeChatOwner(),
    )
  } catch {
    const settings = owners.settingsOwner()
    return Array.isArray(settings.presetRegex) ? settings.presetRegex : []
  }
}

function moduleSignature(modules: ReturnType<typeof getModules>) {
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

function moduleSignatureToken(modules: ReturnType<typeof getModules>) {
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

function serializedModuleSignature(modules: ReturnType<typeof getModules>) {
  return cachedSerializedSignature(
    moduleSignatureMemo,
    moduleSignatureToken(modules),
    () => moduleSignature(modules),
    'moduleSignatureBuilds',
  )
}

function activeChatSignature(owners: ChatBodyParseOwnerReaders) {
  const char = owners.activeCharacterOwner()
  const chat = owners.activeChatOwner()

  return {
    chaId: char?.chaId,
    chatPage: char?.chatPage,
    chatId: chat?.id,
    chatModules: chat?.modules,
    scriptstate: normalizeForSignature(chat?.scriptstate ?? null),
  }
}

function activeChatSignatureToken(owners: ChatBodyParseOwnerReaders) {
  const char = owners.activeCharacterOwner()
  const chat = owners.activeChatOwner()

  return {
    reloadEpoch: get(ReloadGUIPointer),
    chaId: char?.chaId,
    chatPage: char?.chatPage,
    chatId: chat?.id,
    chatModules: scalarListSignature(chat?.modules),
    scriptstate: normalizeForSignature(chat?.scriptstate ?? null),
  }
}

function serializedActiveChatSignature(owners: ChatBodyParseOwnerReaders) {
  return cachedSerializedSignature(
    activeChatSignatureMemo,
    activeChatSignatureToken(owners),
    () => activeChatSignature(owners),
    'activeChatSignatureBuilds',
  )
}

function moduleRegexSignature(modules: ReturnType<typeof getModules>) {
  return modules.flatMap((module) => scriptListSignature(module?.regex))
}

function moduleAssetsSignature(modules: ReturnType<typeof getModules>) {
  return modules.flatMap((module) => module?.assets ?? [])
}

function parseSettingsSignature(owners: ChatBodyParseOwnerReaders, modules: ReturnType<typeof getModules>) {
  const db = owners.settingsOwner()
  return {
    reloadEpoch: get(ReloadGUIPointer),
    currentTriggerId: get(CurrentTriggerIdStore),
    globalRegex: untrackedScriptListSignature(() => db.globalscript),
    presetRegex: untrackedScriptListSignature(() => safeGetActivePromptPresetRegexScripts(owners)),
    moduleRegex: untrack(() => moduleRegexSignature(modules)),
    moduleAssets: moduleAssetsSignature(modules),
    hideAllImages: db.hideAllImages,
    customQuotes: db.customQuotes,
    customQuotesData: db.customQuotesData,
    unformatQuotes: db.unformatQuotes,
    paragraphBreakBySentences: db.paragraphBreakBySentences ?? false,
    paragraphBreakSentenceCount: db.paragraphBreakSentenceCount ?? 3,
    blockquoteStyling: db.blockquoteStyling,
    assetWidth: db.assetWidth,
    assetMaxDifference: db.assetMaxDifference,
    legacyMediaFindings: db.legacyMediaFindings,
    dynamicAssets: db.dynamicAssets,
    dynamicAssetsEditDisplay: db.dynamicAssetsEditDisplay,
    returnCSSError: db.returnCSSError,
  }
}

function settingsSignatureToken(owners: ChatBodyParseOwnerReaders, modules: ReturnType<typeof getModules>) {
  const db = owners.settingsOwner()
  return {
    reloadEpoch: get(ReloadGUIPointer),
    currentTriggerId: get(CurrentTriggerIdStore),
    globalRegex: untrackedScriptListSignature(() => db.globalscript),
    presetRegex: untrackedScriptListSignature(() => safeGetActivePromptPresetRegexScripts(owners)),
    moduleRegex: untrack(() => moduleRegexSignature(modules)),
    moduleAssets: tupleListSignature(moduleAssetsSignature(modules)),
    hideAllImages: db.hideAllImages,
    customQuotes: db.customQuotes,
    customQuotesData: db.customQuotesData ?? [],
    unformatQuotes: db.unformatQuotes,
    paragraphBreakBySentences: db.paragraphBreakBySentences ?? false,
    paragraphBreakSentenceCount: db.paragraphBreakSentenceCount ?? 3,
    blockquoteStyling: db.blockquoteStyling,
    assetWidth: db.assetWidth,
    assetMaxDifference: db.assetMaxDifference,
    legacyMediaFindings: db.legacyMediaFindings,
    dynamicAssets: db.dynamicAssets,
    dynamicAssetsEditDisplay: db.dynamicAssetsEditDisplay,
    returnCSSError: db.returnCSSError,
  }
}

function serializedSettingsSignature(owners: ChatBodyParseOwnerReaders, modules: ReturnType<typeof getModules>) {
  return cachedSerializedSignature(
    settingsSignatureMemo,
    settingsSignatureToken(owners, modules),
    () => parseSettingsSignature(owners, modules),
    'settingsSignatureBuilds',
  )
}

export function getChatBodyParseMemoKey(input: ChatBodyParseMemoInput): string {
  return untrack(() => {
    debugStats.parseKeyBuilds += 1
    const modules = safeGetModules(input.owners)
    return `{"activeChat":${serializedActiveChatSignature(input.owners)},"cbsConditions":${stableFragment(
      input.cbsConditions ?? {},
    )},"character":${serializedCharacterSignature(input.charArg, input.owners)},"chatID":${stableFragment(
      input.chatID,
    )},"data":${stableFragment(input.data ?? '')},"kind":"chat-body-parse","mode":${stableFragment(
      input.mode,
    )},"displayLayer":${stableFragment(input.displayLayer)},"messageId":${stableFragment(
      input.messageId,
    )},"name":${stableFragment(input.name)},"modules":${serializedModuleSignature(modules)},"settings":${serializedSettingsSignature(input.owners, modules)},"streaming":${stableFragment(
      input.streaming,
    )},"variableReloadEpoch":${stableFragment(get(VariableReloadGUIPointer))}}`
  })
}

function getTranslateSettingsSignature(owners: ChatBodyParseOwnerReaders) {
  const db = owners.settingsOwner()
  const chat = owners.activeChatOwner()
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
  input: Pick<ChatBodyCachedOnlyInput, 'fallbackMode' | 'owners'>,
): ChatBodyParseMode | 'raw' {
  const db = input.owners.settingsOwner()
  return db.translateBeforeHTMLFormatting ? 'raw' : db.legacyTranslation ? input.fallbackMode : 'pretranslate'
}

export function getChatBodyCachedOnlyLlmDetectionKey(input: ChatBodyCachedOnlyInput): string {
  const db = input.owners.settingsOwner()
  const detectionMode = getChatBodyCachedOnlyLlmDetectionMode(input)
  const parseKey =
    detectionMode === 'raw'
      ? undefined
      : (input.cachedOnlyParseKey ??
        getChatBodyParseMemoKey({
          data: input.data,
          charArg: input.charArg,
          owners: input.owners,
          mode: detectionMode,
          chatID: input.chatID,
          cbsConditions: input.cbsConditions,
          displayLayer: input.displayLayer,
          messageId: input.messageId,
          name: input.name,
          streaming: input.streaming,
          displayPriority: input.displayPriority,
        }))

  const parseKeyFragment = detectionMode === 'raw' ? '' : `,"parseKey":${stableFragment(parseKey ?? '')}`
  const rawDataFragment = db.translateBeforeHTMLFormatting ? `,"rawData":${stableFragment(input.data ?? '')}` : ''

  return `{"detectionMode":${stableFragment(
    detectionMode,
  )},"kind":"chat-body-llm-cache-exists"${parseKeyFragment}${rawDataFragment},"translateSettings":${stableFragment(
    getTranslateSettingsSignature(input.owners),
  )}}`
}

export function memoizedChatBodyParse(input: ChatBodyParseMemoInput): Promise<string> {
  return untrack(() => {
    const key = input.memoKey ?? getChatBodyParseMemoKey(input)
    const cached = parseMemo.get(key)
    if (cached) {
      return refresh(parseMemo, key, cached)
    }

    const promise = ParseMarkdown(
      input.data,
      input.owners.characterOwner(input.charArg) ?? null,
      input.mode,
      input.chatID,
      input.cbsConditions,
      {
        layer: input.displayLayer,
        messageId: input.messageId,
        name: input.name,
        streaming: input.streaming,
        priority: input.displayPriority,
      },
    ).catch((error) => {
      parseMemo.delete(key)
      throw error
    })
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
    const db = input.owners.settingsOwner()
    const cacheKey = db.translateBeforeHTMLFormatting
      ? input.data
      : await memoizedChatBodyParse({
          data: input.data,
          charArg: input.charArg,
          owners: input.owners,
          mode: getChatBodyCachedOnlyLlmDetectionMode(input) as ChatBodyParseMode,
          chatID: input.chatID,
          cbsConditions: input.cbsConditions,
          displayLayer: input.displayLayer,
          messageId: input.messageId,
          name: input.name,
          streaming: input.streaming,
          displayPriority: input.displayPriority,
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
