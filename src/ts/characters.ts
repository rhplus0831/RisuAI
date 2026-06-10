import { get, writable } from 'svelte/store'
import {
  saveImage,
  type character,
  type Chat,
  defaultSdDataFunc,
  type loreBook,
  getDatabase,
  getCharacterByIndex,
  setCharacterByIndex,
} from './storage/database.svelte'
import {
  alertAddCharacter,
  alertConfirm,
  alertError,
  alertNormal,
  alertSelect,
  alertStore,
  alertWait,
} from './alert'
import { language } from '../lang'
import {
  checkNullish,
  findCharacterbyId,
  getUserName,
  selectMultipleFile,
  selectSingleFile,
} from './util'
import { v4 as uuidv4, v4 } from 'uuid'
import { getImageType } from './media'
import {
  DBState,
  MobileGUIStack,
  OpenRealmStore,
  botMakerMode,
  selectedCharID,
} from './stores.svelte'
import {
  AppendableBuffer,
  changeChatTo,
  checkCharOrder,
  downloadFile,
  getFileSrc,
  requiresFullEncoderReload,
} from './globalApi.svelte'
import { updateInlayScreen } from './process/inlayScreen'
import { parseMarkdownSafe } from './parser/parser.svelte'
import { translateHTML } from './translator/translator'
import { doingChat } from './process/index.svelte'
import { importCharacter } from './characterCards'
import { PngChunk } from './pngChunk'
import {
  currentChatStateSnapshot,
  dispatchCreateChat,
  dispatchCreateChatFolder,
} from './chatCommands'
import {
  CHAT_GENERATION_SETTINGS_FIELD,
  type ChatGenerationSettings,
} from './chatGenerationSettings'
import { getColdStorageItem } from './process/coldstorage.svelte'
import {
  currentCharacterRowSnapshot,
  currentCharacterSelectionSnapshot,
  currentCharacterStateSnapshot,
  currentCharacterTrashTimeSnapshot,
  dispatchCreateAndSelectCharacter,
  dispatchCompatibleCharacterUpdateScoped,
  dispatchCreateCharacter,
  dispatchDeleteCharacter,
  dispatchSelectCharacter,
  dispatchUpdateCharacterTrashTime,
} from './characterCommands'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import { ensureAllChatsHydrated, hydrateChatMessages } from './server/chatMessageHydration.svelte'

export function createNewCharacter(
  options: {
    select?: boolean
  } = {},
) {
  const previous = currentCharacterStateSnapshot()
  const character = characterFormatUpdate(createBlankChar())
  const select = options.select ?? false
  const lastInteraction = Date.now()
  let index = -1
  withTrustedServerProjectionWrite(() => {
    DBState.db.characters.push(character)
    checkCharOrder()
    index = DBState.db.characters.length - 1
    if (select) {
      character.lastInteraction = lastInteraction
      ;(DBState.db as unknown as { currentChar?: number }).currentChar = index
      selectedCharID.set(index)
    }
  })
  if (select) {
    dispatchCreateAndSelectCharacter(character, previous, lastInteraction)
  } else {
    dispatchCreateCharacter(character, previous)
  }
  return index
}

export async function getCharImage(loc: string, type: 'plain' | 'css' | 'contain' | 'lgcss') {
  const db = DBState.db

  // Return placeholder when hideAllImages is enabled
  if (db.hideAllImages) {
    if (type === 'plain') {
      return '/none.webp'
    }
    return '' // For CSS types, return empty to show default ? icon
  }

  if (!loc || loc === '') {
    if (type === 'css') {
      return ''
    }
    return null
  }
  const filesrc = await getFileSrc(loc)
  if (type === 'plain') {
    return filesrc
  } else if (type === 'css') {
    return `background: url("${filesrc}");background-size: cover;`
  } else if (type === 'lgcss') {
    return `background: url("${filesrc}");background-size: cover;height: 10.66rem;`
  } else {
    return `background: url("${filesrc}");background-size: contain;background-repeat: no-repeat;background-position: center;`
  }
}

