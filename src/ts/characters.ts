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
  isServerCharacterShell,
} from './storage/database.svelte'
import { alertAddCharacter, alertConfirm, alertError, alertNormal, alertSelect, alertStore, alertWait } from './alert'
import { language } from '../lang'
import { checkNullish, findCharacterbyId, getUserName, selectMultipleFile, selectSingleFile } from './util'
import { v4 as uuidv4, v4 } from 'uuid'
import { getImageType } from './media'
import { MobileGUIStack, OpenRealmStore, botMakerMode, selectedCharID } from './stores.svelte'
import { AppendableBuffer, downloadFile, getFileSrc, requiresFullEncoderReload } from './globalApi.svelte'
import { updateInlayScreen } from './process/inlayScreen'
import { parseMarkdownSafe } from './parser/parser.svelte'
import { translateHTML } from './translator/translator'
import { activeGenerationTarget, doingChat } from './process/index.svelte'
import { importCharacter } from './characterCards'
import { PngChunk } from './pngChunk'
import {
  CHAT_IMPORT_TOO_LARGE_ERROR,
  currentChatStateSnapshot,
  dispatchCreateChatForImport,
  dispatchCreateImportedChats,
} from './chatCommands'
import { CHAT_GENERATION_SETTINGS_FIELD, type ChatGenerationSettings } from './chatGenerationSettings'
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
  repairCharacterOrderOptimistically,
} from './characterCommands'
import { withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import { ensureAllChatsHydrated, hydrateChatMessages } from './server/chatMessageHydration.svelte'
import { hydrateCharacterShell, hydrateSelectedCharacterShell } from './server/characterShellHydration.svelte'
import { createLatestOperationGuard, type LatestOperationToken } from './server/staleStateGuards'
import {
  appendFreshCharacterEmotionImages,
  beginCharacterEmotionUpload,
  captureCharacterEmotionUploadTarget,
  clearCharacterEmotionUpload,
  isFreshCharacterEmotionUpload,
  type CharacterEmotionImageEntry,
  type CharacterEmotionUploadOperation,
} from './server/characterEmotionUpload'

type SelectedSingleFile = NonNullable<Awaited<ReturnType<typeof selectSingleFile>>>
type SelectedMultipleFile = NonNullable<Awaited<ReturnType<typeof selectMultipleFile>>>

interface CharacterAvatarSnapshot {
  image: string | undefined
  ccAssets: character['ccAssets'] | undefined
  pngExif: unknown
}

const characterAvatarUploadGuard = createLatestOperationGuard<string>()
const CHARACTER_IMPORT_NAVIGATION_TARGET = 'character-import-navigation' as const
const characterImportNavigationGuard = createLatestOperationGuard<typeof CHARACTER_IMPORT_NAVIGATION_TARGET>()
const chatImportGuard = createLatestOperationGuard<string>()
let changeCharSelectionAttemptId = 0

interface ChangeCharOptions {
  reseter?: () => any
  isFresh?: () => boolean
  allowDuringGeneration?: () => boolean
}

function characterSelectionMatchesActiveGeneration(index: number): boolean {
  const target = get(activeGenerationTarget)
  const character = getDatabase().characters?.[index]
  const chat = character?.chats?.[character.chatPage]
  if (!target || !character || !chat) return false

  if (target.characterId !== undefined || character.chaId !== undefined) {
    if (target.characterId !== character.chaId) return false
  } else if (target.selectedCharID !== index) {
    return false
  }

  if (target.chatId !== undefined || chat.id !== undefined) {
    return target.chatId === chat.id
  }
  return target.chatPage === character.chatPage
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function characterAvatarSnapshot(character: character | undefined): CharacterAvatarSnapshot {
  return {
    image: character?.image,
    ccAssets: cloneJsonValue(character?.ccAssets),
    pngExif: cloneJsonValue(character?.extentions?.pngExif),
  }
}

function characterAvatarSnapshotMatches(character: character | undefined, snapshot: CharacterAvatarSnapshot): boolean {
  return JSON.stringify(characterAvatarSnapshot(character)) === JSON.stringify(snapshot)
}

function isCurrentCharacterAvatarUpload(input: {
  token: LatestOperationToken<string>
  charIndex: number
  characterId: string
  avatarSnapshot: CharacterAvatarSnapshot
  editorScope: CharacterNavigationScope
}): boolean {
  const character = getDatabase().characters?.[input.charIndex]
  return (
    characterAvatarUploadGuard.isLatest(input.token) &&
    changeCharSelectionAttemptId === input.editorScope.selectionAttemptId &&
    characterNavigationScopeMatches(input.editorScope) &&
    character?.chaId === input.characterId &&
    characterAvatarSnapshotMatches(character, input.avatarSnapshot)
  )
}

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
  withTrustedResourceWrite(() => {
    getDatabase().characters.push(character)
    index = getDatabase().characters.length - 1
    if (select) {
      character.lastInteraction = lastInteraction
      ;(getDatabase() as unknown as { currentChar?: number }).currentChar = index
      selectedCharID.set(index)
    }
  })
  repairCharacterOrderOptimistically({ dispatchReorder: false })
  if (select) {
    dispatchCreateAndSelectCharacter(character, previous, lastInteraction)
  } else {
    dispatchCreateCharacter(character, previous)
  }
  return index
}

export async function getCharImage(loc: string, type: 'plain' | 'css' | 'contain' | 'lgcss') {
  const db = getDatabase()

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

export interface CharacterAvatarImageSelection {
  image: string
  pngExif: Record<string, string>
}

export async function selectCharacterAvatarImage(
  charIndex: number,
  onSelected: (selection: CharacterAvatarImageSelection) => void,
): Promise<void> {
  const previous = currentCharacterRowSnapshot(charIndex)
  const previousCharacter = previous.character
  const characterId = previousCharacter?.chaId
  if (!characterId) {
    return
  }
  const avatarSnapshot = characterAvatarSnapshot(previousCharacter)
  const editorScope = captureCharacterNavigationScope()
  const isFreshAvatarUpload = (token: LatestOperationToken<string>) =>
    isCurrentCharacterAvatarUpload({ token, charIndex, characterId, avatarSnapshot, editorScope })

  let token: LatestOperationToken<string> | null = null
  try {
    const selected = (await selectSingleFile(['png', 'webp', 'gif', 'jpg', 'jpeg'], {
      onFileSelected: () => {
        token = characterAvatarUploadGuard.issue(characterId)
      },
    })) as SelectedSingleFile | null
    if (!selected || !token) {
      return
    }

    if (!isFreshAvatarUpload(token)) {
      return
    }

    const img = selected.data

    const type = getImageType(img)
    const pngExif: Record<string, string> = {}

    try {
      if (type === 'PNG' && getDatabase().characters[charIndex].type === 'character') {
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
          if (!isFreshAvatarUpload(token)) {
            return
          }
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
            pngExif[chunk.key] = chunk.value
          }
        }
      }
    } catch (error) {
      console.error(error)
    }

    if (!isFreshAvatarUpload(token)) {
      return
    }

    const imgp = await saveImage(img)
    if (!isFreshAvatarUpload(token)) {
      return
    }

    onSelected({ image: imgp, pngExif })
  } finally {
    if (token) {
      characterAvatarUploadGuard.clear(token)
    }
  }
}

