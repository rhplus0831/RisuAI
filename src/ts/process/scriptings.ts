import { asBuffer } from 'src/ts/util'
import { getChatVar, getGlobalChatVar, setChatVar } from '../parser/chatVar.svelte'
import { hasher, type simpleCharacterArgument, risuChatParser } from '../parser/parser.svelte'
import { LuaEngine, LuaFactory } from 'wasmoon'
import { get } from 'svelte/store'
import {
  getCharacterByIndex,
  getCurrentCharacter,
  getCurrentChat,
  getDatabase,
  setCharacterByIndex,
  setDatabase,
  type Chat,
  type character,
  type triggerscript,
} from '../storage/database.svelte'
import { reloadChatAt, reloadGuiDisplay, selectedCharID } from '../stores.svelte'
import { alertSelect, alertError, alertInput, alertNormal, alertConfirm } from '../alert'
import { HypaProcesser } from './memory/hypamemory'
import { generateAIImage } from './stableDiff'
import { writeInlayImage, getInlayAsset } from './files/inlays'
import type { OpenAIChat, MultiModal } from './index.svelte'
import { requestChatData, type StreamResponseChunk } from './request/request'
import { v4 } from 'uuid'
import { getModuleLorebooks, getModuleTriggers } from './modules'
import { Mutex } from '../mutex'
import { tokenize } from '../tokenizer'
import { fetchNative, readImage } from '../globalApi.svelte'
import { loadLoreBookV3Prompt } from './lorebook.svelte'
import { getPersonaPrompt, getUserName, getUserIcon, parseKeyValue } from '../util'
import { safeStructuredClone } from '../polyfill'
let luaFactory: LuaFactory
let ScriptingSafeIds = new Set<string>()
let ScriptingEditDisplayIds = new Set<string>()
let ScriptingLowLevelIds = new Set<string>()
let lastRequestResetTime = 0
let lastRequestsCount = 0

export const DEFAULT_CLIENT_LUA_EXEC_TIMEOUT_MS = 3_000
export const CLIENT_LUA_ENGINE_CACHE_PER_MODE = 4
const CLIENT_LUA_CODE_HASH_MEMO_LIMIT = 128

interface BasicScriptingEngineState {
  code?: string
  cacheKey?: string
  cacheBucket?: string
  activeRuns?: number
  mutex: Mutex
  chat?: Chat
  setVar?: (key: string, value: string) => void
  getVar?: (key: string) => string
}

interface LuaScriptingEngineState extends BasicScriptingEngineState {
  engine?: LuaEngine
  execTimeoutMs?: number
  type: 'lua'
}

interface PythonScriptingEngineState extends BasicScriptingEngineState {
  pyodide?: PyodideContext
  type: 'py'
}

type ScriptingEngineState = LuaScriptingEngineState | PythonScriptingEngineState

let ScriptingEngines = new Map<string, ScriptingEngineState>()
let ScriptingEngineLru = new Map<string, string[]>()
let ScriptingCodeHashMemo = new Map<string, string>()
let luaFactoryPromise: Promise<void> | null = null
let pendingEngineCreations = new Map<string, Promise<ScriptingEngineState>>()