export async function selectCharImg(charIndex: number) {
  const selected = await selectSingleFile(['png', 'webp', 'gif', 'jpg', 'jpeg'])
  if (!selected) {
    return
  }
  const previous = currentCharacterRowSnapshot(charIndex)
  const previousCharacter = previous.character
  const img = selected.data
  let db = DBState.db

  const type = getImageType(img)

  try {
    if (type === 'PNG' && db.characters[charIndex].type === 'character') {
      const gen = PngChunk.readGenerator(img)
      const allowedChunk = [
        'parameters',
        'Comment',
        'Title',
        'Description',
        'Author',
        'Software',
        'Source',
        'Disclaimer',
        'Warning',
        'Copyright',
      ]
      for await (const chunk of gen) {
        if (chunk instanceof AppendableBuffer) {
          continue
        }
        if (!chunk) {
          continue
        }
        if (chunk.value.length > 20_000) {
          continue
        }
        if (allowedChunk.includes(chunk.key)) {
          console.log(chunk.key, chunk.value)
          withTrustedServerProjectionWrite(() => {
            DBState.db.characters[charIndex].extentions ??= {}
            DBState.db.characters[charIndex].extentions.pngExif ??= {}
            DBState.db.characters[charIndex].extentions.pngExif[chunk.key] = chunk.value
          })
        }
      }
      console.log(db.characters[charIndex].extentions)
    }
  } catch (error) {
    console.error(error)
  }

  const imgp = await saveImage(img)
  withTrustedServerProjectionWrite(() => {
    dumpCharImage(charIndex, { dispatch: false })
    DBState.db.characters[charIndex].image = imgp
  })
  dispatchCompatibleCharacterUpdateScoped(
    previousCharacter,
    DBState.db.characters[charIndex],
    previous,
  )
}

export function dumpCharImage(charIndex: number, options: { dispatch?: boolean } = {}) {
  const dispatch = options.dispatch ?? true
  const previous = dispatch ? currentCharacterRowSnapshot(charIndex) : null
  const previousCharacter = previous?.character ?? null
  withTrustedServerProjectionWrite(() => {
    const char = DBState.db.characters[charIndex] as character
    if (!char.image || char.image === '') {
      return
    }
    char.ccAssets ??= []
    char.ccAssets.push({
      type: 'icon',
      name: 'iconx',
      uri: char.image,
      ext: 'png',
    })
    char.image = ''
    DBState.db.characters[charIndex] = char
  })
  if (previous && previousCharacter) {
    dispatchCompatibleCharacterUpdateScoped(
      previousCharacter,
      DBState.db.characters[charIndex],
      previous,
    )
  }
}

export function changeCharImage(charIndex: number, changeIndex: number) {
  const previous = currentCharacterRowSnapshot(charIndex)
  const previousCharacter = previous.character
  withTrustedServerProjectionWrite(() => {
    const char = DBState.db.characters[charIndex] as character
    const image = char.ccAssets[changeIndex].uri
    char.ccAssets.splice(changeIndex, 1)
    dumpCharImage(charIndex, { dispatch: false })
    char.image = image
    DBState.db.characters[charIndex] = char
  })
  dispatchCompatibleCharacterUpdateScoped(
    previousCharacter,
    DBState.db.characters[charIndex],
    previous,
  )
}

export const addingEmotion = writable(false)

export async function addCharEmotion(charId: number) {
  addingEmotion.set(true)
  const selected = await selectMultipleFile(['png', 'webp', 'gif'])
  if (!selected) {
    addingEmotion.set(false)
    return
  }
  const previous = currentCharacterRowSnapshot(charId)
  const previousCharacter = previous.character
  for (const f of selected) {
    const img = f.data
    const imgp = await saveImage(img)
    const name = f.name.replace('.png', '').replace('.webp', '')
    withTrustedServerProjectionWrite(() => {
      let dbChar = DBState.db.characters[charId]
      dbChar.emotionImages.push([name, imgp])
      DBState.db.characters[charId] = dbChar
    })
  }
  addingEmotion.set(false)
  dispatchCompatibleCharacterUpdateScoped(
    previousCharacter,
    DBState.db.characters[charId],
    previous,
  )
}