export async function selectCharImg(charIndex: number) {
  const previous = currentCharacterRowSnapshot(charIndex)
  const previousCharacter = previous.character

  await selectCharacterAvatarImage(charIndex, ({ image, pngExif }) => {
    let applied = false
    withTrustedResourceWrite(() => {
      dumpCharImage(charIndex, { dispatch: false })
      const character = getDatabase().characters[charIndex]
      const pngExifEntries = Object.entries(pngExif)
      if (pngExifEntries.length > 0) {
        character.extentions ??= {}
        character.extentions.pngExif ??= {}
        for (const [key, value] of pngExifEntries) {
          character.extentions.pngExif[key] = value
        }
      }
      character.image = image
      applied = true
    })

    if (applied) {
      dispatchCompatibleCharacterUpdateScoped(previousCharacter, getDatabase().characters[charIndex], previous)
    }
  })
}

export function dumpCharImage(charIndex: number, options: { dispatch?: boolean } = {}) {
  const dispatch = options.dispatch ?? true
  const previous = dispatch ? currentCharacterRowSnapshot(charIndex) : null
  const previousCharacter = previous?.character ?? null
  withTrustedResourceWrite(() => {
    const char = getDatabase().characters[charIndex] as character
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
    getDatabase().characters[charIndex] = char
  })
  if (previous && previousCharacter) {
    dispatchCompatibleCharacterUpdateScoped(previousCharacter, getDatabase().characters[charIndex], previous)
  }
}

