import { get } from 'svelte/store'
import { parseChatML } from '../parser/chatML'
import { getDatabase, type character, type customscript } from '../storage/database.svelte'
import { defaultInputTranslatorPrompt } from '../storage/defaultPrompts'
import { defaultTranslatorPrompt, getCurrentTranslatorPresetFromState, type TranslatorPreset } from './presets'
import { globalFetch } from '../globalApi.svelte'
import { alertError } from '../alert'
import { requestChatData } from '../process/request/request'
import { doingChat, type OpenAIChat } from '../process/index.svelte'
import { applyMarkdownToNode, type simpleCharacterArgument } from '../parser/parser.svelte'
import { selectedCharID } from '../stores.svelte'
import { getModuleRegexScripts } from '../process/modules'
import { getActivePromptPresetRegexScripts } from '../process/promptPresetRegex'
import { getNodetextToSentence, sleep } from '../util'
import { processScriptFull } from '../process/scripts'
import { resolveModelProfile } from '../model/modelProfileResolver'
import localforage from 'localforage'
import sendSound from '../../etc/send.mp3'
import { providerOperationCredential, requestProviderOperation } from '../server/providerOperations'

export const TRANSLATE_CACHE_MAX_ENTRIES = 256
export const TRANSLATE_HTML_OUTPUT_MEMO_MAX_ENTRIES = 64
export const LLM_TRANSLATE_CACHE_MAX_ENTRIES = 256
const EDITTRANS_REGEX_CACHE_MAX_ENTRIES = 1000
const LLM_CACHE_INDEX_KEY = '__risu_llm_translate_cache_index_v1__'
export const DEEPLX_DELIMITER_FALLBACK_MAX_SEGMENTS = 8

const translateCache = new Map<string, string>()
const pendingTranslateCache = new Map<string, Promise<string>>()
const translateHTMLMemo = new Map<string, string>()
const edittransRegexCache = new Map<string, RegExp>()
const invalidEdittransRegexCache = new Map<string, true>()
const llmVolatileCache = new Map<string, string>()
const llmCacheWriteFailures = new Set<string>()
let activeTranslateCacheScope: string | null = null
let llmCacheIndex: string[] | null = null
let llmCacheIndexLoad: Promise<string[]> | null = null

function getTranslateCacheKey(reverse: boolean, text: string) {
  return JSON.stringify({
    reverse,
    text,
    settings: getTranslatorSettingsSignature(getDatabase()),
  })
}

function getCurrentTranslateCacheScope(db = getDatabase()) {
  const charId = get(selectedCharID)
  const character = db.characters?.[charId]
  const chatPage = character?.chatPage
  const chatId = typeof chatPage === 'number' ? character?.chats?.[chatPage]?.id : undefined
  return `${charId}:${chatId ?? chatPage ?? 'none'}`
}

function clearTranslateCacheEntries() {
  translateCache.clear()
  pendingTranslateCache.clear()
}

function clearTranslateHTMLMemoEntries() {
  translateHTMLMemo.clear()
}

function syncTranslateCacheScope(db = getDatabase()) {
  const scope = getCurrentTranslateCacheScope(db)
  if (activeTranslateCacheScope !== null && activeTranslateCacheScope !== scope) {
    clearTranslateCacheEntries()
  }
  activeTranslateCacheScope = scope
  return scope
}

function readTranslateCache(reverse: boolean, text: string): string | undefined {
  const key = getTranslateCacheKey(reverse, text)
  if (!translateCache.has(key)) {
    return undefined
  }

  const translated = translateCache.get(key)!
  translateCache.delete(key)
  translateCache.set(key, translated)
  return translated
}

function writeTranslateCache(
  reverse: boolean,
  text: string,
  translated: string,
  scope: string,
  cacheKey = getTranslateCacheKey(reverse, text),
) {
  if (syncTranslateCacheScope() !== scope) {
    return
  }

  if (translateCache.has(cacheKey)) {
    translateCache.delete(cacheKey)
  }
  translateCache.set(cacheKey, translated)

  while (translateCache.size > TRANSLATE_CACHE_MAX_ENTRIES) {
    const oldestKey = translateCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    translateCache.delete(oldestKey)
  }
}

export const __translatorTestHooks = {
  clearTranslateCache() {
    clearTranslateCacheEntries()
    clearTranslateHTMLMemoEntries()
    edittransRegexCache.clear()
    invalidEdittransRegexCache.clear()
    llmVolatileCache.clear()
    llmCacheIndex = null
    llmCacheIndexLoad = null
    llmCacheWriteFailures.clear()
    activeTranslateCacheScope = null
  },
  getTranslateCacheEntries() {
    return Array.from(translateCache.entries())
  },
  clearTranslateHTMLMemo() {
    clearTranslateHTMLMemoEntries()
  },
  getTranslateHTMLMemoEntries() {
    return Array.from(translateHTMLMemo.entries())
  },
  getEdittransRegexCacheSize() {
    return edittransRegexCache.size
  },
  getInvalidEdittransRegexCacheSize() {
    return invalidEdittransRegexCache.size
  },
  getLLMVolatileCacheEntries() {
    return Array.from(llmVolatileCache.entries())
  },
  getLLMCacheWriteFailureKeys() {
    return Array.from(llmCacheWriteFailures)
  },
  getTranslateProfileCacheSignature() {
    return getTranslateProfileCacheSignature(getDatabase())
  },
  getCurrentLLMTranslationCacheKey(text: string) {
    return getCurrentLLMTranslationCacheKey(text)
  },
}

