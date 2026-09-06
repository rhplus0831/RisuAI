import type { Tiktoken } from '@dqbd/tiktoken'
import type { Tokenizer } from '@mlc-ai/web-tokenizers'
import { type character, type Chat, type Database, getCurrentCharacter } from './storage/database.svelte'
import type { MultiModal, OpenAIChat } from './process/index.svelte'
import { supportsInlayImage } from './process/files/inlays'
import { risuChatParser } from './parser/parser.svelte'
import { tokenizeGGUFModel } from './process/models/local'
import { globalFetch } from './globalApi.svelte'
import { getModelInfo, LLMTokenizer, type LLMModel } from './model/modellist'
import { isPluginRuntimeReady, pluginV2 } from './plugins/plugins.svelte'
import type { GemmaTokenizer } from '@huggingface/transformers'
import { LRUMap } from 'mnemonist'
import { providerOperationCredential, requestProviderOperation } from './server/providerOperations'
import {
  resolveModelProfile,
  resolveModelProfileTokenizerSelection,
  type ResolvedModelProfile,
} from './model/modelProfileResolver'
import { settingsResourceState } from './server/resourceState.svelte'

const MAX_CACHE_SIZE = 1500
export const GOOGLE_CLOUD_TOKENIZED_CACHE_LIMIT = MAX_CACHE_SIZE

const encodeCache = new LRUMap<string, number[] | Uint32Array | Int32Array>(MAX_CACHE_SIZE)

function getHash(
  data: string,
  aiModel: string,
  customTokenizer: string,
  currentPluginProvider: string,
  googleClaudeTokenizing: boolean,
  modelInfo: LLMModel,
  pluginTokenizer: string,
): string {
  const combined = `${data}::${aiModel}::${customTokenizer}::${currentPluginProvider}::${googleClaudeTokenizing ? '1' : '0'}::${modelInfo.tokenizer}::${pluginTokenizer}`
  return combined
}

export async function encodeWithTokenizer(
  data: string,
  tokenizerType: string,
): Promise<number[] | Uint32Array | Int32Array> {
  switch (tokenizerType) {
    case 'tik':
      return await tikJS(data, 'cl100k_base')
    case 'cl100k_base':
      return await tikJS(data, 'cl100k_base')
    case 'o200k_base':
      return await tikJS(data, 'o200k_base')
    case 'mistral':
      return await tokenizeWebTokenizers(data, 'mistral')
    case 'novelai':
      return await tokenizeWebTokenizers(data, 'novelai')
    case 'claude':
      return await tokenizeWebTokenizers(data, 'claude')
    case 'llama':
      return await tokenizeWebTokenizers(data, 'llama')
    case 'llama3':
      return await tokenizeWebTokenizers(data, 'llama3')
    case 'novellist':
      return await tokenizeWebTokenizers(data, 'novellist')
    case 'gemma':
      return await gemmaTokenize(data)
    case 'cohere':
      return await tokenizeWebTokenizers(data, 'cohere')
    case 'deepseek':
      return await tokenizeWebTokenizers(data, 'DeepSeek')
    case 'deepseek-v4':
      return await tokenizeWebTokenizers(data, 'DeepSeekV4')
    case 'glm4':
      return await tokenizeWebTokenizers(data, 'GLM4')
    case 'glm5':
      return await tokenizeWebTokenizers(data, 'GLM5')
    default:
      return await tikJS(data, 'cl100k_base')
  }
}

/**
 * Resolve the settings snapshot used by tokenizer-only public helpers.
 *
 * Normal runtime reads the authoritative settings owner. Public callers that
 * need to run outside owner readiness must provide an explicit captured
 * snapshot.
 */
export function resolveTokenizerDatabaseSnapshot(database?: Database): Database {
  if (database) return database
  if (settingsResourceState.status === 'ready') {
    return settingsResourceState.value as Database
  }
  throw new Error('Tokenizer settings owner unavailable')
}