export async function runScripted(
  code: string,
  arg: {
    char?: character | simpleCharacterArgument
    chat?: Chat
    data?: string | OpenAIChat[]
    setVar?: (key: string, value: string) => void
    getVar?: (key: string) => string
    lowLevelAccess?: boolean
    meta?: object
    mode?: string
    type?: 'lua' | 'py'
    luaExecTimeoutMs?: number
  },
) {
  const type: 'lua' | 'py' = arg.type ?? 'lua'
  const char = arg.char ?? getCurrentCharacter()
  const data = arg.data ?? ''
  const setVar = arg.setVar ?? setChatVar
  const getVar = arg.getVar ?? getChatVar
  const meta = arg.meta ?? {}
  const mode = arg.mode ?? 'manual'
  const luaExecTimeoutMs = arg.luaExecTimeoutMs ?? DEFAULT_CLIENT_LUA_EXEC_TIMEOUT_MS

  let chat = arg.chat ?? getCurrentChat()
  let stopSending = false
  let lowLevelAccess = arg.lowLevelAccess ?? false

  if (type === 'lua') {
    await ensureLuaFactory()
  }
  const codeHash = type === 'lua' ? await hashScriptingCode(code) : undefined
  let ScriptingEngineState = await getOrCreateEngineState(mode, type, codeHash)
  ScriptingEngineState.activeRuns = (ScriptingEngineState.activeRuns ?? 0) + 1

  const runResult = ScriptingEngineState.mutex.runExclusive(async () => {
    ScriptingEngineState.chat = chat
    ScriptingEngineState.setVar = setVar
    ScriptingEngineState.getVar = getVar
    const shouldRecreateLuaEngine =
      ScriptingEngineState.type === 'lua' &&
      (code !== ScriptingEngineState.code || ScriptingEngineState.execTimeoutMs !== luaExecTimeoutMs)
    if (
      code !== ScriptingEngineState.code ||
      shouldRecreateLuaEngine ||
      (ScriptingEngineState.type === 'py' && !ScriptingEngineState.pyodide)
    ) {
      let declareAPI: (name: string, func: Function) => void

      if (ScriptingEngineState.type === 'lua') {
        console.log('Creating new Lua engine for mode:', mode)
        ScriptingEngineState.engine?.global.close()
        ScriptingEngineState.code = code
        ScriptingEngineState.execTimeoutMs = luaExecTimeoutMs
        ScriptingEngineState.engine = await luaFactory.createEngine({
          injectObjects: true,
          functionTimeout: luaExecTimeoutMs,
        })
        const luaEngine = ScriptingEngineState.engine
        declareAPI = (name: string, func: Function) => {
          luaEngine.global.set(name, func)
        }
      }
      if (ScriptingEngineState.type === 'py') {
        console.log('Creating new Pyodide context for mode:', mode)
        ScriptingEngineState.pyodide?.close()
        ScriptingEngineState.pyodide = new PyodideContext()
        declareAPI = (name: string, func: Function) => {
          ScriptingEngineState.pyodide?.declareAPI(name, func as any)
        }
      }
      declareAPI('getChatVar', (id: string, key: string) => {
        return ScriptingEngineState.getVar(key)
      })
      declareAPI('setChatVar', (id: string, key: string, value: string) => {
        if (!ScriptingSafeIds.has(id) && !ScriptingEditDisplayIds.has(id)) {
          return
        }
        ScriptingEngineState.setVar(key, value)
      })
      declareAPI('getGlobalVar', (id: string, key: string) => {
        return getGlobalChatVar(key)
      })
      declareAPI('stopChat', (id: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        stopSending = true
      })
      declareAPI('alertError', (id: string, value: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        alertError(value)
      })
      declareAPI('alertNormal', (id: string, value: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        alertNormal(value)
      })
      declareAPI('alertInput', (id: string, value: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        return alertInput(value)
      })
      declareAPI('alertSelect', (id: string, value: string[]) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        return alertSelect(value)
      })
      declareAPI('alertConfirm', (id: string, value: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        return alertConfirm(value).then((res) => (res ? true : false))
      })

      declareAPI('getChatMain', (id: string, index: number) => {
        const chat = ScriptingEngineState.chat.message.at(index)
        if (!chat) {
          return JSON.stringify(null)
        }
        const data = {
          role: chat.role,
          data: chat.data,
          time: chat.time ?? 0,
        }
        return JSON.stringify(data)
      })

      declareAPI('setChat', (id: string, index: number, value: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        const message = ScriptingEngineState.chat.message?.at(index)
        if (message) {
          message.data = value ?? ''
        }
      })
      declareAPI('setChatRole', (id: string, index: number, value: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        const message = ScriptingEngineState.chat.message?.at(index)
        if (message) {
          message.role = value === 'user' ? 'user' : 'char'
        }
      })
      declareAPI('cutChat', (id: string, start: number, end: number) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        ScriptingEngineState.chat.message = ScriptingEngineState.chat.message.slice(start, end)
      })
      declareAPI('removeChat', (id: string, index: number) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        ScriptingEngineState.chat.message.splice(index, 1)
      })
      declareAPI('addChat', (id: string, role: string, value: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        let roleData: 'user' | 'char' = role === 'user' ? 'user' : 'char'
        ScriptingEngineState.chat.message.push({ role: roleData, data: value ?? '' })
      })
      declareAPI('insertChat', (id: string, index: number, role: string, value: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        let roleData: 'user' | 'char' = role === 'user' ? 'user' : 'char'
        ScriptingEngineState.chat.message.splice(index, 0, { role: roleData, data: value ?? '' })
      })

      declareAPI('getTokens', async (id: string, value: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        return await tokenize(value)
      })

      declareAPI('getChatLength', (id: string) => {
        return ScriptingEngineState.chat.message.length
      })

      declareAPI('getFullChatMain', (id: string) => {
        const data = JSON.stringify(
          ScriptingEngineState.chat.message.map((v) => {
            return {
              role: v.role,
              data: v.data,
              time: v.time ?? 0,
            }
          }),
        )
        return data
      })

      declareAPI('sleep', (id: string, time: number) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(true)
          }, time)
        })
      })

      declareAPI('cbs', (value) => {
        return risuChatParser(value, { chara: getCurrentCharacter() })
      })

      declareAPI('setFullChatMain', (id: string, value: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        const realValue = JSON.parse(value)

        ScriptingEngineState.chat.message = realValue.map((v) => {
          return {
            role: v.role,
            data: v.data,
          }
        })
      })

      declareAPI('logMain', (value: string) => {
        console.log(JSON.parse(value))
      })

      declareAPI('reloadDisplay', (id: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        reloadGuiDisplay()
      })

      declareAPI('reloadChat', (id: string, index: number) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        reloadChatAt(index)
      })

      //Low Level Access
      declareAPI('similarity', async (id: string, source: string, value: string[]) => {
        if (!ScriptingLowLevelIds.has(id)) {
          return
        }
        const processer = new HypaProcesser()
        await processer.addText(value)
        return await processer.similaritySearch(source)
      })

      declareAPI('request', async (id: string, url: string) => {
        if (!ScriptingLowLevelIds.has(id)) {
          return
        }

        if (lastRequestResetTime + 60000 < Date.now()) {
          lastRequestsCount = 0
          lastRequestResetTime = Date.now()
        }

        if (lastRequestsCount > 5) {
          return JSON.stringify({
            status: 429,
            data: 'Too many requests. you can request 5 times per minute',
          })
        }

        lastRequestsCount++

        try {
          //for security and other reasons, only get request in 120 char is allowed
          if (url.length > 120) {
            return JSON.stringify({
              status: 413,
              data: 'URL to large. max is 120 characters',
            })
          }

          if (!url.startsWith('https://')) {
            return JSON.stringify({
              status: 400,
              data: 'Only https requests are allowed',
            })
          }

          const bannedURL = ['https://realm.risuai.net', 'https://risuai.net', 'https://risuai.xyz']

          for (const burl of bannedURL) {
            if (url.startsWith(burl)) {
              return JSON.stringify({
                status: 400,
                data: 'request to ' + url + ' is not allowed',
              })
            }
          }

          //browser fetch
          const d = await fetchNative(url, {
            method: 'GET',
          })
          const text = await d.text()
          return JSON.stringify({
            status: d.status,
            data: text,
          })
        } catch (error) {
          return JSON.stringify({
            status: 400,
            data: 'internal error',
          })
        }
      })

      declareAPI('generateImage', async (id: string, value: string, negValue: string = '') => {
        if (!ScriptingLowLevelIds.has(id)) {
          return
        }
        const gen = await generateAIImage(value, char as character, negValue, 'inlay')
        if (!gen) {
          return 'Error: Image generation failed'
        }
        const imgHTML = new Image()
        imgHTML.src = gen
        const inlay = await writeInlayImage(imgHTML)
        return `{{inlay::${inlay}}}`
      })

      declareAPI('getCharacterImageMain', async (id: string) => {
        try {
          const db = getDatabase()
          const selectedChar = get(selectedCharID)

          if (selectedChar < 0 || selectedChar >= db.characters.length) {
            return ''
          }

          const character = db.characters[selectedChar]

          if (!character || !character.image) {
            return ''
          }

          const img = await readImage(character.image)
          const imgObj = new Image()
          const extention = character.image.split('.').at(-1)
          const imgURL = URL.createObjectURL(new Blob([asBuffer(img)], { type: `image/${extention}` }))

          let imgid: string | null = null
          try {
            imgObj.src = imgURL
            imgid = await writeInlayImage(imgObj, {
              name: character.image,
              ext: extention,
              id: character.image,
            })
          } finally {
            URL.revokeObjectURL(imgURL)
          }

          if (imgid) {
            return `{{inlayed::${imgid}}}`
          }
          console.warn('Failed to create character image inlay')
          return ''
        } catch (error) {
          console.error('Error in getCharacterImageMain:', error)
          return ''
        }
      })

      declareAPI('getPersonaImageMain', async (id: string) => {
        try {
          const icon = getUserIcon()

          if (!icon) {
            return ''
          }

          const img = await readImage(icon)
          const imgObj = new Image()
          const extention = icon.split('.').at(-1)
          const imgURL = URL.createObjectURL(new Blob([asBuffer(img)], { type: `image/${extention}` }))

          let imgid: string | null = null
          try {
            imgObj.src = imgURL
            imgid = await writeInlayImage(imgObj, { name: icon, ext: extention, id: icon })
          } finally {
            URL.revokeObjectURL(imgURL)
          }

          if (imgid) {
            return `{{inlayed::${imgid}}}`
          }

          console.warn('Failed to create character image inlay')
          return ''
        } catch (error) {
          console.error('Error in getCharacterImageMain:', error)
          return ''
        }
      })

      declareAPI('hash', async (id: string, value: string) => {
        return await hasher(new TextEncoder().encode(value))
      })

      const parseLuaOptions = (optionsStr?: string) => {
        if (!optionsStr) {
          return {}
        }

        try {
          const parsed = JSON.parse(optionsStr)
          return parsed && typeof parsed === 'object' ? parsed : {}
        } catch {
          return {}
        }
      }

      const collectLuaStreamText = async (stream: ReadableStream<StreamResponseChunk>) => {
        const reader = stream.getReader()
        let text = ''

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              break
            }
            if (value && typeof value['0'] === 'string') {
              text = value['0']
            }
          }
        } finally {
          reader.releaseLock()
        }

        return text
      }

      declareAPI(
        'LLMMain',
        async (id: string, promptStr: string, useMultimodal: boolean = false, optionsStr: string = '') => {
          let prompt: {
            role: string
            content: string
          }[] = JSON.parse(promptStr)
          if (!ScriptingLowLevelIds.has(id)) {
            return
          }
          let promptbody: OpenAIChat[] = prompt.map((dict) => {
            let role: 'system' | 'user' | 'assistant' = 'assistant'
            switch (dict['role']) {
              case 'system':
              case 'sys':
                role = 'system'
                break
              case 'user':
                role = 'user'
                break
              case 'assistant':
              case 'bot':
              case 'char': {
                role = 'assistant'
                break
              }
            }

            return {
              content: dict['content'] ?? '',
              role: role,
            }
          })

          if (useMultimodal) {
            for (const msg of promptbody) {
              const inlays: string[] = []
              msg.content = msg.content.replace(
                /{{(inlay|inlayed|inlayeddata)::(.+?)}}/g,
                (match: string, p1: string, p2: string) => {
                  if (msg.role === 'assistant') {
                    if (p2 && p1 === 'inlayeddata') {
                      inlays.push(p2)
                    }
                  } else {
                    if (p2) {
                      inlays.push(p2)
                    }
                  }
                  return ''
                },
              )

              const multimodals: MultiModal[] = []
              for (const inlay of inlays) {
                const inlayData = await getInlayAsset(inlay)
                multimodals.push({
                  type: inlayData?.type,
                  base64: inlayData?.data,
                  width: inlayData?.width,
                  height: inlayData?.height,
                })
              }

              msg.multimodals = multimodals.length > 0 ? multimodals : undefined
            }
          }

          const options = parseLuaOptions(optionsStr) as { streaming?: boolean }
          const result = await requestChatData(
            {
              formated: promptbody,
              bias: {},
              useStreaming: options.streaming === true,
              forceStreaming: options.streaming === true,
              noMultiGen: true,
            },
            'scriptMain',
          )

          if (result.type === 'fail') {
            return JSON.stringify({
              success: false,
              result: 'Error: ' + result.result,
            })
          }

          if (result.type === 'streaming') {
            try {
              return JSON.stringify({
                success: true,
                result: await collectLuaStreamText(result.result),
              })
            } catch (error) {
              return JSON.stringify({
                success: false,
                result: 'Error: ' + error,
              })
            }
          }

          if (result.type === 'multiline') {
            return JSON.stringify({
              success: false,
              result: result.result,
            })
          }

          return JSON.stringify({
            success: true,
            result: result.result,
          })
        },
      )

      declareAPI('simpleLLM', async (id: string, prompt: string) => {
        if (!ScriptingLowLevelIds.has(id)) {
          return
        }
        const result = await requestChatData(
          {
            formated: [
              {
                role: 'user',
                content: prompt,
              },
            ],
            bias: {},
            useStreaming: false,
            noMultiGen: true,
          },
          'scriptMain',
        )

        if (result.type === 'fail') {
          return {
            success: false,
            result: 'Error: ' + result.result,
          }
        }

        if (result.type === 'streaming' || result.type === 'multiline') {
          return {
            success: false,
            result: result.result,
          }
        }

        return {
          success: true,
          result: result.result,
        }
      })

      declareAPI('getName', (id: string) => {
        const db = getDatabase()
        const selectedChar = get(selectedCharID)
        const char = db.characters[selectedChar]
        return char.name
      })

      declareAPI('setName', (id: string, name: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        const selectedChar = get(selectedCharID)
        if (typeof name !== 'string') {
          throw 'Invalid data type'
        }
        const char = getCharacterByIndex(selectedChar, { snapshot: true })
        char.name = name
        setCharacterByIndex(selectedChar, char)
      })

      declareAPI('getDescription', (id: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        const selectedChar = get(selectedCharID)
        const char = getDatabase().characters[selectedChar]
        return char.desc
      })

      declareAPI('setDescription', (id: string, desc: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        const selectedChar = get(selectedCharID)
        const char = getCharacterByIndex(selectedChar, { snapshot: true })
        if (typeof data !== 'string') {
          throw 'Invalid data type'
        }
        char.desc = desc
        setCharacterByIndex(selectedChar, char)
      })

      declareAPI('getCharacterFirstMessage', (id: string) => {
        const selectedChar = get(selectedCharID)
        const char = getDatabase().characters[selectedChar]
        return char.firstMessage
      })

      declareAPI('setCharacterFirstMessage', (id: string, data: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        const selectedChar = get(selectedCharID)
        const char = getCharacterByIndex(selectedChar, { snapshot: true })
        if (typeof data !== 'string') {
          return false
        }
        char.firstMessage = data
        setCharacterByIndex(selectedChar, char)
        return true
      })

      declareAPI('getPersonaName', (id: string) => {
        return getUserName()
      })

      declareAPI('getPersonaDescription', (id: string) => {
        const db = getDatabase()
        const selectedChar = get(selectedCharID)
        const char = db.characters[selectedChar]

        return risuChatParser(getPersonaPrompt(), { chara: char })
      })

      declareAPI('getAuthorsNote', (id: string) => {
        return ScriptingEngineState.chat?.note ?? ''
      })

      declareAPI('getBackgroundEmbedding', (id: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        const db = getDatabase()
        const selectedChar = get(selectedCharID)
        const char = db.characters[selectedChar]
        return char.backgroundHTML
      })

      declareAPI('setBackgroundEmbedding', (id: string, data: string) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }
        const selectedChar = get(selectedCharID)
        if (typeof data !== 'string') {
          return false
        }
        const char = getCharacterByIndex(selectedChar, { snapshot: true })
        char.backgroundHTML = data
        setCharacterByIndex(selectedChar, char)
        return true
      })

      // Lore books
      declareAPI('getLoreBooksMain', (id: string, search: string) => {
        const db = getDatabase()
        const selectedChar = db.characters[get(selectedCharID)]
        if (selectedChar.type !== 'character') {
          return
        }

        const loreSources = [
          selectedChar.chats[selectedChar.chatPage]?.localLore ?? [],
          selectedChar.globalLore,
          getModuleLorebooks(),
        ]

        const found = []
        for (const source of loreSources) {
          for (const b of source) {
            if (b.comment === search) {
              found.push({ ...b, content: risuChatParser(b.content, { chara: selectedChar }) })
            }
          }
        }

        return JSON.stringify(found)
      })

      type upsertLoreBookOptions = {
        alwaysActive?: boolean
        insertOrder?: number
        key?: string
        secondKey?: string
        regex?: boolean
      }

      declareAPI('upsertLocalLoreBook', (id: string, name: string, content: string, options: upsertLoreBookOptions) => {
        if (!ScriptingSafeIds.has(id)) {
          return
        }

        if (char.type !== 'character') {
          return
        }

        const { alwaysActive = false, insertOrder = 100, key = '', regex = false, secondKey = '' } = options

        const currentChat = char.chats[char.chatPage]

        const newLocalLoreBooks = currentChat.localLore.filter((book) => book.comment !== name)
        newLocalLoreBooks.push({
          alwaysActive,
          comment: name,
          content: content,
          insertorder: insertOrder,
          mode: 'normal',
          key,
          secondkey: secondKey,
          selective: !!secondKey,
          useRegex: regex,
        })
        currentChat.localLore = newLocalLoreBooks
      })

      declareAPI('loadLoreBooksMain', async (id: string, reserve: number) => {
        if (!ScriptingLowLevelIds.has(id)) {
          return
        }

        const db = getDatabase()

        const selectedChar = db.characters[get(selectedCharID)]

        if (selectedChar.type !== 'character') {
          return
        }

        const fullLoreBooks = (await loadLoreBookV3Prompt()).actives
        const maxContext = db.maxContext - reserve
        if (maxContext < 0) {
          return JSON.stringify([])
        }

        let totalTokens = 0
        const loreBooks = []

        for (const book of fullLoreBooks) {
          const parsed = risuChatParser(book.prompt, { chara: selectedChar }).trim()
          if (parsed.length === 0) {
            continue
          }

          const tokens = await tokenize(parsed)

          if (totalTokens + tokens > maxContext) {
            break
          }
          totalTokens += tokens
          loreBooks.push({
            data: parsed,
            role: book.role === 'assistant' ? 'char' : book.role,
          })
        }

        return JSON.stringify(loreBooks)
      })

      declareAPI(
        'axLLMMain',
        async (id: string, promptStr: string, useMultimodal: boolean = false, optionsStr: string = '') => {
          let prompt: {
            role: string
            content: string
          }[] = JSON.parse(promptStr)
          if (!ScriptingLowLevelIds.has(id)) {
            return
          }
          let promptbody: OpenAIChat[] = prompt.map((dict) => {
            let role: 'system' | 'user' | 'assistant' = 'assistant'
            switch (dict['role']) {
              case 'system':
              case 'sys':
                role = 'system'
                break
              case 'user':
                role = 'user'
                break
              case 'assistant':
              case 'bot':
              case 'char': {
                role = 'assistant'
                break
              }
            }

            return {
              content: dict['content'] ?? '',
              role: role,
            }
          })

          if (useMultimodal) {
            for (const msg of promptbody) {
              const inlays: string[] = []
              msg.content = msg.content.replace(
                /{{(inlay|inlayed|inlayeddata)::(.+?)}}/g,
                (match: string, p1: string, p2: string) => {
                  if (msg.role === 'assistant') {
                    if (p2 && p1 === 'inlayeddata') {
                      inlays.push(p2)
                    }
                  } else {
                    if (p2) {
                      inlays.push(p2)
                    }
                  }
                  return ''
                },
              )

              const multimodals: MultiModal[] = []
              for (const inlay of inlays) {
                const inlayData = await getInlayAsset(inlay)
                multimodals.push({
                  type: inlayData?.type,
                  base64: inlayData?.data,
                  width: inlayData?.width,
                  height: inlayData?.height,
                })
              }

              msg.multimodals = multimodals.length > 0 ? multimodals : undefined
            }
          }

          const options = parseLuaOptions(optionsStr) as { streaming?: boolean }
          const result = await requestChatData(
            {
              formated: promptbody,
              bias: {},
              useStreaming: options.streaming === true,
              forceStreaming: options.streaming === true,
              noMultiGen: true,
            },
            'scriptAux',
          )

          if (result.type === 'fail') {
            return JSON.stringify({
              success: false,
              result: 'Error: ' + result.result,
            })
          }

          if (result.type === 'streaming') {
            try {
              return JSON.stringify({
                success: true,
                result: await collectLuaStreamText(result.result),
              })
            } catch (error) {
              return JSON.stringify({
                success: false,
                result: 'Error: ' + error,
              })
            }
          }

          if (result.type === 'multiline') {
            return JSON.stringify({
              success: false,
              result: result.result,
            })
          }

          return JSON.stringify({
            success: true,
            result: result.result,
          })
        },
      )

      declareAPI('getCharacterLastMessage', (id: string) => {
        const chat = ScriptingEngineState.chat
        if (!chat) {
          return ''
        }

        const db = getDatabase()
        const selchar = db.characters[get(selectedCharID)]

        let pointer = chat.message.length - 1
        while (pointer >= 0) {
          if (chat.message[pointer].role === 'char') {
            const messageData = chat.message[pointer].data
            return messageData
          }
          pointer--
        }

        return selchar.firstMessage
      })

      declareAPI('getUserLastMessage', (id: string) => {
        const chat = ScriptingEngineState.chat
        if (!chat) {
          return ''
        }

        let pointer = chat.message.length - 1
        while (pointer >= 0) {
          if (chat.message[pointer].role === 'user') {
            const messageData = chat.message[pointer].data
            return messageData
          }
          pointer--
        }

        return ''
      })

      declareAPI('getCharacterLastMessage', (id: string) => {
        const chat = ScriptingEngineState.chat
        if (!chat) {
          return ''
        }

        const db = getDatabase()
        const selchar = db.characters[get(selectedCharID)]

        let pointer = chat.message.length - 1
        while (pointer >= 0) {
          if (chat.message[pointer].role === 'char') {
            const messageData = chat.message[pointer].data
            return messageData
          }
          pointer--
        }

        return selchar.firstMessage
      })

      declareAPI('getUserLastMessage', (id: string) => {
        const chat = ScriptingEngineState.chat
        if (!chat) {
          return ''
        }

        let pointer = chat.message.length - 1
        while (pointer >= 0) {
          if (chat.message[pointer].role === 'user') {
            const messageData = chat.message[pointer].data
            return messageData
          }
          pointer--
        }
        return ''
      })

      console.log('Running Lua code:', code)
      if (ScriptingEngineState.type === 'lua') {
        await runLuaStringWithTimeout(ScriptingEngineState.engine, luaCodeWrapper(code), luaExecTimeoutMs)
      }
      if (ScriptingEngineState.type === 'py') {
        await ScriptingEngineState.pyodide?.init(code)
      }
      ScriptingEngineState.code = code
    }
    let accessKey = v4()
    if (mode === 'editDisplay') {
      ScriptingEditDisplayIds.add(accessKey)
    } else {
      ScriptingSafeIds.add(accessKey)
      if (lowLevelAccess) {
        ScriptingLowLevelIds.add(accessKey)
      }
    }
    let res: any
    try {
      if (ScriptingEngineState.type === 'lua') {
        const luaEngine = ScriptingEngineState.engine
        try {
          switch (mode) {
            case 'input': {
              const func = luaEngine.global.get('onInput')
              if (func) {
                res = await func(accessKey)
              }
              break
            }
            case 'output': {
              const func = luaEngine.global.get('onOutput')
              if (func) {
                res = await func(accessKey)
              }
              break
            }
            case 'start': {
              const func = luaEngine.global.get('onStart')
              if (func) {
                res = await func(accessKey)
              }
              break
            }
            case 'onButtonClick': {
              const func = luaEngine.global.get('onButtonClick')
              if (func) {
                res = await func(accessKey, data)
              }
              break
            }
            case 'editRequest':
            case 'editDisplay':
            case 'editInput':
            case 'editOutput': {
              const func = luaEngine.global.get('callListenMain')
              if (func) {
                res = await func(mode, accessKey, JSON.stringify(data), JSON.stringify(meta))
                res = JSON.parse(res)
              }
              break
            }
            default: {
              const func = luaEngine.global.get(mode)
              if (func) {
                res = await func(accessKey)
              }
              break
            }
          }
          if (res === false) {
            stopSending = true
          }
        } catch (error) {
          console.error('Lua dispatch failed:', error)
          throw error
        }
      }
      if (ScriptingEngineState.type === 'py') {
        switch (mode) {
          case 'input': {
            res = await ScriptingEngineState.pyodide?.python(`onInput('${accessKey}')`)
            break
          }
          case 'output': {
            res = await ScriptingEngineState.pyodide?.python(`onOutput('${accessKey}')`)
            break
          }
          case 'start': {
            res = await ScriptingEngineState.pyodide?.python(`onStart('${accessKey}')`)
            break
          }
          case 'onButtonClick': {
            res = await ScriptingEngineState.pyodide?.python(`onButtonClick('${accessKey}', '${data as string}')`)
            break
          }
          case 'editRequest':
          case 'editDisplay':
          case 'editInput':
          case 'editOutput': {
            res = await ScriptingEngineState.pyodide?.python(
              `callListenMain('${mode}', '${accessKey}', '${JSON.stringify(data)}', '${JSON.stringify(meta)}')`,
            )
            res = JSON.parse(res)
            break
          }
          default: {
            res = await ScriptingEngineState.pyodide?.python(`${mode}('${accessKey}')`)
            break
          }
        }
      }
    } finally {
      ScriptingSafeIds.delete(accessKey)
      ScriptingLowLevelIds.delete(accessKey)
      ScriptingEditDisplayIds.delete(accessKey)
    }

    chat = ScriptingEngineState.chat

    return {
      stopSending,
      chat,
      res,
    }
  })
  return await runResult.finally(() => {
    ScriptingEngineState.activeRuns = Math.max(0, (ScriptingEngineState.activeRuns ?? 1) - 1)
    enforceScriptingEngineCacheLimit(ScriptingEngineState.cacheBucket)
  })
}