export function changeCharImage(charIndex: number, changeIndex: number) {
  const previous = currentCharacterRowSnapshot(charIndex)
  const previousCharacter = previous.character
  withTrustedResourceWrite(() => {
    const char = getDatabase().characters[charIndex] as character
    const image = char.ccAssets[changeIndex].uri
    char.ccAssets.splice(changeIndex, 1)
    dumpCharImage(charIndex, { dispatch: false })
    char.image = image
    getDatabase().characters[charIndex] = char
  })
  dispatchCompatibleCharacterUpdateScoped(previousCharacter, getDatabase().characters[charIndex], previous)
}

export const addingEmotion = writable(false)

function currentCharacterEmotionUploadFreshness(charIndex: number) {
  const selectedCharacterId = getDatabase().characters?.[get(selectedCharID)]?.chaId
  const rowCharacter = getDatabase().characters?.[charIndex]
  return {
    currentCharacterId: selectedCharacterId,
    rowCharacterId: rowCharacter?.chaId,
    emotionImages: rowCharacter?.emotionImages,
  }
}

function isCurrentCharacterEmotionUpload(operation: CharacterEmotionUploadOperation, charIndex: number): boolean {
  return isFreshCharacterEmotionUpload(operation, currentCharacterEmotionUploadFreshness(charIndex))
}

export async function addCharEmotion(charId: number) {
  addingEmotion.set(true)
  const previous = currentCharacterRowSnapshot(charId)
  const previousCharacter = previous.character
  const target = captureCharacterEmotionUploadTarget({
    characterId: previous.characterId,
    characterIndex: charId,
    emotionImages: previousCharacter?.emotionImages,
  })
  if (!target) {
    addingEmotion.set(false)
    return
  }

  try {
    let operation: CharacterEmotionUploadOperation | null = null
    try {
      const selected = (await selectMultipleFile(['png', 'webp', 'gif'], {
        onFilesSelected: () => {
          operation = beginCharacterEmotionUpload(target)
        },
      })) as SelectedMultipleFile | null
      if (!selected || selected.length === 0 || !operation) {
        return
      }

      const activeOperation = operation
      const uploadedEntries: CharacterEmotionImageEntry[] = []

      for (const f of selected) {
        if (!isCurrentCharacterEmotionUpload(activeOperation, charId)) {
          return
        }

        const imgp = await saveImage(f.data)
        if (!isCurrentCharacterEmotionUpload(activeOperation, charId)) {
          return
        }

        const name = f.name.replace('.png', '').replace('.webp', '')
        uploadedEntries.push([name, imgp])
      }

      let applied = false
      withTrustedResourceWrite(() => {
        const dbChar = getDatabase().characters[charId]
        const emotionImages = appendFreshCharacterEmotionImages({
          operation: activeOperation,
          freshness: currentCharacterEmotionUploadFreshness(charId),
          entries: uploadedEntries,
        })
        if (!dbChar || !emotionImages) {
          return
        }

        dbChar.emotionImages = emotionImages
        getDatabase().characters[charId] = dbChar
        applied = true
      })

      if (applied) {
        dispatchCompatibleCharacterUpdateScoped(previousCharacter, getDatabase().characters[charId], previous)
      }
    } finally {
      if (operation) {
        clearCharacterEmotionUpload(operation)
      }
    }
  } finally {
    addingEmotion.set(false)
  }
}

