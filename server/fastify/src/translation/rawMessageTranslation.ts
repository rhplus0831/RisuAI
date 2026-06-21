import { createHash } from 'node:crypto'
import type { Database } from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import {
  resolveModelProfile,
  assertModelProfileGenerationReady,
} from '../../../../src/ts/model/modelProfileResolver.js'
import { dispatchChatProvider } from '../prompt/chatDispatch.js'
import type { CompletionStreamFrame } from '../generation/frames.js'
import { ValidationError } from '../repository.js'

export type RawMessageTranslatorType = 'google' | 'deepl' | 'deeplX' | 'llm'

export interface RawMessageTranslation {
  text: string
  source: 'raw'
  sourceHash: string
  targetLanguage: string
  inputLanguage: string
  translatorType: RawMessageTranslatorType
  settingsHash: string
  updatedAt: number
}

export interface RawMessageTranslationInput {
  settings: Record<string, unknown>
  character?: Record<string, unknown>
  text: string
  signal: AbortSignal
}

const DEFAULT_TRANSLATOR_PROMPT =
  'You are a translator. translate the following html or text into {{slot}}. do not output anything other than the translation.'

const SUPPORTED_TRANSLATORS = new Set<RawMessageTranslatorType>(['google', 'deepl', 'deeplX', 'llm'])

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function translatorTypeFromSettings(settings: Record<string, unknown>): RawMessageTranslatorType {
  const translatorType = stringValue(settings.translatorType, 'google')
  if (SUPPORTED_TRANSLATORS.has(translatorType as RawMessageTranslatorType)) {
    return translatorType as RawMessageTranslatorType
  }
  if (translatorType === 'bergamot') {
    throw new ValidationError('Firefox/Bergamot translation is not supported by server-side raw message translation')
  }
  if (translatorType === 'none') {
    throw new ValidationError('Translation is disabled')
  }
  throw new ValidationError(`Unsupported translator type: ${translatorType}`)
}

function translationLanguages(settings: Record<string, unknown>): { targetLanguage: string; inputLanguage: string } {
  const targetLanguage = stringValue(settings.translator).trim()
  if (!targetLanguage) {
    throw new ValidationError('translator must be configured before translating a message')
  }
  return {
    targetLanguage,
    inputLanguage: stringValue(settings.translatorInputLanguage, 'auto') || 'auto',
  }
}

function translatorNote(character: Record<string, unknown> | undefined): string {
  return stringValue(character?.translatorNote)
}

function translatorSettingsHash(input: {
  settings: Record<string, unknown>
  character?: Record<string, unknown>
  translatorType: RawMessageTranslatorType
  targetLanguage: string
  inputLanguage: string
}): string {
  return sha256(
    stableJson({
      translatorType: input.translatorType,
      targetLanguage: input.targetLanguage,
      inputLanguage: input.inputLanguage,
      translatorPrompt: stringValue(input.settings.translatorPrompt),
      translatorMaxResponse: finiteNumber(input.settings.translatorMaxResponse, 1000),
      translatorNote: translatorNote(input.character),
      aiModel: stringValue(input.settings.aiModel),
      modelProfiles: input.settings.modelProfiles ?? null,
      modelRoleProfiles: input.settings.modelRoleProfiles ?? null,
      modelRuntimeDefaults: input.settings.modelRuntimeDefaults ?? null,
      deeplOptions: {
        freeApi: recordValue(input.settings.deeplOptions).freeApi === true,
      },
      deeplXOptions: {
        url: stringValue(recordValue(input.settings.deeplXOptions).url),
        hasToken: stringValue(recordValue(input.settings.deeplXOptions).token).trim().length > 0,
      },
    }),
  )
}

function isProtectedRawLine(line: string): boolean {
  return (
    line.startsWith('{{img') ||
    line.startsWith('{{raw') ||
    line.startsWith('{{video') ||
    (line.startsWith('{{audio') && line.endsWith('}}')) ||
    line.length === 0
  )
}