export function resolveMainTokenizerProfile(database?: Database): ResolvedModelProfile {
  const resolvedDatabase = resolveTokenizerDatabaseSnapshot(database)
  return resolveModelProfile({
    database: resolvedDatabase,
    role: 'chatMain',
    lookupModelInfo: (_modelDatabase, modelId) => getModelInfo(modelId, resolvedDatabase),
  })
}

export async function encode(
  data: string,
  profile?: ResolvedModelProfile,
  tokenizerSelection?: string,
  database?: Database,
): Promise<number[] | Uint32Array | Int32Array> {
  const db = resolveTokenizerDatabaseSnapshot(database)
  const resolvedProfile = profile ?? resolveMainTokenizerProfile(db)
  const aiModel = resolvedProfile.modelId
  const modelInfo = resolvedProfile.modelInfo
  const customTokenizer = tokenizerSelection ?? resolveModelProfileTokenizerSelection(db, resolvedProfile)
  const pluginTokenizer = isPluginRuntimeReady()
    ? (pluginV2.providerOptions.get(db.currentPluginProvider)?.tokenizer ?? 'none')
    : 'none'

  let cacheKey = ''
  if (db.useTokenizerCaching) {
    cacheKey = getHash(
      data,
      aiModel,
      customTokenizer,
      db.currentPluginProvider,
      db.googleClaudeTokenizing,
      modelInfo,
      pluginTokenizer,
    )
    const cachedResult = encodeCache.get(cacheKey)
    if (cachedResult !== undefined) {
      return cachedResult
    }
  }

  let result: number[] | Uint32Array | Int32Array

  if (aiModel === 'openrouter' || aiModel === 'reverse_proxy') {
    switch (customTokenizer) {
      case 'cl100k_base':
        result = await tikJS(data, 'cl100k_base')
        break
      case 'o200k_base':
        result = await tikJS(data, 'o200k_base')
        break
      case 'mistral':
        result = await tokenizeWebTokenizers(data, 'mistral')
        break
      case 'llama':
        result = await tokenizeWebTokenizers(data, 'llama')
        break
      case 'novelai':
        result = await tokenizeWebTokenizers(data, 'novelai')
        break
      case 'claude':
        result = await tokenizeWebTokenizers(data, 'claude')
        break
      case 'novellist':
        result = await tokenizeWebTokenizers(data, 'novellist')
        break
      case 'llama3':
        result = await tokenizeWebTokenizers(data, 'llama')
        break
      case 'gemma':
        result = await gemmaTokenize(data)
        break
      case 'cohere':
        result = await tokenizeWebTokenizers(data, 'cohere')
        break
      case 'deepseek':
        result = await tokenizeWebTokenizers(data, 'DeepSeek')
        break
      case 'deepseek-v4':
        result = await tokenizeWebTokenizers(data, 'DeepSeekV4')
        break
      case 'glm4':
        result = await tokenizeWebTokenizers(data, 'GLM4')
        break
      case 'glm5':
        result = await tokenizeWebTokenizers(data, 'GLM5')
        break
      default:
        result = await tikJS(data, 'o200k_base')
        break
    }
  } else if (aiModel === 'custom' && pluginTokenizer) {
    switch (pluginTokenizer) {
      case 'mistral':
        result = await tokenizeWebTokenizers(data, 'mistral')
        break
      case 'llama':
        result = await tokenizeWebTokenizers(data, 'llama')
        break
      case 'novelai':
        result = await tokenizeWebTokenizers(data, 'novelai')
        break
      case 'claude':
        result = await tokenizeWebTokenizers(data, 'claude')
        break
      case 'novellist':
        result = await tokenizeWebTokenizers(data, 'novellist')
        break
      case 'llama3':
        result = await tokenizeWebTokenizers(data, 'llama')
        break
      case 'gemma':
        result = await gemmaTokenize(data)
        break
      case 'cohere':
        result = await tokenizeWebTokenizers(data, 'cohere')
        break
      case 'deepseek':
        result = await tokenizeWebTokenizers(data, 'DeepSeek')
        break
      case 'deepseek-v4':
        result = await tokenizeWebTokenizers(data, 'DeepSeekV4')
        break
      case 'glm4':
        result = await tokenizeWebTokenizers(data, 'GLM4')
        break
      case 'glm5':
        result = await tokenizeWebTokenizers(data, 'GLM5')
        break
      case 'o200k_base':
        result = await tikJS(data, 'o200k_base')
        break
      case 'cl100k_base':
        result = await tikJS(data, 'cl100k_base')
        break
      case 'custom':
        result = isPluginRuntimeReady()
          ? ((await pluginV2.providerOptions.get(db.currentPluginProvider)?.tokenizerFunc?.(data)) ?? [0])
          : [0]
        break
      default:
        result = await tikJS(data, 'o200k_base')
        break
    }
  }

  // Fallback
  if (result === undefined) {
    if (modelInfo.tokenizer === LLMTokenizer.NovelList) {
      result = await tokenizeWebTokenizers(data, 'novellist')
    } else if (modelInfo.tokenizer === LLMTokenizer.Claude) {
      result = await tokenizeWebTokenizers(data, 'claude')
    } else if (modelInfo.tokenizer === LLMTokenizer.NovelAI) {
      result = await tokenizeWebTokenizers(data, 'novelai')
    } else if (modelInfo.tokenizer === LLMTokenizer.Mistral) {
      result = await tokenizeWebTokenizers(data, 'mistral')
    } else if (modelInfo.tokenizer === LLMTokenizer.Llama) {
      result = await tokenizeWebTokenizers(data, 'llama')
    } else if (modelInfo.tokenizer === LLMTokenizer.Local) {
      result = await tokenizeGGUFModel(data)
    } else if (modelInfo.tokenizer === LLMTokenizer.tiktokenO200Base) {
      result = await tikJS(data, 'o200k_base')
    } else if (modelInfo.tokenizer === LLMTokenizer.GoogleCloud && db.googleClaudeTokenizing) {
      result = await tokenizeGoogleCloud(data, resolvedProfile)
    } else if (modelInfo.tokenizer === LLMTokenizer.Gemma || modelInfo.tokenizer === LLMTokenizer.GoogleCloud) {
      result = await gemmaTokenize(data)
    } else if (modelInfo.tokenizer === LLMTokenizer.DeepSeek) {
      result = await tokenizeWebTokenizers(data, 'DeepSeek')
    } else if (modelInfo.tokenizer === LLMTokenizer.DeepSeekV4) {
      result = await tokenizeWebTokenizers(data, 'DeepSeekV4')
    } else if (modelInfo.tokenizer === LLMTokenizer.GLM4) {
      result = await tokenizeWebTokenizers(data, 'GLM4')
    } else if (modelInfo.tokenizer === LLMTokenizer.GLM5) {
      result = await tokenizeWebTokenizers(data, 'GLM5')
    } else if (modelInfo.tokenizer === LLMTokenizer.Cohere) {
      result = await tokenizeWebTokenizers(data, 'cohere')
    } else {
      result = await tikJS(data)
    }
  }
  if (db.useTokenizerCaching) {
    encodeCache.set(cacheKey, result)
  }

  return result
}