let bergamotTranslate: (text: string, from: string, to: string, html?: boolean) => Promise<string> | null = null

export const LLMCacheStorage = localforage.createInstance({
  name: 'LLMTranslateCache',
})

let llmCacheMutationEpoch = 0

export function getLLMCacheMutationEpoch() {
  return llmCacheMutationEpoch
}

function bumpLLMCacheMutationEpoch() {
  llmCacheMutationEpoch += 1
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getTranslatorSettingsSignature(db = getDatabase()) {
  const selectedCharacter = db.characters?.[get(selectedCharID)]
  const presetIndex =
    typeof db.translatorPresetId === 'number' && Number.isInteger(db.translatorPresetId) ? db.translatorPresetId : -1
  const selectedPreset = Array.isArray(db.translatorPresets) ? db.translatorPresets[presetIndex] : undefined
  return {
    translatorType: db.translatorType,
    translator: db.translator,
    translatorInputLanguage: db.translatorInputLanguage,
    aiModel: db.aiModel,
    translateProfile: db.translatorType === 'llm' ? getTranslateProfileCacheSignature(db) : null,
    llmPrompt:
      db.translatorType === 'llm'
        ? {
            presetId: typeof selectedPreset?.id === 'string' ? selectedPreset.id : null,
            prompt:
              typeof selectedPreset?.prompt === 'string'
                ? selectedPreset.prompt
                : typeof db.translatorPrompt === 'string'
                  ? db.translatorPrompt
                  : '',
            maxResponse:
              typeof selectedPreset?.maxResponse === 'number' && Number.isFinite(selectedPreset.maxResponse)
                ? selectedPreset.maxResponse
                : finiteNumber(db.translatorMaxResponse, 1000),
            characterId: selectedCharacter?.chaId ?? null,
            translatorNote:
              selectedCharacter?.type === 'character' && typeof selectedCharacter.translatorNote === 'string'
                ? selectedCharacter.translatorNote
                : '',
          }
        : null,
    useExperimentalGoogleTranslator: db.useExperimentalGoogleTranslator,
    deeplOptions: {
      freeApi: db.deeplOptions?.freeApi,
      key: db.deeplOptions?.key,
    },
    deeplXOptions: {
      url: db.deeplXOptions?.url,
      token: db.deeplXOptions?.token,
    },
  }
}

function getTranslateProfileCacheSignature(db = getDatabase()) {
  const profile = resolveModelProfile({ database: db, role: 'translate' })
  const customModel = profile.providerOptions.customModel

  return {
    profileId: profile.profileId,
    source: {
      kind: profile.source.kind,
      field: profile.source.field ?? null,
      role: profile.source.role,
      legacyMode: profile.source.legacyMode,
    },
    modelId: profile.modelId,
    requestModel: profile.requestModel,
    model: {
      id: profile.modelInfo.id,
      internalID: profile.modelInfo.internalID,
      provider: profile.modelInfo.provider,
      format: profile.modelInfo.format,
      tokenizer: profile.modelInfo.tokenizer,
      keyIdentifier: profile.modelInfo.keyIdentifier,
    },
    provider: {
      id:
        profile.providerOptions.provider ??
        (profile.providerCapability.routable ? profile.providerCapability.provider : null),
      keyIdentifier: profile.providerOptions.keyIdentifier ?? profile.modelInfo.keyIdentifier,
    },
    customModel: customModel
      ? {
          id: customModel.id,
          internalId: customModel.internalId,
          format: customModel.format,
          tokenizer: customModel.tokenizer,
          flags: customModel.flags,
        }
      : null,
  }
}

function getScriptSignature(scripts: customscript[] | undefined) {
  return (scripts ?? []).map((script, index) => ({
    identity: script.id ?? `${index}:${script.comment ?? ''}`,
    type: script.type,
    in: script.in,
    out: script.out,
    flag: script.flag ?? '',
    ableFlag: Boolean(script.ableFlag),
    comment: script.comment,
  }))
}

function getRelevantScriptSignature(
  db: ReturnType<typeof getDatabase>,
  alwaysExistChar: character | simpleCharacterArgument,
) {
  const isRelevant = (script: customscript) => script.type === 'edittrans' || script.type === 'editdisplay'
  return {
    presetRegex: getScriptSignature(getActivePromptPresetRegexScripts(db).filter(isRelevant)),
    characterScripts: getScriptSignature((alwaysExistChar?.customscript ?? []).filter(isRelevant)),
    moduleScripts: getScriptSignature((getModuleRegexScripts() ?? []).filter(isRelevant)),
    globalscript: getScriptSignature((db.globalscript ?? []).filter(isRelevant)),
    enabledModules: db.enabledModules ?? [],
    moduleIntergration: db.moduleIntergration ?? '',
    dynamicAssetsEditDisplay: db.dynamicAssetsEditDisplay,
  }
}

function getTranslatorNoteSignature(
  db: ReturnType<typeof getDatabase>,
  alwaysExistChar: character | simpleCharacterArgument,
) {
  const selectedCharacter = db.characters?.[get(selectedCharID)]
  return {
    selectedCharID: get(selectedCharID),
    selectedChaId: selectedCharacter?.chaId,
    selectedTranslatorNote: selectedCharacter?.type === 'character' ? (selectedCharacter.translatorNote ?? '') : '',
    activeTranslatorNote: alwaysExistChar?.type === 'character' ? (alwaysExistChar.translatorNote ?? '') : '',
  }
}

function getTranslateHTMLMemoKey(
  html: string,
  reverse: boolean,
  charArg: simpleCharacterArgument | string,
  chatID: number,
  alwaysExistChar: character | simpleCharacterArgument,
) {
  const db = getDatabase()
  const preset = db.translatorType === 'llm' ? getCurrentTranslatorPreset() : null
  return safeStringify({
    version: 1,
    html,
    reverse,
    charArg:
      typeof charArg === 'string'
        ? { type: 'string', value: charArg }
        : { type: 'object', chaId: charArg.chaId, scriptCount: charArg.customscript?.length ?? 0 },
    chatID,
    chatScope: getCurrentTranslateCacheScope(db),
    translator: {
      ...getTranslatorSettingsSignature(db),
      htmlTranslation: db.htmlTranslation,
      combineTranslation: db.combineTranslation,
      playMessageOnTranslateEnd: db.playMessageOnTranslateEnd,
      noWaitForTranslate: db.noWaitForTranslate,
      preset: preset ? { prompt: preset.prompt, maxResponse: preset.maxResponse } : null,
      llmCacheMutationEpoch: db.translatorType === 'llm' ? llmCacheMutationEpoch : 0,
    },
    scripts: getRelevantScriptSignature(db, alwaysExistChar),
    character: {
      chaId: alwaysExistChar.chaId,
      type: alwaysExistChar.type ?? 'character',
      translatorNote: getTranslatorNoteSignature(db, alwaysExistChar),
    },
    regenerateReusable: false,
  })
}

function readTranslateHTMLMemo(key: string): string | undefined {
  if (!translateHTMLMemo.has(key)) {
    return undefined
  }

  const translated = translateHTMLMemo.get(key)!
  translateHTMLMemo.delete(key)
  translateHTMLMemo.set(key, translated)
  return translated
}

function writeTranslateHTMLMemo(key: string, translated: string) {
  if (translateHTMLMemo.has(key)) {
    translateHTMLMemo.delete(key)
  }
  translateHTMLMemo.set(key, translated)

  while (translateHTMLMemo.size > TRANSLATE_HTML_OUTPUT_MEMO_MAX_ENTRIES) {
    const oldestKey = translateHTMLMemo.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    translateHTMLMemo.delete(oldestKey)
  }
}

function normalizeLLMCacheIndex(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const normalized: string[] = []
  const seen = new Set<string>()
  for (let i = value.length - 1; i >= 0; i -= 1) {
    const key = value[i]
    if (typeof key !== 'string' || key === LLM_CACHE_INDEX_KEY || seen.has(key)) {
      continue
    }
    seen.add(key)
    normalized.unshift(key)
  }
  return normalized
}

async function rebuildLLMCacheIndex() {
  const keys: string[] = []
  try {
    await LLMCacheStorage.iterate<unknown, void>((_value, key) => {
      if (key !== LLM_CACHE_INDEX_KEY) {
        keys.push(key)
      }
    })
  } catch {
    return []
  }
  return keys
}

async function getLoadedLLMCacheIndex() {
  if (llmCacheIndex !== null) {
    return llmCacheIndex
  }

  if (!llmCacheIndexLoad) {
    llmCacheIndexLoad = (async () => {
      let loaded: string[] | null = null
      try {
        loaded = normalizeLLMCacheIndex(await LLMCacheStorage.getItem(LLM_CACHE_INDEX_KEY))
      } catch {
        loaded = null
      }
      llmCacheIndex = loaded ?? (await rebuildLLMCacheIndex())
      return llmCacheIndex
    })().finally(() => {
      llmCacheIndexLoad = null
    })
  }

  return llmCacheIndexLoad
}

async function persistLLMCacheIndex() {
  if (llmCacheIndex === null) {
    return
  }

  try {
    await LLMCacheStorage.setItem(LLM_CACHE_INDEX_KEY, llmCacheIndex.slice())
  } catch {
    // The index is advisory. Cached values and the volatile fallback remain usable.
  }
}

function rememberLLMCacheWriteFailure(key: string) {
  if (!llmCacheWriteFailures.has(key)) {
    llmCacheWriteFailures.add(key)
  }
}

function readVolatileLLMCache(key: string): string | null {
  if (!llmVolatileCache.has(key)) {
    return null
  }

  const value = llmVolatileCache.get(key)!
  llmVolatileCache.delete(key)
  llmVolatileCache.set(key, value)
  return value
}

function writeVolatileLLMCache(key: string, value: string) {
  if (llmVolatileCache.has(key)) {
    llmVolatileCache.delete(key)
  }
  llmVolatileCache.set(key, value)

  while (llmVolatileCache.size > LLM_TRANSLATE_CACHE_MAX_ENTRIES) {
    const oldestKey = llmVolatileCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    llmVolatileCache.delete(oldestKey)
  }
}

async function prunePersistentLLMCache(maxEntries = LLM_TRANSLATE_CACHE_MAX_ENTRIES) {
  const index = await getLoadedLLMCacheIndex()
  let changed = false

  while (index.length > maxEntries) {
    const oldestKey = index.shift()
    if (!oldestKey) {
      break
    }
    try {
      await LLMCacheStorage.removeItem(oldestKey)
    } catch {}
    changed = true
  }

  if (changed) {
    await persistLLMCacheIndex()
  }
}

async function touchPersistentLLMCacheKey(key: string) {
  const index = await getLoadedLLMCacheIndex()
  const existingIndex = index.indexOf(key)
  if (existingIndex !== -1) {
    index.splice(existingIndex, 1)
  }
  index.push(key)
  await prunePersistentLLMCache()
  await persistLLMCacheIndex()
}

async function readLLMCacheEntry(key: string): Promise<string | null> {
  if (key === LLM_CACHE_INDEX_KEY) {
    return null
  }

  const volatile = readVolatileLLMCache(key)
  if (volatile !== null) {
    return volatile
  }

  try {
    const cacheMatch = await LLMCacheStorage.getItem<string>(key)
    if (typeof cacheMatch === 'string') {
      await touchPersistentLLMCacheKey(key)
      return cacheMatch
    }
  } catch {}

  return null
}

async function writePersistentLLMCacheEntry(key: string, value: string) {
  try {
    await LLMCacheStorage.setItem(key, value)
    return true
  } catch {}

  await prunePersistentLLMCache(Math.max(LLM_TRANSLATE_CACHE_MAX_ENTRIES - 1, 0))

  try {
    await LLMCacheStorage.setItem(key, value)
    return true
  } catch {
    rememberLLMCacheWriteFailure(key)
    return false
  }
}

async function writeLLMCacheEntry(key: string, value: string, options: { bumpEpoch?: boolean } = {}) {
  if (key === LLM_CACHE_INDEX_KEY) {
    return false
  }

  writeVolatileLLMCache(key, value)
  const stored = await writePersistentLLMCacheEntry(key, value)
  if (stored) {
    await touchPersistentLLMCacheKey(key)
  }
  if (options.bumpEpoch !== false) {
    bumpLLMCacheMutationEpoch()
  }
  return stored
}

async function writeLLMCacheEntries(keys: string[], value: string) {
  const uniqueKeys = Array.from(new Set(keys.filter((key) => key !== LLM_CACHE_INDEX_KEY)))
  let accepted = 0
  for (const key of uniqueKeys) {
    await writeLLMCacheEntry(key, value, { bumpEpoch: false })
    accepted += 1
  }
  if (accepted > 0) {
    bumpLLMCacheMutationEpoch()
  }
}

function resolveTranslatorNote(
  translatorNote: string | undefined,
  currentChar: character | simpleCharacterArgument | undefined,
) {
  if (translatorNote) {
    return translatorNote
  }
  if (currentChar?.type === 'character') {
    return currentChar.translatorNote ?? ''
  }
  return ''
}

function getLLMTranslationCacheKey(
  text: string,
  arg: { to: string; from: string; translatorNote?: string },
  preset: TranslatorPreset,
  translatorNote: string,
  currentChar: character | simpleCharacterArgument | undefined,
  translateProfile: ReturnType<typeof getTranslateProfileCacheSignature>,
) {
  return safeStringify({
    version: 2,
    mode: 'llm-translate',
    text,
    from: arg.from,
    to: arg.to,
    translatorNote,
    preset: {
      prompt: preset.prompt,
      maxResponse: preset.maxResponse,
    },
    char: {
      selectedCharID: get(selectedCharID),
      chaId: currentChar?.chaId ?? null,
      type: currentChar?.type ?? null,
    },
    translateProfile,
  })
}

function getCurrentLLMTranslationCacheKey(text: string): string | null {
  const db = getDatabase()
  if (db.translatorType !== 'llm') {
    return null
  }

  const currentChar = db.characters?.[get(selectedCharID)]
  const preset = getCurrentTranslatorPreset()
  const translatorNote = resolveTranslatorNote(undefined, currentChar)
  const translateProfile = getTranslateProfileCacheSignature(db)
  return getLLMTranslationCacheKey(
    text,
    {
      to: db.translator || 'en',
      from: db.translatorInputLanguage,
    },
    preset,
    translatorNote,
    currentChar,
    translateProfile,
  )
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export async function runInputTranslator(text: string, abortSignal?: AbortSignal | null): Promise<string> {
  const db = getDatabase()
  const promptTemplate =
    typeof db.inputTranslatorPrompt === 'string' && db.inputTranslatorPrompt.trim()
      ? db.inputTranslatorPrompt
      : defaultInputTranslatorPrompt
  const promptWithContent = promptTemplate.replaceAll('{{solt::content}}', text).replaceAll('{{slot::content}}', text)
  const parsedPrompt = parseChatML(promptWithContent)
  const hasContentSlot = promptTemplate.includes('{{slot::content}}') || promptTemplate.includes('{{solt::content}}')
  const formated: OpenAIChat[] =
    parsedPrompt ??
    (hasContentSlot
      ? [
          {
            role: 'user',
            content: promptWithContent,
          },
        ]
      : [
          {
            role: 'system',
            content: promptTemplate,
          },
          {
            role: 'user',
            content: text,
          },
        ])
  const maxTokens = finiteNumber(db.translatorMaxResponse, 1000)
  const rq = await requestChatData(
    {
      formated,
      bias: {},
      useStreaming: false,
      noMultiGen: true,
      maxTokens,
    },
    'translate',
    abortSignal ?? null,
  )

  if (rq.type === 'fail') {
    throw new Error(rq.result)
  }
  if (rq.type === 'streaming' || rq.type === 'multiline') {
    throw new Error('Unexpected response type')
  }
  return rq.result.trim()
}

let waitTrans = 0

export function getCurrentTranslatorPreset(): TranslatorPreset {
  return getCurrentTranslatorPresetFromState(getDatabase({ snapshot: true }))
}

export async function translate(text: string, reverse: boolean) {
  let db = getDatabase()
  syncTranslateCacheScope(db)
  const cached = readTranslateCache(reverse, text)
  if (cached !== undefined) {
    return cached
  }

  const key = getTranslateCacheKey(reverse, text)
  const pending = pendingTranslateCache.get(key)
  if (pending) {
    return pending
  }

  const promise = runTranslator(text, reverse, db.translator, db.aiModel.startsWith('novellist') ? 'ja' : 'en')
  pendingTranslateCache.set(key, promise)

  try {
    return await promise
  } finally {
    if (pendingTranslateCache.get(key) === promise) {
      pendingTranslateCache.delete(key)
    }
  }
}

export async function runTranslator(
  text: string,
  reverse: boolean,
  from: string,
  target: string,
  exarg?: { translatorNote?: string },
) {
  const cacheScope = syncTranslateCacheScope()
  const cacheKey = getTranslateCacheKey(reverse, text)
  const arg = {
    from: reverse ? from : target,

    to: reverse ? target : from,

    host: 'translate.googleapis.com',

    translatorNote: exarg?.translatorNote,
  }
  const texts = text.split('\n')
  let chunks: [string, boolean][] = [['', true]]

  for (let i = 0; i < texts.length; i++) {
    if (
      texts[i].startsWith('{{img') ||
      texts[i].startsWith('{{raw') ||
      texts[i].startsWith('{{video') ||
      (texts[i].startsWith('{{audio') && texts[i].endsWith('}}')) ||
      texts[i].length === 0
    ) {
      chunks.push([texts[i], false])
      chunks.push(['', true])
    } else {
      chunks[chunks.length - 1][0] += chunks[chunks.length - 1][0].length === 0 ? texts[i] : `\n${texts[i]}`
    }
  }

  let fullResult: string[] = []

  for (const chunk of chunks) {
    if (chunk[1]) {
      const trimed = chunk[0].trim()
      if (trimed.length === 0) {
        fullResult.push(chunk[0])
        continue
      }
      const result = await translateMain(trimed, arg)

      if (result.startsWith('ERR::')) {
        alertError(result)
        return text
      }

      fullResult.push(result.trim())
    } else {
      fullResult.push(chunk[0])
    }
  }

  const result = fullResult.join('\n').trim()

  writeTranslateCache(reverse, text, result, cacheScope, cacheKey)

  return result
}

async function translateMain(text: string, arg: { from: string; to: string; host: string; translatorNote?: string }) {
  let db = getDatabase()
  if (db.translatorType === 'llm') {
    const tr = arg.to || 'en'
    return translateLLM(text, { to: tr, from: arg.from, translatorNote: arg.translatorNote })
  }
  if (db.translatorType === 'deepl') {
    try {
      const result = await requestProviderOperation<{ translations?: Array<{ text?: unknown }> }>('deepl.translate', {
        credential: providerOperationCredential(db.deeplOptions.key),
        input: { text, sourceLanguage: arg.from, targetLanguage: arg.to },
      })
      const translated = result.translations?.[0]?.text
      if (typeof translated !== 'string') throw new Error('DeepL translation response was malformed')
      return translated
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Provider operation failed (')) {
        return 'ERR::DeepL API Error'
      }
      throw error
    }
  }
  if (db.translatorType === 'deeplX') {
    if (!db.noWaitForTranslate) {
      if (waitTrans - Date.now() > 0) {
        const waitTime = waitTrans - Date.now()
        waitTrans = Date.now() + 3000
        await sleep(waitTime)
      }
    }

    try {
      const result = await requestProviderOperation<{ data?: unknown }>('deeplx.translate', {
        credential: providerOperationCredential(db.deeplXOptions.token),
        input: { text, sourceLanguage: arg.from, targetLanguage: arg.to },
      })
      if (typeof result.data !== 'string') throw new Error('DeepLX translation response was malformed')
      return result.data
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Provider operation failed (')) {
        return 'ERR::DeepLX API Error'
      }
      throw error
    }
  }
  if (db.translatorType == 'bergamot') {
    if (!bergamotTranslate) {
      const bergamotTranslator = await import('./bergamotTranslator')
      bergamotTranslate = bergamotTranslator.bergamotTranslate
    }

    return bergamotTranslate(text, arg.from, arg.to, false)
  }
  if (db.useExperimentalGoogleTranslator) {
    const hqAvailable = true

    if (hqAvailable) {
      try {
        const ua = navigator.userAgent
        const d = await globalFetch(
          `https://translate.google.com/m?tl=${arg.to}&sl=${arg.from}&q=${encodeURIComponent(text)}`,
          {
            headers: {
              'User-Agent': ua,
              Accept: '*/*',
            },
            method: 'GET',
          },
        )
        const parser = new DOMParser()
        const dom = parser.parseFromString(d.data, 'text/html')
        const result = dom.querySelector('.result-container')?.textContent?.trim()
        if (result) {
          return result
        }
      } catch (error) {}
    }
  }

  const url =
    `https://${arg.host}/translate_a/single?client=gtx&dt=t&sl=${db.translatorInputLanguage}&tl=${arg.to}&q=` +
    encodeURIComponent(text)

  const f = await fetch(url, {
    method: 'GET',
  })

  const res = await f.json()

  if (typeof res === 'string') {
    return res as unknown as string
  }

  if (!res[0] || res[0].length === 0) {
    return text
  }

  const result = (
    res[0]
      .map((s) => s[0])
      .filter(Boolean)
      .join('') as string
  )
    .replace(/\* ([^*]+)\*/g, '*$1*')
    .replace(/\*([^*]+) \*/g, '*$1*')
  return result
}

export async function translateVox(text: string) {
  return jaTrans(text)
}

async function jaTrans(text: string) {
  return await runTranslator(text, true, 'en', 'ja')
}

export function isExpTranslator() {
  const db = getDatabase()
  return db.translatorType === 'llm' || db.translatorType === 'deepl' || db.translatorType === 'deeplX'
}

export async function translateHTML(
  html: string,
  reverse: boolean,
  charArg: simpleCharacterArgument | string = '',
  chatID: number,
  regenerate = false,
): Promise<string> {
  let alwaysExistChar: character | simpleCharacterArgument
  if (charArg !== '') {
    if (typeof charArg === 'string') {
      const db = getDatabase()
      const charId = get(selectedCharID)
      alwaysExistChar = db.characters[charId]
    } else {
      alwaysExistChar = charArg
    }
  } else {
    alwaysExistChar = {
      type: 'simple',
      customscript: [],
      virtualscript: null,
      emotionImages: [],
      chaId: 'simple',
    }
  }
  let db = getDatabase()
  let DoingChat = get(doingChat)
  if (DoingChat) {
    if (!(db.translatorType === 'llm' && (await getLLMCache(html)) !== null)) {
      return html
    }
  }
  const initialMemoKey = getTranslateHTMLMemoKey(html, reverse, charArg, chatID, alwaysExistChar)
  if (!regenerate) {
    const memoized = readTranslateHTMLMemo(initialMemoKey)
    if (memoized !== undefined) {
      return memoized
    }
  }
  const cacheTranslateHTMLResult = (translated: string) => {
    writeTranslateHTMLMemo(getTranslateHTMLMemoKey(html, reverse, charArg, chatID, alwaysExistChar), translated)
    return translated
  }
  if (db.translatorType === 'llm') {
    const tr = db.translator || 'en'
    const from = db.translatorInputLanguage
    const r = await translateLLM(html, { to: tr, from: from, regenerate })
    if (db.playMessageOnTranslateEnd) {
      const audio = new Audio(sendSound)
      audio.play().catch(() => {})
    }

    return cacheTranslateHTMLResult(applyEdittransRegex(r, charArg, alwaysExistChar))
  }
  if (db.translatorType == 'bergamot' && db.htmlTranslation) {
    const from = db.aiModel.startsWith('novellist') ? 'ja' : 'en'
    const to = db.translator || 'en'

    if (!bergamotTranslate) {
      const bergamotTranslator = await import('./bergamotTranslator')
      bergamotTranslate = bergamotTranslator.bergamotTranslate
    }

    return cacheTranslateHTMLResult(
      applyEdittransRegex(await bergamotTranslate(html, from, to, true), charArg, alwaysExistChar),
    )
  }
  const dom = new DOMParser().parseFromString(html, 'text/html')

  let promises: Promise<void>[] = []
  const translationChunkFlushes: Promise<void>[] = []
  let deeplXFallbackSegmentsUsed = 0
  let translationChunks: {
    chunks: string[]
    deferreds: { reject: (reason?: unknown) => void; resolve: (text: string) => void }[]
  }[] = [
    {
      chunks: [],
      deferreds: [],
    },
  ]

  function rejectTranslationChunks(error: unknown) {
    for (const chunk of translationChunks) {
      for (const deferred of chunk.deferreds) {
        deferred.reject(error)
      }
    }
  }

  function trackTranslationChunkFlush(flush: Promise<void>) {
    translationChunkFlushes.push(flush)
    void flush.catch(() => {
      // Deferred node promises propagate the same failure through translateHTML.
    })
  }

  async function translateTranslationChunks(force: boolean = false, additionalChunkLength = 0) {
    if (translationChunks.length === 0 || !needSuperChunkedTranslate()) {
      return
    }

    const currentChunk = translationChunks[translationChunks.length - 1]
    const text: string = currentChunk.chunks.join('\n■\n')

    if (!force && text.length + additionalChunkLength < 5000) {
      return
    }

    translationChunks.push({
      chunks: [],
      deferreds: [],
    })

    if (!text) {
      return
    }

    try {
      const translated = await translate(text, reverse)

      const split = translated.split('■')

      if (split.length !== currentChunk.chunks.length) {
        //try translating one by one
        const fallbackRemaining = Math.max(DEEPLX_DELIMITER_FALLBACK_MAX_SEGMENTS - deeplXFallbackSegmentsUsed, 0)
        const fallbackCount = Math.min(currentChunk.chunks.length, fallbackRemaining)
        deeplXFallbackSegmentsUsed += fallbackCount
        for (let i = 0; i < fallbackCount; i++) {
          currentChunk.deferreds[i].resolve(await translate(currentChunk.chunks[i], reverse))
        }
        for (let i = fallbackCount; i < currentChunk.chunks.length; i++) {
          currentChunk.deferreds[i].resolve(currentChunk.chunks[i])
        }
        return
      }

      for (let i = 0; i < split.length; i++) {
        currentChunk.deferreds[i].resolve(split[i])
      }
    } catch (error) {
      rejectTranslationChunks(error)
      throw error
    }
  }

  async function translateNodeText(
    node: Node,
    reprocessDisplayScript: boolean = false,
    combineAsSingleChunk: boolean = false,
  ) {
    if (node.textContent.trim().length !== 0) {
      if (needSuperChunkedTranslate()) {
        const prm = new Promise<string>((resolve, reject) => {
          trackTranslationChunkFlush(translateTranslationChunks(false, node.textContent.length))
          translationChunks[translationChunks.length - 1].deferreds.push({ resolve, reject })
          translationChunks[translationChunks.length - 1].chunks.push(node.textContent)
        })

        node.textContent = await prm
        return
      }

      const translateChunks = combineAsSingleChunk ? [node.textContent || ''] : (node.textContent || '').split(/\n\n+/g)
      let translatedChunksPromises: Promise<string>[] = []
      for (const chunk of translateChunks) {
        const translatedPromise = translate(chunk, reverse)
        translatedChunksPromises.push(translatedPromise)
      }

      const translatedChunks = await Promise.all(translatedChunksPromises)
      let translated = translatedChunks.join('\n\n')
      if (!reprocessDisplayScript) {
        node.textContent = translated
        return
      }

      const { data: processedTranslated } = await processScriptFull(alwaysExistChar, translated, 'editdisplay', chatID)
      // If the translation is the same, don't replace the node
      if (translated == processedTranslated) {
        node.textContent = processedTranslated
        applyMarkdownToNode(node)
        return
      }

      // Replace the old node with the new one
      const newNode = document.createElement(node.nodeType === Node.TEXT_NODE ? 'span' : node.nodeName)
      newNode.innerHTML = processedTranslated
      node.parentNode.replaceChild(newNode, node)
      applyMarkdownToNode(newNode)
    }
  }

  // Recursive function to translate all text nodes
  async function translateNode(node: Node, parent?: Node): Promise<void> {
    if (node.nodeType === Node.TEXT_NODE) {
      // Translate the text content of the node
      if (node.textContent && parent) {
        const parentName = parent.nodeName.toLowerCase()
        if (parentName === 'script' || parentName === 'style') {
          return
        }
        if (promises.length > 10) {
          await Promise.all(promises)
          promises = []
        }
        promises.push(translateNodeText(node))
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Translate child nodes
      //skip if it's a script or style tag
      if (node.nodeName.toLowerCase() === 'script' || node.nodeName.toLowerCase() === 'style') {
        return
      }
      // combineTranslation feature
      if (db.combineTranslation && node.nodeName.toLowerCase() === 'p' && node instanceof HTMLElement) {
        const children = Array.from(node.childNodes)
        const blacklist = ['img', 'iframe', 'script', 'style', 'div', 'button', 'audio', 'video']
        const hasBlacklistChild = children.some((child) => blacklist.includes(child.nodeName.toLowerCase()))
        if (!hasBlacklistChild && (node as Element)?.getAttribute('translate') !== 'no') {
          const text = getNodetextToSentence(node)
          if (text.trim().length !== 0) {
            node.textContent = text
            await translateNodeText(node, true, true)
          }
          return
        }
      }

      for (const child of Array.from(node.childNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE && (node as Element)?.getAttribute('translate') === 'no') {
          continue
        }
        await translateNode(child, node)
      }
    }
  }

  // Start translation from the body element
  await translateNode(dom.body)

  trackTranslationChunkFlush(translateTranslationChunks(true, 0))

  await Promise.all([...translationChunkFlushes, ...promises])
  // Serialize the DOM back to HTML
  const serializer = new XMLSerializer()
  let translatedHTML = serializer.serializeToString(dom)
  // Remove the outer <html|body|head> tags
  translatedHTML = translatedHTML.replace(/<\/?(html|body|head)[^>]*>/g, '')

  translatedHTML = applyEdittransRegex(translatedHTML, charArg, alwaysExistChar)

  // Return the translated HTML, excluding the outer <body> tags if needed
  return cacheTranslateHTMLResult(translatedHTML)
}

function needSuperChunkedTranslate() {
  return getDatabase().translatorType === 'deeplX'
}

async function translateLLM(
  text: string,
  arg: { to: string; from: string; regenerate?: boolean; translatorNote?: string },
): Promise<string> {
  const originalText = text
  const db = getDatabase()
  const charIndex = get(selectedCharID)
  const currentChar = db.characters[charIndex]
  const translatorNote = resolveTranslatorNote(arg.translatorNote, currentChar)
  const preset = getCurrentTranslatorPreset()
  const translateProfile = getTranslateProfileCacheSignature(db)
  const cacheKey = getLLMTranslationCacheKey(originalText, arg, preset, translatorNote, currentChar, translateProfile)
  if (!arg.regenerate) {
    const cacheMatch = await readLLMCacheEntry(cacheKey)
    if (cacheMatch) {
      return cacheMatch
    }
  }
  const styleDecodeRegex = /\<risu-style\>(.+?)\<\/risu-style\>/gms
  let styleDecodes: string[] = []
  text = text.replace(styleDecodeRegex, (match, p1) => {
    styleDecodes.push(p1)
    return `<style-data style-index="${styleDecodes.length - 1}"></style-data>`
  })

  let formated: OpenAIChat[] = []
  let prompt = preset.prompt || defaultTranslatorPrompt
  let parsedPrompt = parseChatML(
    prompt
      .replaceAll('{{slot::from}}', arg.from)
      .replaceAll('{{slot}}', arg.to)
      .replaceAll('{{solt::content}}', text)
      .replaceAll('{{slot::content}}', text)
      .replaceAll('{{slot::tnote}}', translatorNote),
  )
  if (parsedPrompt) {
    formated = parsedPrompt
  } else {
    prompt = prompt
      .replaceAll('{{slot}}', arg.to)
      .replaceAll('{{slot::tnote}}', translatorNote)
      .replaceAll('{{slot::from}}', arg.from)
    formated = [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: text,
      },
    ]
  }
  const rq = await requestChatData(
    {
      formated,
      bias: {},
      useStreaming: false,
      noMultiGen: true,
      maxTokens: preset.maxResponse,
    },
    'translate',
  )

  if (rq.type === 'fail') {
    alertError(rq.result)
    return text
  }
  if (rq.type === 'streaming' || rq.type === 'multiline') {
    alertError('Unexpected response type')
    return text
  }
  const result = rq.result
    .replace(/<style-data style-index="(\d+)" ?\/?>/g, (match, p1) => {
      return styleDecodes[parseInt(p1)] ?? ''
    })
    .replace(/<\/style-data>/g, '')
  await writeLLMCacheEntry(cacheKey, result)
  return result
}

export async function getLLMCache(text: string): Promise<string | null> {
  const cacheKey = getCurrentLLMTranslationCacheKey(text)
  if (cacheKey) {
    return await readLLMCacheEntry(cacheKey)
  }
  return await readLLMCacheEntry(text)
}

export async function searchLLMCache(partialKey: string): Promise<{ key: string; value: string }[]> {
  const results: { key: string; value: string }[] = []
  await LLMCacheStorage.iterate<unknown, void>((value, key) => {
    if (key !== LLM_CACHE_INDEX_KEY && typeof value === 'string' && key.includes(partialKey)) {
      results.push({ key, value })
    }
  })
  return results
}

export async function setLLMCache(key: string, value: string): Promise<void> {
  const cacheKey = getCurrentLLMTranslationCacheKey(key)
  await writeLLMCacheEntries(cacheKey ? [key, cacheKey] : [key], value)
}

export async function exportLLMCacheAsJSON(): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  await LLMCacheStorage.iterate<unknown, void>((value, key) => {
    if (key !== LLM_CACHE_INDEX_KEY && typeof value === 'string') {
      result[key] = value
    }
  })
  return result
}

export async function importLLMCacheFromJSON(data: Record<string, string>): Promise<{ count: number; failed: number }> {
  let count = 0
  let failed = 0
  let accepted = 0
  for (const [key, value] of Object.entries(data)) {
    if (key === LLM_CACHE_INDEX_KEY) {
      continue
    }
    try {
      const stored = await writeLLMCacheEntry(key, value, { bumpEpoch: false })
      accepted++
      if (stored) {
        count++
      } else {
        failed++
      }
    } catch {
      failed++
    }
  }
  if (accepted > 0) {
    bumpLLMCacheMutationEpoch()
  }
  return { count, failed }
}

export async function clearLLMCache(): Promise<void> {
  await LLMCacheStorage.clear()
  llmVolatileCache.clear()
  llmCacheIndex = null
  llmCacheIndexLoad = null
  llmCacheWriteFailures.clear()
  bumpLLMCacheMutationEpoch()
}

function pruneEdittransRegexCaches() {
  while (edittransRegexCache.size > EDITTRANS_REGEX_CACHE_MAX_ENTRIES) {
    const oldestKey = edittransRegexCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    edittransRegexCache.delete(oldestKey)
  }
  while (invalidEdittransRegexCache.size > EDITTRANS_REGEX_CACHE_MAX_ENTRIES) {
    const oldestKey = invalidEdittransRegexCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    invalidEdittransRegexCache.delete(oldestKey)
  }
}

function getEdittransRegexCacheKey(script: customscript, index: number) {
  return safeStringify({
    identity: script.id ?? `${index}:${script.comment ?? ''}`,
    in: script.in,
    flag: script.ableFlag ? script.flag : 'g',
    ableFlag: Boolean(script.ableFlag),
  })
}

function getEdittransRegex(script: customscript, index: number): RegExp | null {
  const key = getEdittransRegexCacheKey(script, index)
  const cached = edittransRegexCache.get(key)
  if (cached) {
    edittransRegexCache.delete(key)
    edittransRegexCache.set(key, cached)
    cached.lastIndex = 0
    return cached
  }

  if (invalidEdittransRegexCache.has(key)) {
    return null
  }

  try {
    const reg = new RegExp(script.in, script.ableFlag ? script.flag : 'g')
    edittransRegexCache.set(key, reg)
    pruneEdittransRegexCaches()
    reg.lastIndex = 0
    return reg
  } catch (error) {
    invalidEdittransRegexCache.set(key, true)
    pruneEdittransRegexCaches()
    throw error
  }
}

function applyEdittransRegex(
  text: string,
  charArg: simpleCharacterArgument | string,
  alwaysExistChar: character | simpleCharacterArgument,
): string {
  if (charArg === '') return text

  let scripts: customscript[] = []
  scripts = (getModuleRegexScripts() ?? []).concat(alwaysExistChar?.customscript ?? [])

  for (const [index, script] of scripts.entries()) {
    if (script.type === 'edittrans') {
      const reg = getEdittransRegex(script, index)
      if (!reg) {
        continue
      }
      let outScript = script.out.replaceAll('$n', '\n')
      text = text.replace(reg, outScript)
    }
  }
  return text
}