async function translatePreservingRawBlocks(
  text: string,
  translateChunk: (chunk: string) => Promise<string>,
): Promise<string> {
  const lines = text.split('\n')
  const chunks: Array<{ text: string; translatable: boolean }> = [{ text: '', translatable: true }]
  for (const line of lines) {
    if (isProtectedRawLine(line)) {
      chunks.push({ text: line, translatable: false }, { text: '', translatable: true })
      continue
    }
    const current = chunks[chunks.length - 1]
    current.text += current.text.length === 0 ? line : `\n${line}`
  }

  const translated: string[] = []
  for (const chunk of chunks) {
    if (!chunk.translatable) {
      translated.push(chunk.text)
      continue
    }
    const trimmed = chunk.text.trim()
    if (!trimmed) {
      translated.push(chunk.text)
      continue
    }
    translated.push((await translateChunk(trimmed)).trim())
  }
  return translated.join('\n').trim()
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function textFromGoogleResponse(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (!Array.isArray(value) || !Array.isArray(value[0])) return null
  return value[0]
    .map((part: unknown) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : ''))
    .filter(Boolean)
    .join('')
}

async function translateWithGoogle(text: string, inputLanguage: string, targetLanguage: string, signal: AbortSignal) {
  const url = new URL('https://translate.googleapis.com/translate_a/single')
  url.searchParams.set('client', 'gtx')
  url.searchParams.set('dt', 't')
  url.searchParams.set('sl', inputLanguage || 'auto')
  url.searchParams.set('tl', targetLanguage)
  url.searchParams.set('q', text)
  const response = await fetch(url, { method: 'GET', signal })
  if (!response.ok) {
    throw new ValidationError(`Google translation failed with HTTP ${response.status}`)
  }
  const translated = textFromGoogleResponse(await readJsonResponse(response))
  if (translated === null) {
    throw new ValidationError('Google translation returned an unexpected response')
  }
  return translated
}

async function translateWithDeepL(
  settings: Record<string, unknown>,
  text: string,
  targetLanguage: string,
  signal: AbortSignal,
) {
  const deeplOptions = recordValue(settings.deeplOptions)
  const key = stringValue(deeplOptions.key).trim()
  if (!key) {
    throw new ValidationError('deeplOptions.key is required for DeepL translation')
  }
  const freeApi = deeplOptions.freeApi === true
  const response = await fetch(
    freeApi ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate',
    {
      method: 'POST',
      signal,
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: [text],
        target_lang: targetLanguage.toUpperCase(),
      }),
    },
  )
  const body = await readJsonResponse(response)
  if (!response.ok) {
    throw new ValidationError(`DeepL translation failed with HTTP ${response.status}`)
  }
  const translations = recordValue(body).translations
  if (!Array.isArray(translations) || typeof translations[0]?.text !== 'string') {
    throw new ValidationError('DeepL translation returned an unexpected response')
  }
  return translations[0].text
}

async function translateWithDeepLX(
  settings: Record<string, unknown>,
  text: string,
  inputLanguage: string,
  targetLanguage: string,
  signal: AbortSignal,
) {
  const deeplXOptions = recordValue(settings.deeplXOptions)
  let url = stringValue(deeplXOptions.url, 'http://localhost:1188').trim() || 'http://localhost:1188'
  if (url.endsWith('/')) url = url.slice(0, -1)
  if (!url.endsWith('/translate')) url += '/translate'

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = stringValue(deeplXOptions.token).trim()
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(url, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({
      text,
      target_lang: targetLanguage.toUpperCase(),
      source_lang: inputLanguage.toUpperCase(),
    }),
  })
  const body = await readJsonResponse(response)
  if (!response.ok) {
    throw new ValidationError(`DeepLX translation failed with HTTP ${response.status}`)
  }
  const translated = recordValue(body).data
  if (typeof translated !== 'string') {
    throw new ValidationError('DeepLX translation returned an unexpected response')
  }
  return translated
}

function parseTranslatorChatML(data: string): OpenAIChat[] | null {
  const starter = '<|im_start|>'
  const separator = '<|im_sep|>'
  const ender = '<|im_end|>'
  const trimmed = data.trim()
  if (!trimmed.startsWith(starter)) return null
  return trimmed
    .split(starter)
    .filter(Boolean)
    .map((part) => {
      let role: OpenAIChat['role'] = 'user'
      let content = part
      for (const candidate of ['system', 'user', 'assistant'] as const) {
        if (content.startsWith(`${candidate}${separator}`)) {
          role = candidate
          content = content.slice(candidate.length + separator.length)
          break
        }
        if (content.startsWith(`${candidate} `) || content.startsWith(`${candidate}\n`)) {
          role = candidate
          content = content.slice(candidate.length + 1)
          break
        }
      }
      content = content.trim()
      if (content.endsWith(ender)) {
        content = content.slice(0, -ender.length)
      }
      return { role, content: content.trim() }
    })
}