async function makeLuaFactory() {
  const _luaFactory = new LuaFactory()
  async function mountFile(name: string) {
    let code = ''
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch('/lua/' + name)
        if (res.status >= 200 && res.status < 300) {
          code = await res.text()
          break
        }
      } catch (error) {}
    }
    await _luaFactory.mountFile(name, code)
  }

  await mountFile('json.lua')
  luaFactory = _luaFactory
}

async function ensureLuaFactory() {
  if (luaFactory) return

  if (luaFactoryPromise) {
    try {
      await luaFactoryPromise
    } catch (error) {
      luaFactoryPromise = null
    }
    return
  }

  try {
    luaFactoryPromise = makeLuaFactory()
    await luaFactoryPromise
  } finally {
    luaFactoryPromise = null
  }
}

async function hashScriptingCode(code: string): Promise<string> {
  const cached = ScriptingCodeHashMemo.get(code)
  if (cached !== undefined) {
    ScriptingCodeHashMemo.delete(code)
    ScriptingCodeHashMemo.set(code, cached)
    return cached
  }

  let hash: string
  const data = new TextEncoder().encode(code)
  const digest = await globalThis.crypto?.subtle?.digest?.('SHA-256', data)
  if (digest) {
    hash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  } else {
    let fallbackHash = 2166136261
    for (let i = 0; i < code.length; i++) {
      fallbackHash ^= code.charCodeAt(i)
      fallbackHash = Math.imul(fallbackHash, 16777619)
    }
    hash = `fnv1a-${(fallbackHash >>> 0).toString(16)}-${code.length}`
  }

  ScriptingCodeHashMemo.set(code, hash)
  while (ScriptingCodeHashMemo.size > CLIENT_LUA_CODE_HASH_MEMO_LIMIT) {
    const oldest = ScriptingCodeHashMemo.keys().next().value
    if (oldest === undefined) break
    ScriptingCodeHashMemo.delete(oldest)
  }
  return hash
}