type tokenizerType =
  | 'novellist'
  | 'claude'
  | 'novelai'
  | 'llama'
  | 'mistral'
  | 'llama3'
  | 'gemma'
  | 'cohere'
  | 'googleCloud'
  | 'DeepSeek'
  | 'DeepSeekV4'
  | 'GLM4'
  | 'GLM5'

let tikParser: Tiktoken = null
let tokenizersTokenizer: Tokenizer = null
let tokenizersType: tokenizerType = null
let lastTikModel = 'cl100k_base'

const googleCloudTokenizedCache = new LRUMap<string, number>(GOOGLE_CLOUD_TOKENIZED_CACHE_LIMIT)

function getGoogleCloudTokenizedCacheKey(text: string, aiModel: string, internalID: string): string {
  return JSON.stringify(['googleCloud', aiModel, internalID, text])
}

async function tokenizeGoogleCloud(text: string, profile: ResolvedModelProfile) {
  const model = profile.modelInfo
  const cacheKey = getGoogleCloudTokenizedCacheKey(text, profile.modelId, model.internalID)

  const cachedCount = googleCloudTokenizedCache.get(cacheKey)
  if (cachedCount !== undefined) {
    const count = cachedCount
    return new Uint32Array(count)
  }

  let count: number
  try {
    const result = await requestProviderOperation<{ totalTokens?: unknown }>('google.count-tokens', {
      credential: providerOperationCredential(profile.providerOptions.apiKey),
      input: { modelId: model.internalID, text },
    })
    if (
      typeof result.totalTokens !== 'number' ||
      !Number.isSafeInteger(result.totalTokens) ||
      result.totalTokens < 0 ||
      result.totalTokens > 2_000_000
    ) {
      throw new Error('Google token count response was malformed')
    }
    count = result.totalTokens
  } catch {
    return await tokenizeWebTokenizers(text, 'gemma')
  }

  googleCloudTokenizedCache.set(cacheKey, count)

  return new Uint32Array(count)
}