function translatorPromptMessages(input: {
  settings: Record<string, unknown>
  text: string
  targetLanguage: string
  inputLanguage: string
  translatorNote: string
}): OpenAIChat[] {
  const promptTemplate = stringValue(input.settings.translatorPrompt) || DEFAULT_TRANSLATOR_PROMPT
  const prompt = promptTemplate
    .replaceAll('{{slot::from}}', input.inputLanguage)
    .replaceAll('{{slot}}', input.targetLanguage)
    .replaceAll('{{solt::content}}', input.text)
    .replaceAll('{{slot::content}}', input.text)
    .replaceAll('{{slot::tnote}}', input.translatorNote)
  const parsed = parseTranslatorChatML(prompt)
  if (parsed) return parsed
  const systemPrompt = promptTemplate
    .replaceAll('{{slot}}', input.targetLanguage)
    .replaceAll('{{slot::tnote}}', input.translatorNote)
    .replaceAll('{{slot::from}}', input.inputLanguage)
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: input.text },
  ]
}

async function collectFrames(frames: AsyncIterable<CompletionStreamFrame>): Promise<string> {
  let result = ''
  for await (const frame of frames) {
    if (frame.kind === 'token') {
      result += frame.content ?? ''
    } else if (frame.kind === 'error') {
      throw new ValidationError(frame.error ?? 'Provider dispatch failed')
    }
  }
  return result
}

async function translateWithLlm(
  settings: Record<string, unknown>,
  character: Record<string, unknown> | undefined,
  text: string,
  inputLanguage: string,
  targetLanguage: string,
  signal: AbortSignal,
) {
  const database = {
    ...settings,
    characters: character ? [character] : [],
    useStreaming: false,
  } as unknown as Database
  let profile = resolveModelProfile({ database, role: 'translate' })
  if (profile.modelId.length === 0) {
    profile = resolveModelProfile({ database, role: 'translate', staticModel: 'echo_model' })
  }
  assertModelProfileGenerationReady(profile)
  const maxResponse = finiteNumber(settings.translatorMaxResponse, profile.runtimeOptions.maxResponse ?? 1000)
  const dispatchDatabase = {
    ...database,
    aiModel: profile.modelId,
    maxResponse,
  } as Database
  return collectFrames(
    await dispatchChatProvider({
      database: dispatchDatabase,
      formated: translatorPromptMessages({
        settings,
        text,
        inputLanguage,
        targetLanguage,
        translatorNote: translatorNote(character),
      }),
      outputTokens: maxResponse,
      profile,
      signal,
    }),
  )
}

export async function translateRawMessageData(input: RawMessageTranslationInput): Promise<RawMessageTranslation> {
  const translatorType = translatorTypeFromSettings(input.settings)
  const { targetLanguage, inputLanguage } = translationLanguages(input.settings)
  const translateChunk = async (chunk: string): Promise<string> => {
    if (translatorType === 'google') return translateWithGoogle(chunk, inputLanguage, targetLanguage, input.signal)
    if (translatorType === 'deepl') return translateWithDeepL(input.settings, chunk, targetLanguage, input.signal)
    if (translatorType === 'deeplX') {
      return translateWithDeepLX(input.settings, chunk, inputLanguage, targetLanguage, input.signal)
    }
    return translateWithLlm(input.settings, input.character, chunk, inputLanguage, targetLanguage, input.signal)
  }

  return {
    text: await translatePreservingRawBlocks(input.text, translateChunk),
    source: 'raw',
    sourceHash: sha256(input.text),
    targetLanguage,
    inputLanguage,
    translatorType,
    settingsHash: translatorSettingsHash({
      settings: input.settings,
      character: input.character,
      translatorType,
      targetLanguage,
      inputLanguage,
    }),
    updatedAt: Date.now(),
  }
}