function getScriptingEngineBucket(mode: string, type: 'lua' | 'py'): string {
  return `${type}:${mode}`
}

function getScriptingEngineCacheKey(mode: string, type: 'lua' | 'py', codeHash?: string): string {
  const bucket = getScriptingEngineBucket(mode, type)
  return type === 'lua' ? `${bucket}:${codeHash ?? 'empty'}` : bucket
}

function touchScriptingEngineCacheKey(bucket: string, cacheKey: string): void {
  const current = ScriptingEngineLru.get(bucket) ?? []
  const next = current.filter((key) => key !== cacheKey)
  next.push(cacheKey)
  ScriptingEngineLru.set(bucket, next)
}

function closeScriptingEngineState(engineState: ScriptingEngineState): void {
  try {
    if (engineState.type === 'lua') {
      engineState.engine?.global.close()
    } else {
      engineState.pyodide?.close()
    }
  } catch (error) {
    console.warn('Failed to close scripting engine state', error)
  }
}

function deleteScriptingEngineCacheKey(cacheKey: string): void {
  const engineState = ScriptingEngines.get(cacheKey)
  if (engineState) {
    closeScriptingEngineState(engineState)
  }
  ScriptingEngines.delete(cacheKey)
  pendingEngineCreations.delete(cacheKey)
}