let gemmaTokenizer: GemmaTokenizer = null
async function gemmaTokenize(text: string) {
  if (!gemmaTokenizer) {
    const { GemmaTokenizer } = await import('@huggingface/transformers')
    gemmaTokenizer = new GemmaTokenizer(await (await fetch('/token/llama/llama3.json')).json(), {})
  }
  return gemmaTokenizer.encode(text)
}

async function tikJS(text: string, model = 'cl100k_base') {
  if (!tikParser || lastTikModel !== model) {
    tikParser?.free()
    if (model === 'cl100k_base') {
      const { Tiktoken } = await import('@dqbd/tiktoken')
      const cl100k_base = await import('@dqbd/tiktoken/encoders/cl100k_base.json')
      lastTikModel = model

      tikParser = new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)
    }
    if (model === 'o200k_base') {
      const { Tiktoken } = await import('@dqbd/tiktoken')
      const o200k_base = await import('src/etc/o200k_base.json')
      lastTikModel = model
      tikParser = new Tiktoken(o200k_base.bpe_ranks, o200k_base.special_tokens, o200k_base.pat_str)
    }
  }
  return tikParser.encode(text)
}

async function geminiTokenizer(text: string, profile: ResolvedModelProfile) {
  const fetchResult = await globalFetch(
    `https://generativelanguage.googleapis.com/v1beta/${profile.modelId}:countTextTokens`,
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${profile.providerOptions.apiKey ?? ''}`,
      },
      body: JSON.stringify({
        prompt: {
          text: text,
        },
      }),
      method: 'POST',
    },
  )

  if (!fetchResult.ok) {
    //fallback to tiktoken
    return await tikJS(text)
  }

  const result = fetchResult.data

  return result.tokenCount ?? 0
}

async function tokenizeWebTokenizers(text: string, type: tokenizerType) {
  if (type !== tokenizersType || !tokenizersTokenizer) {
    const webTokenizer = await import('@mlc-ai/web-tokenizers')
    switch (type) {
      case 'novellist':
        tokenizersTokenizer = await webTokenizer.Tokenizer.fromSentencePiece(
          await (await fetch('/token/trin/spiece.model')).arrayBuffer(),
        )
        break
      case 'claude':
        tokenizersTokenizer = await webTokenizer.Tokenizer.fromJSON(
          await (await fetch('/token/claude/claude.json')).arrayBuffer(),
        )
        break
      case 'llama3':
        tokenizersTokenizer = await webTokenizer.Tokenizer.fromJSON(
          await (await fetch('/token/llama/llama3.json')).arrayBuffer(),
        )
        break
      case 'cohere':
        tokenizersTokenizer = await webTokenizer.Tokenizer.fromJSON(
          await (await fetch('/token/cohere/tokenizer.json')).arrayBuffer(),
        )
        break
      case 'novelai':
        tokenizersTokenizer = await webTokenizer.Tokenizer.fromSentencePiece(
          await (await fetch('/token/nai/nerdstash_v2.model')).arrayBuffer(),
        )

        break
      case 'llama':
        tokenizersTokenizer = await webTokenizer.Tokenizer.fromSentencePiece(
          await (await fetch('/token/llama/llama.model')).arrayBuffer(),
        )
        break
      case 'mistral':
        tokenizersTokenizer = await webTokenizer.Tokenizer.fromSentencePiece(
          await (await fetch('/token/mistral/tokenizer.model')).arrayBuffer(),
        )
        break
      case 'gemma':
        tokenizersTokenizer = await webTokenizer.Tokenizer.fromSentencePiece(
          await (await fetch('/token/gemma/tokenizer.model')).arrayBuffer(),
        )
        break
      case 'DeepSeek':
        tokenizersTokenizer = await webTokenizer.Tokenizer.fromJSON(
          await (await fetch('/token/deepseek/tokenizer.json')).arrayBuffer(),
        )
        break
      case 'DeepSeekV4':
        tokenizersTokenizer = await webTokenizer.Tokenizer.fromJSON(
          await (await fetch('/token/deepseek/v4/tokenizer.json')).arrayBuffer(),
        )
        break
      case 'GLM4':
        tokenizersTokenizer = await webTokenizer.Tokenizer.fromJSON(
          await (await fetch('/token/glm4/tokenizer.json')).arrayBuffer(),
        )
        break
      case 'GLM5':
        tokenizersTokenizer = await webTokenizer.Tokenizer.fromJSON(
          await (await fetch('/token/glm5/tokenizer.json')).arrayBuffer(),
        )
        break
    }
    tokenizersType = type
  }
  return tokenizersTokenizer.encode(text)
}

export async function tokenizerChar(char: character, database?: Database) {
  const encoded = await encode(char.name + '\n' + char.firstMessage + '\n' + char.desc, undefined, undefined, database)
  return encoded.length
}

export async function tokenize(data: string, database?: Database) {
  const encoded = await encode(data, undefined, undefined, database)
  return encoded.length
}

export async function tokenizeAccurate(data: string, consistantChar?: boolean, database?: Database) {
  data = risuChatParser(data.replace('{{slot}}', ''), {
    tokenizeAccurate: true,
    consistantChar: consistantChar,
  })
  const encoded = await encode(data, undefined, undefined, database)
  return encoded.length
}

export class ChatTokenizer {
  private chatAdditionalTokens: number
  private useName: 'name' | 'noName'
  private profile?: ResolvedModelProfile
  private tokenizerSelection?: string
  private database?: Database

  constructor(
    chatAdditionalTokens: number,
    useName: 'name' | 'noName',
    profile?: ResolvedModelProfile,
    tokenizerSelection?: string,
    database?: Database,
  ) {
    this.chatAdditionalTokens = chatAdditionalTokens
    this.useName = useName
    this.profile = profile
    this.tokenizerSelection = tokenizerSelection
    this.database = database
  }
  async tokenizeChat(
    data: OpenAIChat,
    args: {
      countThoughts?: boolean
    } = {},
  ) {
    let encoded =
      (await encode(data.content, this.profile, this.tokenizerSelection, this.database)).length +
      this.chatAdditionalTokens
    if (data.name && this.useName === 'name') {
      encoded += (await encode(data.name, this.profile, this.tokenizerSelection, this.database)).length + 1
    }
    if (data.multimodals && data.multimodals.length > 0) {
      for (const multimodal of data.multimodals) {
        encoded += await this.tokenizeMultiModal(multimodal)
      }
    }
    if (data.thoughts && data.thoughts.length > 0 && args.countThoughts) {
      for (const thought of data.thoughts) {
        encoded += (await encode(thought, this.profile, this.tokenizerSelection, this.database)).length + 1
      }
    }
    return encoded
  }
  async tokenizeChats(data: OpenAIChat[]) {
    let encoded = 0
    for (const chat of data) {
      encoded += await this.tokenizeChat(chat)
    }
    return encoded
  }

  tokenizeMultiModal(data: MultiModal) {
    const db = resolveTokenizerDatabaseSnapshot(this.database)
    if (!supportsInlayImage(this.profile?.modelInfo)) {
      return this.chatAdditionalTokens
    }
    if (db.gptVisionQuality === 'low') {
      return 87
    }

    let encoded = this.chatAdditionalTokens
    let height = data.height ?? 0
    let width = data.width ?? 0

    if (height === width) {
      if (height > 768) {
        height = 768
        width = 768
      }
    } else if (height > width) {
      if (width > 768) {
        width = 768
        height = height * (768 / width)
      }
    } else {
      if (height > 768) {
        height = 768
        width = width * (768 / height)
      }
    }

    const chunkSize = Math.ceil(width / 512) * Math.ceil(height / 512)
    encoded += chunkSize * 2
    encoded += 85

    return encoded
  }
}

export async function tokenizeNum(data: string, database?: Database) {
  const encoded = await encode(data, undefined, undefined, database)
  return encoded
}

export async function strongBan(data: string, bias: { [key: number]: number }, database?: Database) {
  if (localStorage.getItem('strongBan_' + data)) {
    return JSON.parse(localStorage.getItem('strongBan_' + data))
  }
  const performace = performance.now()
  const length = Object.keys(bias).length
  let charAlt = [
    data,
    data.trim(),
    data.toLocaleUpperCase(),
    data.toLocaleLowerCase(),
    data[0].toLocaleUpperCase() + data.slice(1),
    data[0].toLocaleLowerCase() + data.slice(1),
  ]

  let banChars = ' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~“”‘’«»「」…–―※'
  let unbanChars: number[] = []

  for (const char of banChars) {
    unbanChars.push((await tokenizeNum(char, database))[0])
  }

  for (const char of banChars) {
    const encoded = await tokenizeNum(char, database)
    if (encoded.length > 0) {
      if (!unbanChars.includes(encoded[0])) {
        bias[encoded[0]] = -100
      }
    }
    for (const alt of charAlt) {
      let fchar = char

      const encoded = await tokenizeNum(alt + fchar, database)
      if (encoded.length > 0) {
        if (!unbanChars.includes(encoded[0])) {
          bias[encoded[0]] = -100
        }
      }
      const encoded2 = await tokenizeNum(fchar + alt, database)
      if (encoded2.length > 0) {
        if (!unbanChars.includes(encoded2[0])) {
          bias[encoded2[0]] = -100
        }
      }
    }
  }
  localStorage.setItem('strongBan_' + data, JSON.stringify(bias))
  return bias
}

export async function getCharToken(char?: character | null, database?: Database) {
  let persistant = 0
  let dynamic = 0

  if (!char) {
    const c = getCurrentCharacter()
    char = c
  }
  if (!char) {
    return { persistant: 0, dynamic: 0 }
  }

  const basicTokenize = async (data: string) => {
    data = data.replace(/{{char}}/g, char.name).replace(/<char>/g, char.name)
    return await tokenize(data, database)
  }

  persistant += await basicTokenize(char.desc)
  persistant += await basicTokenize(char.personality ?? '')
  persistant += await basicTokenize(char.scenario ?? '')
  for (const lore of char.globalLore) {
    let cont = lore.content
      .split('\n')
      .filter((line) => {
        if (line.startsWith('@@')) {
          return false
        }
        if (line === '') {
          return false
        }
        return true
      })
      .join('\n')
    dynamic += await basicTokenize(cont)
  }

  return { persistant, dynamic }
}

export async function getChatToken(chat: Chat, database?: Database) {
  let persistant = 0

  const chatTokenizer = new ChatTokenizer(0, 'name', undefined, undefined, database)
  const chatf = chat.message.map((d) => {
    return {
      role: d.role === 'user' ? 'user' : 'assistant',
      content: d.data,
    } as OpenAIChat
  })
  for (const chat of chatf) {
    persistant += await chatTokenizer.tokenizeChat(chat)
  }

  return persistant
}