export function rmCharEmotion(charId: number, emotionId: number) {
  const previous = currentCharacterRowSnapshot(charId)
  const previousCharacter = previous.character
  withTrustedServerProjectionWrite(() => {
    let dbChar = DBState.db.characters[charId]
    dbChar.emotionImages.splice(emotionId, 1)
    DBState.db.characters[charId] = dbChar
  })
  dispatchCompatibleCharacterUpdateScoped(
    previousCharacter,
    DBState.db.characters[charId],
    previous,
  )
}

export async function exportChat(page: number) {
  try {
    const mode = await alertSelect([
      'Export as JSON',
      'Export as TXT',
      'Export as HTML File',
      'Export as HTML Embed',
    ])
    const doTranslate =
      mode === '2' || mode === '3'
        ? (await alertSelect([language.translateContent, language.doNotTranslate])) === '0'
        : false
    const anonymous =
      mode === '2' || mode === '3'
        ? (await alertSelect([language.includePersonaName, language.hidePersonaName])) === '1'
        : false
    const selectedID = get(selectedCharID)
    const chatId = DBState.db.characters[selectedID]?.chats?.[page]?.id
    // The exported chat may not be the open (hydrated) one.
    if (chatId) await hydrateChatMessages(chatId)
    const db = DBState.db
    const char = db.characters[selectedID]
    const chat = char?.chats?.[page]
    if (!char || !chat) {
      throw new Error('Chat no longer exists')
    }
    const date = new Date().toJSON()
    const htmlChatParse = async (v: string) => {
      v = parseMarkdownSafe(v)

      if (doTranslate) {
        v = await translateHTML(v, false, '', -1)
      }

      if (anonymous) {
        //case insensitive match, replace all
        const excapedName = char.name.replace(/[-\/\\^$*+\?\.()|[\]{}]/g, '\\$&')

        v = v.replace(new RegExp(`${excapedName}`, 'gi'), '×××')
      }

      return v
    }

    if (mode === '0') {
      let folders = []
      if (chat.folderId) {
        folders = db.characters[selectedID].chatFolders?.filter((f) => f.id === chat.folderId)
      }
      const stringl = Buffer.from(
        JSON.stringify({
          type: 'risuChat',
          ver: 2,
          data: chat,
          folders: folders,
        }),
        'utf-8',
      )

      await downloadFile(
        `${char.name}_${date}_chat`.replace(/[<>:"/\\|?*\.\,]/g, '') + '.json',
        stringl,
      )
    } else if (mode === '2') {
      let chatContentHTML = ''

      let i = 0
      for (const v of chat.message) {
        alertWait(`Translating... ${i++}/${chat.message.length}`)
        const name = v.saying
          ? findCharacterbyId(v.saying).name
          : v.role === 'char'
            ? char.name
            : anonymous
              ? '×××'
              : getUserName()
        chatContentHTML += `<div class="chat">
                    <h2>${name}</h2>
                    <div>${await htmlChatParse(v.data)}</div>
                </div>`
      }

      const doc = `
                <!DOCTYPE html>
                <html>
                    <head>
                        <title>${char.name} Chat</title>
                        <style>
                            body{
                                font-family: Arial, sans-serif;
                                display: flex;
                                justify-content: center;
                            }
                            .container{
                                max-width: 800px;
                                padding: 1rem;
                                border-radius: 10px;
                                display: flex;
                                flex-direction: column;
                                gap: 1rem;
                            }
                            .chat{
                                background: #f0f0f0;
                                padding: 1rem;
                                border-radius: 10px;
                                display: flex;
                                flex-direction: column;
                            }
                            .idat{
                                display: none;
                            }
                            h2{
                                margin: 0;
                            }
                            .chat div{
                                margin-top: 0.5rem;
                                break-word: break-all;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="chat">
                                <h2>${char.name}</h2>
                                <div>${await htmlChatParse(
                                  chat.fmIndex === -1
                                    ? char.firstMessage
                                    : char.alternateGreetings?.[chat.fmIndex ?? 0],
                                )}</div>
                            </div>
                            ${chatContentHTML}
                        </div>
                        <div class="idat">${JSON.stringify(chat)
                          .replace(/</g, '&lt;')
                          .replace(/>/g, '&gt;')}</div>
                    </body>
            `

      await downloadFile(
        `${char.name}_${date}_chat`.replace(/[<>:"/\\|?*\.\,]/g, '') + '.html',
        Buffer.from(doc, 'utf-8'),
      )
    } else if (mode === '3') {
      //create a html table
      let chatContentHTML = ''

      let i = 0
      for (const v of chat.message) {
        alertWait(`Translating... ${i++}/${chat.message.length}`)
        const name = v.saying
          ? findCharacterbyId(v.saying).name
          : v.role === 'char'
            ? char.name
            : anonymous
              ? '×××'
              : getUserName()
        chatContentHTML += `<tr>
                    <td>${name}</td>
                    <td>${await htmlChatParse(v.data)}</td>
                </tr>`
      }

      const template = `
                <table>
                    <tr>
                        <th>Character</th>
                        <th>Message</th>
                    </tr>
                    <tr>
                        <td>${char.name}</td>
                        <td>${await htmlChatParse(char.firstMessage)}</td>
                    </tr>
                    ${chatContentHTML}
                </table>
                <p>Chat from Risuai</p>
            `

      //copy to clipboard

      const item = new ClipboardItem({
        'text/html': new Blob([template], { type: 'text/html' }),
        'text/plain': new Blob([template], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])

      alertNormal(language.clipboardSuccess)
      return
    } else {
      let stringl = chat.message
        .map((v) => {
          if (v.saying) {
            return `--${findCharacterbyId(v.saying).name}\n${v.data}`
          } else {
            return `--${v.role === 'char' ? char.name : getUserName()}\n${v.data}`
          }
        })
        .join('\n\n')

      stringl = `--${char.name}\n${char.firstMessage}\n\n` + stringl

      await downloadFile(
        `${char.name}_${date}_chat`.replace(/[<>:"/\\|?*\.\,]/g, '') + '.txt',
        Buffer.from(stringl, 'utf-8'),
      )
    }
    alertNormal(language.successExport)
  } catch (error) {
    alertError(error)
  }
}

export async function importChat() {
  const dat = await selectSingleFile(['json', 'jsonl', 'txt', 'html'])
  if (!dat) {
    return
  }
  try {
    const selectedID = get(selectedCharID)
    const previous = currentChatStateSnapshot()
    const characterId = DBState.db.characters[selectedID]?.chaId

    if (dat.name.endsWith('jsonl')) {
      const lines = Buffer.from(dat.data).toString('utf-8').split('\n')
      let newChat: Chat = {
        message: [],
        note: '',
        name: 'Imported Chat',
        localLore: [],
        fmIndex: -1,
        id: v4(),
      }

      let isFirst = true
      for (const line of lines) {
        const presedLine = JSON.parse(line)
        if ((presedLine.name && presedLine.is_user, presedLine.mes)) {
          if (!isFirst) {
            newChat.message.push({
              role: presedLine.is_user ? 'user' : 'char',
              data: formatTavernChat(presedLine.mes, DBState.db.characters[selectedID].name),
            })
          }
        }

        isFirst = false
      }

      if (newChat.message.length === 0) {
        alertError(language.errors.noData)
        return
      }

      if (
        DBState.db.characters[selectedID].chatFolders.filter(
          (folder) => folder.id === newChat.folderId,
        ).length === 0
      ) {
        newChat.folderId = null
      }

      withTrustedServerProjectionWrite(() => {
        DBState.db.characters[selectedID].chats.unshift(newChat)
      })
      changeChatTo(0)
      if (characterId) {
        dispatchCreateChat(characterId, newChat, previous)
      }
      alertNormal(language.successImport)
    } else if (dat.name.endsWith('json')) {
      const json = JSON.parse(Buffer.from(dat.data).toString('utf-8'))
      if ((json.type === 'risuAllChats' || json.type === 'risuChat') && json.ver === 2) {
        const folders = json.folders || []
        const chats = Array.isArray(json.data) ? json.data : [json.data]
        const selectedID = get(selectedCharID)
        let db = getDatabase()
        let folderIdMap = {}
        folders.forEach((folder) => {
          if (db.characters[selectedID].chatFolders?.some((f) => f.id === folder.id)) {
            const newId = uuidv4()
            folderIdMap[folder.id] = newId
            folder.id = newId
          } else {
            folderIdMap[folder.id] = folder.id
          }
        })
        withTrustedServerProjectionWrite(() => {
          if (DBState.db.characters[selectedID].chatFolders === undefined) {
            DBState.db.characters[selectedID].chatFolders = []
          }
          DBState.db.characters[selectedID].chatFolders.push(...folders)
        })
        if (characterId) {
          for (const folder of folders) {
            dispatchCreateChatFolder(characterId, folder, previous)
          }
        }
        chats.forEach((chat) => {
          if (chat.folderId && folderIdMap[chat.folderId]) {
            chat.folderId = folderIdMap[chat.folderId]
          }
          chat.id = v4()
          normalizeImportedChatGenerationSettings(chat)
        })
        withTrustedServerProjectionWrite(() => {
          DBState.db.characters[selectedID].chats.unshift(...chats)
        })
        if (characterId) {
          for (const chat of chats) {
            dispatchCreateChat(characterId, chat, previous, false)
          }
        }
        alertNormal(language.successImport)
        return
      }
      if (json.type === 'risuAllChats' && json.ver === 1) {
        const chats = json.data
        if (Array.isArray(chats) && chats.length > 0) {
          const normalizedChats = chats.map((v) => {
            if (!v.id) {
              v.id = uuidv4()
            }
            if (!v.localLore) {
              v.localLore = []
            }
            v.fmIndex ??= -1
            normalizeImportedChatGenerationSettings(v)
            return v
          })
          withTrustedServerProjectionWrite(() => {
            DBState.db.characters[selectedID].chats.unshift(...normalizedChats)
          })
          if (characterId) {
            for (const chat of normalizedChats) {
              dispatchCreateChat(characterId, chat, previous, false)
            }
          }
          alertNormal(language.successImport)
          return
        } else {
          alertError(language.errors.noData)
          return
        }
      }
      if (json.type === 'risuChat' && json.ver === 1) {
        const das: Chat = json.data
        if (
          !(
            checkNullish(das.message) ||
            checkNullish(das.note) ||
            checkNullish(das.name) ||
            checkNullish(das.localLore)
          )
        ) {
          das.fmIndex ??= -1
          das.id = v4()
          normalizeImportedChatGenerationSettings(das)
          withTrustedServerProjectionWrite(() => {
            DBState.db.characters[selectedID].chats.unshift(das)
          })
          if (characterId) {
            dispatchCreateChat(characterId, das, previous, false)
          }
          alertNormal(language.successImport)
          return
        } else {
          alertError(language.errors.noData)
          return
        }
      } else {
        alertError(language.errors.noData)
        return
      }
    } else if (dat.name.endsWith('html')) {
      const doc = new DOMParser().parseFromString(
        Buffer.from(dat.data).toString('utf-8'),
        'text/html',
      )
      const chat = doc.querySelector('.idat').textContent
      const json = JSON.parse(chat)
      if (json.message && json.note && json.name && json.localLore) {
        json.id = typeof json.id === 'string' && json.id ? json.id : v4()
        normalizeImportedChatGenerationSettings(json)
        withTrustedServerProjectionWrite(() => {
          DBState.db.characters[selectedID].chats.unshift(json)
        })
        if (characterId) {
          dispatchCreateChat(characterId, json, previous, false)
        }
        alertNormal(language.successImport)
      } else {
        alertError(language.errors.noData)
      }
    }
  } catch (error) {
    alertError(error)
  }
}

function normalizeImportedChatGenerationSettings(chat: unknown): void {
  if (!isRecord(chat)) return
  const normalized = normalizeImportedGenerationSettingsValue(chat[CHAT_GENERATION_SETTINGS_FIELD])
  if (normalized) {
    chat[CHAT_GENERATION_SETTINGS_FIELD] = normalized
  } else {
    delete chat[CHAT_GENERATION_SETTINGS_FIELD]
  }
}

function normalizeImportedGenerationSettingsValue(
  value: unknown,
): ChatGenerationSettings | undefined {
  if (!isRecord(value)) return undefined

  const normalized: ChatGenerationSettings = {
    configured: false,
  }
  let hasPrefill = false

  const personaId = normalizeImportedPersonaId(value.personaId)
  if (personaId) {
    normalized.personaId = personaId
    hasPrefill = true
  }

  const presetId = normalizeImportedPresetId(value.presetId)
  if (presetId) {
    normalized.presetId = presetId
    hasPrefill = true
  }

  if (typeof value.jailbreakToggle === 'boolean') {
    normalized.jailbreakToggle = value.jailbreakToggle
    hasPrefill = true
  }

  if (isRecord(value.sidebarToggles)) {
    const sidebarToggles: Record<string, string> = {}
    for (const [key, toggleValue] of Object.entries(value.sidebarToggles)) {
      if (key.trim() !== '' && typeof toggleValue === 'string') {
        sidebarToggles[key] = toggleValue
      }
    }
    if (Object.keys(sidebarToggles).length > 0 || hasPrefill) {
      normalized.sidebarToggles = sidebarToggles
    }
    if (Object.keys(sidebarToggles).length > 0) {
      hasPrefill = true
    }
  }

  if (!hasPrefill) return undefined

  // The server create-chat command validates any present generationSettings as
  // save-shaped data. Supply a local false value only to keep valid prefills
  // command-safe; configured:false still forces explicit user confirmation.
  normalized.jailbreakToggle ??= false

  return normalized
}

function normalizeImportedPersonaId(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined
  const personas = Array.isArray(DBState.db.personas) ? DBState.db.personas : []
  return personas.some((persona) => persona?.id === value) ? value : undefined
}

function normalizeImportedPresetId(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined
  const presets = Array.isArray(DBState.db.botPresets) ? DBState.db.botPresets : []
  return presets.some((preset) => preset?.id === value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export async function exportAllChats() {
  try {
    // This serializes every chat's history, so hydrate lazy chats first.
    await ensureAllChatsHydrated({ strict: true })
    const selectedID = get(selectedCharID)
    const db = getDatabase()
    const char = db.characters[selectedID]
    const date = new Date().toISOString().replace(/[:.]/g, '-')
    const allChats = char.chats
    const allFolders = char.chatFolders
    const stringl = Buffer.from(
      JSON.stringify({
        type: 'risuAllChats',
        ver: 2,
        data: allChats,
        folders: allFolders,
      }),
      'utf-8',
    )
    await downloadFile(
      `${char.name}_all_chats_${date}`.replace(/[<>:"/\\|?*.,]/g, '') + '.json',
      stringl,
    )
    alertNormal(language.successExport)
  } catch (error) {
    alertError(error)
  }
}

function formatTavernChat(chat: string, charName: string) {
  const db = getDatabase()
  return chat
    .replace(/<([Uu]ser)>|\{\{([Uu]ser)\}\}/g, getUserName())
    .replace(/((\{\{)|<)([Cc]har)(=.+)?((\}\})|>)/g, charName)
}

export function characterFormatUpdate(
  indexOrCharacter: number | character,
  arg: {
    updateInteraction?: boolean
  } = {},
) {
  let cha =
    typeof indexOrCharacter === 'number' ? getCharacterByIndex(indexOrCharacter) : indexOrCharacter
  if (cha.chats.length === 0) {
    cha.chats = [
      {
        message: [],
        note: '',
        name: 'Chat 1',
        localLore: [],
      },
    ]
  }
  if (!cha.chats[cha.chatPage]) {
    cha.chatPage = 0
  }
  if (!cha.chats[cha.chatPage].message) {
    cha.chats[cha.chatPage].message = []
  }
  if (!cha.type) {
    cha.type = 'character'
  }
  if (!cha.chaId) {
    cha.chaId = uuidv4()
  }
  if (checkNullish(cha.sdData)) {
    cha.sdData = defaultSdDataFunc()
  }
  if (checkNullish(cha.utilityBot)) {
    cha.utilityBot = false
  }
  cha.triggerscript = cha.triggerscript ?? []
  cha.alternateGreetings = cha.alternateGreetings ?? []
  cha.exampleMessage = cha.exampleMessage ?? ''
  cha.creatorNotes = cha.creatorNotes ?? ''
  cha.systemPrompt = cha.systemPrompt ?? ''
  cha.tags = cha.tags ?? []
  cha.creator = cha.creator ?? ''
  cha.characterVersion = cha.characterVersion ?? ''
  cha.personality = cha.personality ?? ''
  cha.scenario = cha.scenario ?? ''
  cha.firstMsgIndex = cha.firstMsgIndex ?? -1
  cha.additionalData = cha.additionalData ?? {
    tag: [],
    creator: '',
    character_version: '',
  }
  cha.voicevoxConfig = cha.voicevoxConfig ?? {
    SPEED_SCALE: 1,
    PITCH_SCALE: 0,
    INTONATION_SCALE: 1,
    VOLUME_SCALE: 1,
  }
  if (cha.postHistoryInstructions) {
    cha.chats[cha.chatPage].note += '\n' + cha.postHistoryInstructions
    cha.chats[cha.chatPage].note = cha.chats[cha.chatPage].note.trim()
    cha.postHistoryInstructions = null
  }
  cha.additionalText ??= ''
  cha.depth_prompt ??= {
    depth: 0,
    prompt: '',
  }
  cha.hfTTS ??= {
    model: '',
    language: 'en',
  }
  cha.backgroundHTML ??= ''
  cha.backgroundCSS ??= ''
  cha.creation_date ??= Date.now()
  cha.globalLore = updateLorebooks(cha.globalLore)
  if (!cha.newGenData) {
    cha = updateInlayScreen(cha)
  }
  // Migrate legacy 'none' value to '' for UI dropdown compatibility
  // Using '' because it's falsy, so `if (ttsMode)` correctly detects enabled TTS
  if (cha.ttsMode === 'none') {
    cha.ttsMode = ''
  }
  cha.ttsMode ??= ''
  if (checkNullish(cha.customscript)) {
    cha.customscript = []
  }
  cha.lastInteraction = Date.now()
  if (typeof indexOrCharacter === 'number') {
    setCharacterByIndex(indexOrCharacter, cha)
  }
  for (let i = 0; i < cha.chats.length; i++) {
    const chat = cha.chats[i]
    chat.fmIndex ??= cha.firstMsgIndex ?? -1
    if (!chat.id) {
      chat.id = uuidv4()
    }
    if (!chat.localLore) {
      chat.localLore = []
    }
  }
  return cha
}

export function updateLorebooks(book: loreBook[]) {
  return book.map((v) => {
    v.bookVersion ??= 1
    if (v.bookVersion >= 2) {
      return v
    }
    if (v.activationPercent) {
      const perc = v.activationPercent
      v.activationPercent = null

      v.content = `@@probability ${perc}\n${v.content}`
    }
    v.content = v.content
      .replace(/@@@?end/g, '@@depth 0')
      .replace(/\<(char|bot)\>/g, '{{char}}')
      .replace(/\<(user)\>/g, '{{user}}')
    v.bookVersion = 2
    return v
  })
}

export function createBlankChar(): character {
  return {
    name: '',
    firstMessage: '',
    desc: '',
    notes: '',
    chats: [
      {
        message: [],
        note: '',
        name: 'Chat 1',
        localLore: [],
      },
    ],
    chatFolders: [],
    chatPage: 0,
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: [],
    chaId: uuidv4(),
    type: 'character',
    sdData: defaultSdDataFunc(),
    utilityBot: false,
    customscript: [],
    exampleMessage: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    personality: '',
    scenario: '',
    firstMsgIndex: -1,
    replaceGlobalNote: '',
    triggerscript: [
      {
        comment: '',
        type: 'manual',
        conditions: [],
        effect: [
          {
            type: 'v2Header',
            code: '',
            indent: 0,
          },
        ],
      },
      {
        comment: 'New Event',
        type: 'manual',
        conditions: [],
        effect: [],
      },
    ],
    additionalText: '',
  }
}

export async function removeChar(
  index: number,
  name: string,
  type: 'normal' | 'permanent' | 'permanentForce' = 'normal',
) {
  const db = getDatabase()
  if (type !== 'permanentForce') {
    const conf = await alertConfirm(language.removeConfirm + name)
    if (!conf) {
      return
    }
    const conf2 = await alertConfirm(language.removeConfirm2 + name)
    if (!conf2) {
      return
    }
  }
  let chars = db.characters
  if (type === 'normal') {
    const previous = currentCharacterTrashTimeSnapshot(index)
    const characterId = previous.characterId
    const trashTime = Date.now()
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[index].trashTime = trashTime
      chars = DBState.db.characters
    })
    if (characterId) {
      dispatchUpdateCharacterTrashTime(characterId, trashTime, previous)
    }
  } else {
    const previous = currentCharacterStateSnapshot()
    const characterId = chars[index]?.chaId
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters.splice(index, 1)
      chars = DBState.db.characters
    })
    if (characterId) {
      dispatchDeleteCharacter(characterId, previous)
    }
  }
  checkCharOrder()
  requiresFullEncoderReload.state = true
  selectedCharID.set(-1)
}

export async function addCharacter(
  arg: {
    reseter?: () => any
  } = {},
) {
  MobileGUIStack.set(100)
  const reseter = arg.reseter ?? (() => {})
  const r = await alertAddCharacter()
  if (r === 'importFromRealm') {
    selectedCharID.set(-1)
    OpenRealmStore.set(true)
    MobileGUIStack.set(0)
    return
  }
  reseter()
  switch (r) {
    case 'createfromScratch':
      createNewCharacter({ select: true })
      break
    case 'importCharacter':
      await importCharacter()
      {
        let db = getDatabase()
        if (db.characters[db.characters.length - 1]) {
          changeChar(db.characters.length - 1)
        }
      }
      break
    default:
      MobileGUIStack.set(1)
      return
  }
  MobileGUIStack.set(1)
}

export async function changeChar(
  index: number,
  arg: {
    reseter?: () => any
  } = {},
) {
  const reseter = arg.reseter ?? (() => {})
  if (get(doingChat)) {
    return
  }
  reseter()
  botMakerMode.set(false)
  if (DBState.db.characters?.[index]?.coldstorage) {
    alertError('Cold-storage character hydration is not supported in server-backed web mode yet')
    return
  }
  const characterId = DBState.db.characters?.[index]?.chaId
  if (!characterId) return
  const previous = currentCharacterSelectionSnapshot(characterId)
  const lastInteraction = Date.now()
  withTrustedServerProjectionWrite(() => {
    const character = DBState.db.characters?.[index]
    if (character) {
      character.lastInteraction = lastInteraction
    }
    ;(DBState.db as unknown as { currentChar?: number }).currentChar = index
    selectedCharID.set(index)
  })
  dispatchSelectCharacter(characterId, previous, lastInteraction)
}