function enforceScriptingEngineCacheLimit(bucket?: string): void {
  if (!bucket) {
    return
  }
  const keys = ScriptingEngineLru.get(bucket)
  if (!keys) {
    return
  }
  let index = 0
  while (keys.length > CLIENT_LUA_ENGINE_CACHE_PER_MODE && index < keys.length) {
    const cacheKey = keys[index]
    const engineState = ScriptingEngines.get(cacheKey)
    if ((engineState?.activeRuns ?? 0) > 0) {
      index++
      continue
    }
    keys.splice(index, 1)
    deleteScriptingEngineCacheKey(cacheKey)
  }
  ScriptingEngineLru.set(
    bucket,
    keys.filter((key) => ScriptingEngines.has(key)),
  )
}

async function getOrCreateEngineState(
  mode: string,
  type: 'lua' | 'py',
  codeHash?: string,
): Promise<ScriptingEngineState> {
  const cacheKey = getScriptingEngineCacheKey(mode, type, codeHash)
  const cacheBucket = getScriptingEngineBucket(mode, type)
  let engineState = ScriptingEngines.get(cacheKey)
  if (engineState) {
    touchScriptingEngineCacheKey(cacheBucket, cacheKey)
    return engineState
  }

  let pendingCreation = pendingEngineCreations.get(cacheKey)
  if (pendingCreation) {
    return pendingCreation
  }

  const creationPromise = (() => {
    const engineState: ScriptingEngineState = {
      mutex: new Mutex(),
      type: type,
      cacheKey,
      cacheBucket,
    }
    ScriptingEngines.set(cacheKey, engineState)
    touchScriptingEngineCacheKey(cacheBucket, cacheKey)
    enforceScriptingEngineCacheLimit(cacheBucket)

    pendingEngineCreations.delete(cacheKey)

    return Promise.resolve(engineState)
  })()

  pendingEngineCreations.set(cacheKey, creationPromise)

  return creationPromise
}