export function rmCharEmotion(charId: number, emotionId: number) {
  const previous = currentCharacterRowSnapshot(charId)
  const previousCharacter = previous.character
  withTrustedResourceWrite(() => {
    let dbChar = getDatabase().characters[charId]
    dbChar.emotionImages.splice(emotionId, 1)
    getDatabase().characters[charId] = dbChar
  })
  dispatchCompatibleCharacterUpdateScoped(previousCharacter, getDatabase().characters[charId], previous)
}

export interface ChatExportTarget {
  characterId: string
  chatId: string
}

function resolveChatExportTarget({ characterId, chatId }: ChatExportTarget): {
  char: character
  chat: Chat
} | null {
  const char = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
  const chat = char?.chats?.find((candidate) => candidate.id === chatId)
  if (!char || !chat) return null
  return { char, chat }
}

function resolveCharacterExportTarget(characterId: string): character | null {
  return getDatabase().characters?.find((candidate) => candidate.chaId === characterId) ?? null
}

export async function exportChat(target: ChatExportTarget): Promise<void> {
  const stableTarget: ChatExportTarget = {
    characterId: target.characterId,
    chatId: target.chatId,
  }

  try {
    if (!resolveChatExportTarget(stableTarget)) return
    const mode = await alertSelect(['Export as JSON', 'Export as TXT', 'Export as HTML File', 'Export as HTML Embed'])
    const doTranslate =
      mode === '2' || mode === '3'
        ? (await alertSelect([language.translateContent, language.doNotTranslate])) === '0'
        : false
    const anonymous =
      mode === '2' || mode === '3'
        ? (await alertSelect([language.includePersonaName, language.hidePersonaName])) === '1'
        : false
    if (!resolveChatExportTarget(stableTarget)) return
    // The exported chat may not be the open (hydrated) one.
    await hydrateChatMessages(stableTarget.chatId)
    const resolvedTarget = resolveChatExportTarget(stableTarget)
    if (!resolvedTarget) return
    const { char, chat } = resolvedTarget
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
        folders = char.chatFolders?.filter((f) => f.id === chat.folderId)
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

      await downloadFile(`${char.name}_${date}_chat`.replace(/[<>:"/\\|?*\.\,]/g, '') + '.json', stringl)
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
                        <div class="idat">${JSON.stringify(chat).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
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

interface ChatImportTarget {
  selectedIndex: number
  characterId: string
}

interface CharacterNavigationScope {
  selectedCharID: number
  selectedCharacterId: string | undefined
  currentChar: number | undefined
  currentCharacterId: string | undefined
  selectionAttemptId: number
}

function captureCurrentChatImportTarget(): ChatImportTarget | null {
  const selectedIndex = get(selectedCharID)
  const characterId = getDatabase().characters?.[selectedIndex]?.chaId
  if (!characterId) return null
  return { selectedIndex, characterId }
}

function resolveChatImportTarget(target: ChatImportTarget): { selectedIndex: number; characterId: string } | null {
  const selectedCharacter = getDatabase().characters?.[target.selectedIndex]
  if (selectedCharacter?.chaId === target.characterId) {
    return target
  }

  const selectedIndex = getDatabase().characters?.findIndex((character) => character.chaId === target.characterId) ?? -1
  if (selectedIndex < 0) return null
  return { selectedIndex, characterId: target.characterId }
}

function resolveFreshChatImportTarget(
  target: ChatImportTarget,
  token: LatestOperationToken<string>,
): { selectedIndex: number; characterId: string } | null {
  if (!chatImportGuard.isLatest(token)) return null
  return resolveChatImportTarget(target)
}

function rekeyImportedChat(chat: Chat): void {
  chat.id = v4()
  const messageIdMap = new Map<string, string>()
  if (Array.isArray(chat.message)) {
    for (const message of chat.message) {
      if (!isRecord(message)) continue
      const previousId = typeof message.chatId === 'string' && message.chatId.trim() ? message.chatId : null
      const nextId = v4()
      message.chatId = nextId
      if (previousId && !messageIdMap.has(previousId)) {
        messageIdMap.set(previousId, nextId)
      }
    }

    for (const message of chat.message) {
      if (!isRecord(message) || !isRecord(message.generationInfo)) continue
      const generationId = message.generationInfo.generationId
      if (typeof generationId !== 'string') continue
      const nextGenerationId = messageIdMap.get(generationId)
      if (nextGenerationId) {
        message.generationInfo.generationId = nextGenerationId
      }
    }
  }

  if (Array.isArray(chat.bookmarks)) {
    chat.bookmarks = chat.bookmarks.map((messageId) => messageIdMap.get(messageId) ?? messageId)
  }
  if (isRecord(chat.bookmarkNames)) {
    const renamed: Record<string, string> = {}
    for (const [messageId, name] of Object.entries(chat.bookmarkNames)) {
      renamed[messageIdMap.get(messageId) ?? messageId] = name
    }
    chat.bookmarkNames = renamed
  }

  const memory = chat.hypaV3Data
  if (isRecord(memory) && Array.isArray(memory.summaries)) {
    for (const summary of memory.summaries) {
      if (!isRecord(summary) || !Array.isArray(summary.chatMemos)) continue
      summary.chatMemos = summary.chatMemos.map((messageId) =>
        typeof messageId === 'string' ? (messageIdMap.get(messageId) ?? messageId) : messageId,
      )
    }
  }
}

function rekeyImportedChatFolders(folders: unknown[]): Map<string, string> {
  const folderIdMap = new Map<string, string>()
  for (const folder of folders) {
    if (!isRecord(folder)) continue
    const previousId = typeof folder.id === 'string' && folder.id.trim() ? folder.id : null
    const nextId = v4()
    folder.id = nextId
    if (previousId && !folderIdMap.has(previousId)) {
      folderIdMap.set(previousId, nextId)
    }
  }
  return folderIdMap
}

function clearUnknownImportedFolder(chat: Chat, character: character): void {
  if (!chat.folderId) return
  if (!character.chatFolders?.some((folder) => folder.id === chat.folderId)) {
    chat.folderId = null
  }
}

function reportChatImportCommandResult(result: Awaited<ReturnType<typeof dispatchCreateChatForImport>>): boolean {
  if (result.status === 'ok') return true
  if (result.error === 'server_command_unavailable') {
    alertError(language.modelProfiles.commandUnavailable)
  } else if (result.error.startsWith('revision_conflict:')) {
    alertError(language.modelProfiles.commandConflict)
  } else if (result.error === CHAT_IMPORT_TOO_LARGE_ERROR) {
    alertError(language.errors.chatImportTooLarge)
  } else {
    alertError(result.error)
  }
  return false
}

export async function importChat() {
  const capturedTarget = captureCurrentChatImportTarget()
  if (!capturedTarget) {
    return
  }

  const importToken = chatImportGuard.issue(capturedTarget.characterId)
  try {
    const dat = await selectSingleFile(['json', 'jsonl', 'txt', 'html'])
    if (!dat) {
      return
    }
    const target = resolveFreshChatImportTarget(capturedTarget, importToken)
    if (!target) {
      return
    }
    const selectedID = target.selectedIndex
    const previous = currentChatStateSnapshot()
    const characterId = target.characterId

    if (dat.name.endsWith('jsonl')) {
      const lines = Buffer.from(dat.data)
        .toString('utf-8')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
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
              data: formatTavernChat(presedLine.mes, getDatabase().characters[selectedID].name),
            })
          }
        }

        isFirst = false
      }

      if (newChat.message.length === 0) {
        alertError(language.errors.noData)
        return
      }

      rekeyImportedChat(newChat)

      if (
        (getDatabase().characters[selectedID].chatFolders ?? []).filter((folder) => folder.id === newChat.folderId)
          .length === 0
      ) {
        newChat.folderId = null
      }

      withTrustedResourceWrite(() => {
        const character = getDatabase().characters[selectedID]
        character.chats.unshift(newChat)
        character.chatPage = 0
      })
      if (characterId) {
        const result = await dispatchCreateChatForImport(characterId, newChat, previous)
        if (!reportChatImportCommandResult(result)) return
      }
      alertNormal(language.successImport)
    } else if (dat.name.endsWith('json')) {
      const json = JSON.parse(Buffer.from(dat.data).toString('utf-8'))
      if ((json.type === 'risuAllChats' || json.type === 'risuChat') && json.ver === 2) {
        const folders = Array.isArray(json.folders) ? json.folders : []
        const chats = Array.isArray(json.data) ? json.data : [json.data]
        const folderIdMap = rekeyImportedChatFolders(folders)
        chats.forEach((chat) => {
          const importedFolderId = typeof chat.folderId === 'string' ? folderIdMap.get(chat.folderId) : undefined
          if (importedFolderId) {
            chat.folderId = importedFolderId
          } else {
            clearUnknownImportedFolder(chat, getDatabase().characters[selectedID])
          }
          rekeyImportedChat(chat)
          normalizeImportedChatGenerationSettings(chat)
        })
        withTrustedResourceWrite(() => {
          if (getDatabase().characters[selectedID].chatFolders === undefined) {
            getDatabase().characters[selectedID].chatFolders = []
          }
          getDatabase().characters[selectedID].chatFolders.push(...folders)
          getDatabase().characters[selectedID].chats.unshift(...chats)
        })
        const result = await dispatchCreateImportedChats(characterId, folders, chats, previous)
        if (!reportChatImportCommandResult(result)) return
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
            clearUnknownImportedFolder(v, getDatabase().characters[selectedID])
            rekeyImportedChat(v)
            normalizeImportedChatGenerationSettings(v)
            return v
          })
          withTrustedResourceWrite(() => {
            getDatabase().characters[selectedID].chats.unshift(...normalizedChats)
          })
          const result = await dispatchCreateImportedChats(characterId, [], normalizedChats, previous)
          if (!reportChatImportCommandResult(result)) return
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
          clearUnknownImportedFolder(das, getDatabase().characters[selectedID])
          rekeyImportedChat(das)
          normalizeImportedChatGenerationSettings(das)
          withTrustedResourceWrite(() => {
            getDatabase().characters[selectedID].chats.unshift(das)
          })
          if (characterId) {
            const result = await dispatchCreateChatForImport(characterId, das, previous, false)
            if (!reportChatImportCommandResult(result)) return
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
      const doc = new DOMParser().parseFromString(Buffer.from(dat.data).toString('utf-8'), 'text/html')
      const chat = doc.querySelector('.idat')?.textContent
      if (!chat) {
        alertError(language.errors.noData)
        return
      }
      const json = JSON.parse(chat)
      if (
        !(
          checkNullish(json.message) ||
          checkNullish(json.note) ||
          checkNullish(json.name) ||
          checkNullish(json.localLore)
        )
      ) {
        clearUnknownImportedFolder(json, getDatabase().characters[selectedID])
        rekeyImportedChat(json)
        normalizeImportedChatGenerationSettings(json)
        withTrustedResourceWrite(() => {
          getDatabase().characters[selectedID].chats.unshift(json)
        })
        if (characterId) {
          const result = await dispatchCreateChatForImport(characterId, json, previous, false)
          if (!reportChatImportCommandResult(result)) return
        }
        alertNormal(language.successImport)
      } else {
        alertError(language.errors.noData)
      }
    }
  } catch (error) {
    alertError(error)
  } finally {
    chatImportGuard.clear(importToken)
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

function normalizeImportedGenerationSettingsValue(value: unknown): ChatGenerationSettings | undefined {
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

  const modelPresetId = normalizeImportedModelPresetId(value.modelPresetId)
  if (modelPresetId) {
    normalized.modelPresetId = modelPresetId
    hasPrefill = true
  }

  const promptPresetId = normalizeImportedPromptPresetId(value.promptPresetId)
  if (promptPresetId) {
    normalized.promptPresetId = promptPresetId
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
  const personas = Array.isArray(getDatabase().personas) ? getDatabase().personas : []
  return personas.some((persona) => persona?.id === value) ? value : undefined
}

function normalizeImportedModelPresetId(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined
  const presets = Array.isArray(getDatabase().modelPresets) ? getDatabase().modelPresets : []
  return presets.some((preset) => preset?.id === value) ? value : undefined
}

function normalizeImportedPromptPresetId(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined
  const presets = Array.isArray(getDatabase().promptPresets) ? getDatabase().promptPresets : []
  return presets.some((preset) => preset?.id === value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export async function exportAllChats(characterId: string): Promise<void> {
  const stableCharacterId = characterId

  try {
    if (!resolveCharacterExportTarget(stableCharacterId)) return
    // This serializes every chat's history, so hydrate lazy chats first.
    await ensureAllChatsHydrated({ strict: true })
    const char = resolveCharacterExportTarget(stableCharacterId)
    if (!char) return
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
    await downloadFile(`${char.name}_all_chats_${date}`.replace(/[<>:"/\\|?*.,]/g, '') + '.json', stringl)
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
  let cha = typeof indexOrCharacter === 'number' ? getCharacterByIndex(indexOrCharacter) : indexOrCharacter
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
  cha.displayName ??= ''
  cha.notificationImage ??= ''
  if (checkNullish(cha.sdData)) {
    cha.sdData = defaultSdDataFunc()
  }
  if (checkNullish(cha.utilityBot)) {
    cha.utilityBot = false
  }
  cha.triggerscript = cha.triggerscript ?? []
  cha.alternateGreetings = cha.alternateGreetings ?? []
  cha.exampleMessage = cha.exampleMessage ?? ''
  cha.customNotificationMessage ??= ''
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
    displayName: '',
    notificationImage: '',
    firstMessage: '',
    customNotificationMessage: '',
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

const pendingCharacterRemovalIds = new Set<string>()

export async function removeChar(
  index: number,
  name: string,
  type: 'normal' | 'permanent' | 'permanentForce' = 'normal',
) {
  const characterId = getDatabase().characters?.[index]?.chaId
  if (!characterId || pendingCharacterRemovalIds.has(characterId)) return
  pendingCharacterRemovalIds.add(characterId)
  try {
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
    const liveIndex = findLiveCharacterIndex(characterId)
    if (liveIndex < 0) return
    if (type === 'normal') {
      const previous = currentCharacterTrashTimeSnapshot(liveIndex)
      const trashTime = Date.now()
      withTrustedResourceWrite(() => {
        getDatabase().characters[liveIndex].trashTime = trashTime
      })
      dispatchUpdateCharacterTrashTime(characterId, trashTime, previous)
    } else {
      const previous = currentCharacterStateSnapshot()
      withTrustedResourceWrite(() => {
        getDatabase().characters.splice(liveIndex, 1)
      })
      dispatchDeleteCharacter(characterId, previous)
    }
    repairCharacterOrderOptimistically({ dispatchReorder: false })
    requiresFullEncoderReload.state = true
    selectedCharID.set(-1)
  } finally {
    pendingCharacterRemovalIds.delete(characterId)
  }
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
      {
        const navigationScope = captureCharacterNavigationScope()
        const navigationToken = characterImportNavigationGuard.issue(CHARACTER_IMPORT_NAVIGATION_TARGET)
        try {
          const importedCharacterId = await importCharacter()
          if (importedCharacterId && isFreshCharacterImportNavigation(navigationToken, navigationScope)) {
            const index = findLiveCharacterIndex(importedCharacterId)
            if (index !== -1) {
              await changeChar(index, {
                isFresh: () =>
                  isFreshCharacterImportNavigation(navigationToken, navigationScope, {
                    checkSelectionAttempt: false,
                  }),
              })
            }
          }
        } finally {
          characterImportNavigationGuard.clear(navigationToken)
        }
      }
      break
    default:
      MobileGUIStack.set(1)
      return
  }
  MobileGUIStack.set(1)
}

function captureCharacterNavigationScope(): CharacterNavigationScope {
  const selectedIndex = get(selectedCharID)
  const currentChar = (getDatabase() as unknown as { currentChar?: number }).currentChar
  return {
    selectedCharID: selectedIndex,
    selectedCharacterId: characterIdAtIndex(selectedIndex),
    currentChar,
    currentCharacterId: characterIdAtIndex(currentChar),
    selectionAttemptId: changeCharSelectionAttemptId,
  }
}

function characterNavigationScopeMatches(scope: CharacterNavigationScope): boolean {
  const selectedIndex = get(selectedCharID)
  const currentChar = (getDatabase() as unknown as { currentChar?: number }).currentChar
  const selectedCharacterId = characterIdAtIndex(selectedIndex)
  const currentCharacterId = characterIdAtIndex(currentChar)

  return (
    selectedCharacterId === scope.selectedCharacterId &&
    currentCharacterId === scope.currentCharacterId &&
    (scope.selectedCharacterId !== undefined || selectedIndex === scope.selectedCharID) &&
    (scope.currentCharacterId !== undefined || currentChar === scope.currentChar)
  )
}

function isFreshCharacterImportNavigation(
  token: LatestOperationToken<typeof CHARACTER_IMPORT_NAVIGATION_TARGET>,
  scope: CharacterNavigationScope,
  options: { checkSelectionAttempt?: boolean } = {},
): boolean {
  const checkSelectionAttempt = options.checkSelectionAttempt ?? true
  return (
    characterImportNavigationGuard.isLatest(token) &&
    (!checkSelectionAttempt || changeCharSelectionAttemptId === scope.selectionAttemptId) &&
    characterNavigationScopeMatches(scope)
  )
}

export async function changeChar(index: number, arg: ChangeCharOptions = {}) {
  const reseter = arg.reseter ?? (() => {})
  if (get(doingChat) && !characterSelectionMatchesActiveGeneration(index) && !arg.allowDuringGeneration?.()) {
    return
  }
  const selectionAttemptId = ++changeCharSelectionAttemptId
  const isFreshSelectionAttempt = () => selectionAttemptId === changeCharSelectionAttemptId && (arg.isFresh?.() ?? true)
  reseter()
  botMakerMode.set(false)
  if (getDatabase().characters?.[index]?.coldstorage) {
    alertError('Cold-storage character hydration is not supported in server-backed web mode yet')
    return
  }
  const characterId = getDatabase().characters?.[index]?.chaId
  if (!characterId) return
  if (isServerCharacterShell(getDatabase().characters?.[index])) {
    const hydrated = await hydrateCharacterShell(characterId)
    if (!isFreshSelectionAttempt()) return
    const hydratedIndex = findLiveCharacterIndex(characterId)
    if (hydratedIndex < 0) return
    if (!hydrated && isServerCharacterShell(getDatabase().characters?.[hydratedIndex])) return
  }
  if (!isFreshSelectionAttempt()) return
  const liveIndex = findLiveCharacterIndex(characterId)
  if (liveIndex < 0 || isServerCharacterShell(getDatabase().characters?.[liveIndex])) return
  const previous = currentCharacterSelectionSnapshot(characterId)
  const lastInteraction = Date.now()
  withTrustedResourceWrite(() => {
    const character = getDatabase().characters?.[liveIndex]
    if (character) {
      character.lastInteraction = lastInteraction
    }
    ;(getDatabase() as unknown as { currentChar?: number }).currentChar = liveIndex
    selectedCharID.set(liveIndex)
  })
  dispatchSelectCharacter(characterId, previous, lastInteraction)
  await hydrateSelectedCharacterShell()
}

function findLiveCharacterIndex(characterId: string): number {
  return getDatabase().characters?.findIndex((character) => character?.chaId === characterId) ?? -1
}

function characterIdAtIndex(index: number | undefined): string | undefined {
  if (typeof index !== 'number' || index < 0) return undefined
  return getDatabase().characters?.[index]?.chaId
}
