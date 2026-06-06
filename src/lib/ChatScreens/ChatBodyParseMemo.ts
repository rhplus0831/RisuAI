import { get } from 'svelte/store'
import {
  ParseMarkdown,
  type CbsConditions,
  type simpleCharacterArgument,
} from '../../ts/parser/parser.svelte'
import { getModuleAssets, getModuleRegexScripts, getModules } from '../../ts/process/modules'
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
}

interface ChatBodyCachedOnlyInput {
  data: string
  charArg: string | simpleCharacterArgument | character | null
  chatID: number
  cbsConditions: CbsConditions
  fallbackMode: ChatBodyParseMode
}

const PARSE_MEMO_LIMIT = 180
const LLM_DETECTION_MEMO_LIMIT = 180

const parseMemo = new Map<string, Promise<string>>()
const llmDetectionMemo = new Map<string, Promise<boolean>>()

function remember<T>(memo: Map<string, Promise<T>>, key: string, value: Promise<T>, limit: number) {
  memo.set(key, value)
  while (memo.size > limit) {
    const oldest = memo.keys().next().value
    if (oldest === undefined) break
    memo.delete(oldest)
  }
}

function refresh<T>(memo: Map<string, Promise<T>>, key: string, value: Promise<T>) {
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

function moduleSignature() {
  try {
    return getModules().map((module) => ({
      id: module?.id,
      namespace: module?.namespace,
      regex: (module?.regex ?? []).map(scriptSignature),
      assets: module?.assets ?? [],
      trigger: (module?.trigger ?? []).map(triggerSignature),
      lowLevelAccess: module?.lowLevelAccess,
      customModuleToggle: module?.customModuleToggle,
    }))
  } catch {
    return []
  }
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

function parseSettingsSignature() {
  const db = DBState.db as Partial<Database>
  return {
    reloadEpoch: get(ReloadGUIPointer),
    currentTriggerId: get(CurrentTriggerIdStore),
    presetRegex: (db.presetRegex ?? []).map(scriptSignature),
    moduleRegex: getModuleRegexScripts().map(scriptSignature),
    moduleAssets: getModuleAssets(),
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

export function getChatBodyParseMemoKey(input: ChatBodyParseMemoInput): string {
  return stableStringify({
    kind: 'chat-body-parse',
    data: input.data ?? '',
    chatID: input.chatID,
    mode: input.mode,
    cbsConditions: input.cbsConditions ?? {},
    character: characterSignature(input.charArg),
    activeChat: activeChatSignature(),
    modules: moduleSignature(),
    settings: parseSettingsSignature(),
  })
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

export function getChatBodyCachedOnlyLlmDetectionKey(input: ChatBodyCachedOnlyInput): string {
  const db = DBState.db as Partial<Database>
  const detectionMode = db.translateBeforeHTMLFormatting
    ? 'raw'
    : db.legacyTranslation
      ? input.fallbackMode
      : 'pretranslate'

  return stableStringify({
    kind: 'chat-body-llm-cache-exists',
    detectionMode,
    rawData: db.translateBeforeHTMLFormatting ? (input.data ?? '') : undefined,
    parseKey:
      detectionMode === 'raw'
        ? undefined
        : getChatBodyParseMemoKey({
            data: input.data,
            charArg: input.charArg,
            mode: detectionMode as ChatBodyParseMode,
            chatID: input.chatID,
            cbsConditions: input.cbsConditions,
          }),
    translateSettings: getTranslateSettingsSignature(),
  })
}

export function memoizedChatBodyParse(input: ChatBodyParseMemoInput): Promise<string> {
  const key = getChatBodyParseMemoKey(input)
  const cached = parseMemo.get(key)
  if (cached) {
    return refresh(parseMemo, key, cached)
  }

  const promise = ParseMarkdown(
    input.data,
    input.charArg,
    input.mode,
    input.chatID,
    input.cbsConditions,
  ).catch((error) => {
    parseMemo.delete(key)
    throw error
  })
  remember(parseMemo, key, promise, PARSE_MEMO_LIMIT)
  return promise
}

export async function getChatBodyCachedOnlyLlmDecision(
  input: ChatBodyCachedOnlyInput,
): Promise<boolean> {
  const key = getChatBodyCachedOnlyLlmDetectionKey(input)
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
          mode: db.legacyTranslation ? input.fallbackMode : 'pretranslate',
          chatID: input.chatID,
          cbsConditions: input.cbsConditions,
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
}

export function getChatBodyParseMemoStats() {
  return {
    parseEntries: parseMemo.size,
    llmDetectionEntries: llmDetectionMemo.size,
  }
}