async function runLuaStringWithTimeout(engine: LuaEngine | undefined, code: string, timeoutMs: number): Promise<void> {
  if (!engine) {
    return
  }
  const global = engine.global
  const thread = global.newThread()
  const threadIndex = global.getTop()
  try {
    thread.loadString(code)
    await thread.run(0, { timeout: timeoutMs })
  } finally {
    global.remove(threadIndex)
  }
}

export function resetScriptingEngineCacheForTests(): void {
  for (const engineState of ScriptingEngines.values()) {
    closeScriptingEngineState(engineState)
  }
  ScriptingEngines.clear()
  ScriptingEngineLru.clear()
  ScriptingCodeHashMemo.clear()
  pendingEngineCreations.clear()
  ScriptingSafeIds.clear()
  ScriptingEditDisplayIds.clear()
  ScriptingLowLevelIds.clear()
}

export function getScriptingEngineCacheSnapshotForTests(): {
  keys: string[]
  accessSetSizes: { safe: number; editDisplay: number; lowLevel: number }
} {
  return {
    keys: [...ScriptingEngines.keys()],
    accessSetSizes: {
      safe: ScriptingSafeIds.size,
      editDisplay: ScriptingEditDisplayIds.size,
      lowLevel: ScriptingLowLevelIds.size,
    },
  }
}

function luaCodeWrapper(code: string) {
  return `
json = require 'json'

function getChat(id, index)
    return json.decode(getChatMain(id, index))
end

function getFullChat(id)
    return json.decode(getFullChatMain(id))
end

function setFullChat(id, value)
    setFullChatMain(id, json.encode(value))
end

function log(value)
    logMain(json.encode(value))
end

function getLoreBooks(id, search)
    return json.decode(getLoreBooksMain(id, search))
end


function loadLoreBooks(id)
    return json.decode(loadLoreBooksMain(id):await())
end

function LLM(id, prompt, useMultimodal, options)
    useMultimodal = useMultimodal or false
    options = options or {}
    return json.decode(LLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await())
end

function axLLM(id, prompt, useMultimodal, options)
    useMultimodal = useMultimodal or false
    options = options or {}
    return json.decode(axLLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await())
end

function getCharacterImage(id)
    return getCharacterImageMain(id):await()
end

function getPersonaImage(id)
    return getPersonaImageMain(id):await()
end

local editRequestFuncs = {}
local editDisplayFuncs = {}
local editInputFuncs = {}
local editOutputFuncs = {}

function listenEdit(type, func)
    if type == 'editRequest' then
        editRequestFuncs[#editRequestFuncs + 1] = func
        return
    end

    if type == 'editDisplay' then
        editDisplayFuncs[#editDisplayFuncs + 1] = func
        return
    end

    if type == 'editInput' then
        editInputFuncs[#editInputFuncs + 1] = func
        return
    end

    if type == 'editOutput' then
        editOutputFuncs[#editOutputFuncs + 1] = func
        return
    end

    throw('Invalid type')
end

function getState(id, name)
    local escapedName = "__"..name
    return json.decode(getChatVar(id, escapedName))
end

function setState(id, name, value)
    local escapedName = "__"..name
    setChatVar(id, escapedName, json.encode(value))
end

function async(callback)
    return function(...)
        local co = coroutine.create(callback)
        local safe, result = coroutine.resume(co, ...)

        return Promise.create(function(resolve, reject)
            local checkresult
            local step = function()
                if coroutine.status(co) == "dead" then
                    local send = safe and resolve or reject
                    return send(result)
                end

                safe, result = coroutine.resume(co)
                checkresult()
            end

            checkresult = function()
                if safe and result == Promise.resolve(result) then
                    result:finally(step)
                else
                    step()
                end
            end

            checkresult()
        end)
    end
end

callListenMain = async(function(type, id, value, meta)
    local realValue = json.decode(value)
    local realMeta = json.decode(meta)

    if type == 'editRequest' then
        for _, func in ipairs(editRequestFuncs) do
            realValue = func(id, realValue, realMeta)
        end
    end

    if type == 'editDisplay' then
        for _, func in ipairs(editDisplayFuncs) do
            realValue = func(id, realValue, realMeta)
        end
    end

    if type == 'editInput' then
        for _, func in ipairs(editInputFuncs) do
            realValue = func(id, realValue, realMeta)
        end
    end

    if type == 'editOutput' then
        for _, func in ipairs(editOutputFuncs) do
            realValue = func(id, realValue, realMeta)
        end
    end

    return json.encode(realValue)
end)

${code}
`
}

export async function runLuaEditTrigger<T extends string | OpenAIChat[]>(
  char: character | simpleCharacterArgument,
  mode: string,
  content: T,
  meta?: object,
): Promise<T> {
  switch (mode) {
    case 'editinput':
      mode = 'editInput'
      break
    case 'editoutput':
      mode = 'editOutput'
      break
    case 'editdisplay':
      mode = 'editDisplay'
      break
    case 'editprocess':
      return content
  }

  try {
    let data = content

    const ownTriggers = ((char as { triggerscript?: triggerscript[] }).triggerscript ?? []).map(
      (v): triggerscript => ({
        ...v,
        lowLevelAccess: false,
      }),
    )
    const triggers: triggerscript[] = ownTriggers.concat(getModuleTriggers())

    for (let trigger of triggers) {
      if (trigger?.effect?.[0]?.type === 'triggerlua') {
        const runResult = await runScripted(trigger.effect[0].code, {
          char: char,
          lowLevelAccess: false,
          mode: mode,
          data,
          meta,
        })
        data = runResult.res ?? data
      }
    }

    return data
  } catch (error) {
    console.error(`Lua edit trigger failed in ${mode}:`, error)
    return content
  }
}

export async function runLuaButtonTrigger(
  char: character | simpleCharacterArgument,
  data: string,
  options?: {
    chat?: Chat
    isFresh?: () => boolean
    deferLiveChatSideEffects?: boolean
  },
): Promise<any> {
  let runResult
  const workingChat =
    options?.chat && options.deferLiveChatSideEffects ? safeStructuredClone(options.chat) : options?.chat
  const getWorkingVar =
    workingChat && options?.deferLiveChatSideEffects ? createLuaButtonWorkingGetVar(char, workingChat) : undefined
  const setWorkingVar =
    workingChat && options?.deferLiveChatSideEffects ? createLuaButtonWorkingSetVar(workingChat) : undefined
  const isFresh = (): boolean => options?.isFresh?.() !== false

  try {
    const ownTriggers = (
      (char as { triggerscript?: triggerscript[]; lowLevelAccess?: boolean }).triggerscript ?? []
    ).map(
      (v): triggerscript => ({
        ...v,
        lowLevelAccess: char.type === 'simple' ? false : (char.lowLevelAccess ?? false),
      }),
    )
    const triggers = ownTriggers.concat(getModuleTriggers())

    for (let trigger of triggers) {
      if (!isFresh()) {
        return null
      }
      if (trigger?.effect?.[0]?.type === 'triggerlua') {
        runResult = await runScripted(trigger.effect[0].code, {
          char: char,
          chat: workingChat,
          setVar: setWorkingVar,
          getVar: getWorkingVar,
          lowLevelAccess: trigger.lowLevelAccess,
          mode: 'onButtonClick',
          data: data,
        })
        if (!isFresh()) {
          return null
        }
      }
    }
  } catch (error) {
    throw error
  }
  return runResult
}

function createLuaButtonWorkingSetVar(chat: Chat): (key: string, value: string) => void {
  return (key: string, value: string) => {
    chat.scriptstate ??= {}
    chat.scriptstate['$' + key] = value
  }
}

function createLuaButtonWorkingGetVar(char: character | simpleCharacterArgument, chat: Chat): (key: string) => string {
  return (key: string) => {
    const state = chat.scriptstate?.['$' + key]
    if (state !== undefined && state !== null) {
      return state.toString()
    }

    const db = getDatabase()
    const defaultVariables =
      char.type === 'simple'
        ? parseKeyValue(db.templateDefaultVariables)
        : parseKeyValue(char.defaultVariables).concat(parseKeyValue(db.templateDefaultVariables))
    const defaultVariable = defaultVariables.find((entry) => entry[0] === key)
    return defaultVariable?.[1] ?? 'null'
  }
}

class PyodideContext {
  worker: Worker
  apis: Record<string, (...args: any[]) => any> = {}
  inited: boolean = false
  constructor() {
    this.worker = new Worker(new URL('./pyworker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'call') {
        const { function: func, args, callId } = event.data
        if (this.apis[func]) {
          this.apis[func](...args)
            .then((result) => {
              this.worker.postMessage({
                type: 'functionResult',
                callId: callId,
                result: result,
              })
            })
            .catch((error) => {
              this.worker.postMessage({
                type: 'error',
                error: error.message,
                id: callId,
              })
            })
        } else {
          this.worker.postMessage({
            type: 'error',
            error: `Function ${func} not found`,
            id: callId,
          })
        }
      }
    }
  }
  declareAPI(name: string, func: (...args: any[]) => any) {
    this.apis[name] = func
  }
  async init(code: string) {
    if (this.inited) {
      return
    }
    const id = crypto.randomUUID()
    return new Promise<void>((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent) => {
        if (event.data.id !== id) {
          return
        }

        if (event.data.type === 'init') {
          this.inited = true
          resolve()
        } else if (event.data.type === 'error') {
          reject(new Error(event.data.error))
        }
      }
      this.worker.postMessage({
        type: 'init',
        code: code,
        id: id,
        moduleFunctions: Object.keys(this.apis),
      })
    })
  }
  async python(call: string) {
    const id = crypto.randomUUID()
    return new Promise<any>((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent) => {
        if (event.data.id !== id) {
          return
        }

        if (event.data.type === 'python') {
          resolve(event.data.call)
        } else if (event.data.type === 'error') {
          reject(new Error(event.data.error))
        }
      }
      this.worker.postMessage({
        type: 'python',
        call: call,
        id: id,
      })
    })
  }
  close() {
    this.worker.terminate()
  }
}
