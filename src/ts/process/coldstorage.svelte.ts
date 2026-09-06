import { compress as fflateCompress, decompress as fflateDecompress } from 'fflate'
import { alertClear, alertError, alertWait } from '../alert'
import { language } from 'src/lang'
import type { Chat, character } from '../storage/database.svelte'
import { forageStorage } from '../globalApi.svelte'
import {
  getServerCommandBaseRevision,
  recoverColdStorageCharacterCommand,
  recoverColdStorageChatCommand,
  type ServerCommandResult,
} from '../server/commands'
import {
  applyCharacterResource,
  charactersResourceState,
  getCharacterResourceOwner,
  getChatMetadataOwnerState,
  markChatBodyResourceRevision,
} from '../server/resourceState.svelte'
import { applyServerChatMessagesResource, getChatMessageOwnerState } from '../server/chatMessageHydration.svelte'

export const coldStorageHeader = '\uEF01COLDSTORAGE\uEF01'

async function decompress(data: Uint8Array) {
  return new Promise<Uint8Array>((resolve, reject) => {
    fflateDecompress(data, (err, decompressed) => {
      if (err) {
        return reject(err)
      }
      resolve(decompressed)
    })
  })
}

export async function getColdStorageItem(key: string): Promise<any> {
  try {
    const stored = await forageStorage.getItem(`coldstorage/${key}`)
    if (!stored || stored.length === 0) return null
    const text = new TextDecoder().decode(await decompress(new Uint8Array(stored)))
    return JSON.parse(text) as unknown
  } catch (error) {
    console.error(`Cold storage read failed for key: ${key}`, error)
    return null
  }
}

export async function setColdStorageItem(key: string, value: any): Promise<boolean> {
  try {
    const encoded = new TextEncoder().encode(JSON.stringify(value))
    const compressed = await new Promise<Uint8Array>((resolve, reject) => {
      fflateCompress(encoded, (err, result) => {
        if (err) reject(err)
        else resolve(result)
      })
    })
    await forageStorage.setItem(`coldstorage/${key}`, compressed)
    return true
  } catch (error) {
    console.error(`Cold storage write failed for key: ${key}`, error)
    return false
  }
}

export async function listColdStorageItems(): Promise<{ items: string[] }> {
  try {
    const prefix = 'coldstorage/'
    return {
      items: (await forageStorage.keys())
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length)),
    }
  } catch (error) {
    console.error('Cold storage list failed', error)
    return { items: [] }
  }
}

export async function cleanColdStorage() {
  return
}

async function removeColdStorageItems(keys: string[]) {
  return
}

export async function listColdDataKeys(): Promise<string[]> {
  if (charactersResourceState.status !== 'ready') return []

  const keys: string[] = []
  for (const candidate of charactersResourceState.characters) {
    if (!candidate?.chaId) return []
    const character = getCharacterResourceOwner(candidate.chaId)
    if (character !== candidate) return []

    if (character.coldstorage) {
      keys.push(character.coldstorage)
      keys.push(...(character.coldStoragedChats ?? []))
    }

    for (const chat of character.chats ?? []) {
      if (!chat?.id) continue
      const transcript = getChatMessageOwnerState(chat.id)
      const pointer = transcript?.messages?.[0]?.data
      if (pointer?.startsWith(coldStorageHeader)) {
        const coldDataKey = pointer.slice(coldStorageHeader.length)
        keys.push(coldDataKey)
      }
    }
  }
  return keys
}

export async function makeColdData() {
  return
}

const characterRecoveryJobs = new Map<string, Promise<boolean>>()
const chatRecoveryJobs = new Map<string, Promise<boolean>>()

function recoveryFailureMessage(key: string): string {
  return `${language.errors.coldStorageRecoveryFailed} (${key})`
}

function reportRecoveryFailure(key: string, detail: unknown): false {
  console.error(`Cold storage recovery failed for key: ${key}`, detail)
  alertError(recoveryFailureMessage(key))
  return false
}

function commandFailureDetail(result: Exclude<ServerCommandResult, { status: 'ok' }>): string {
  if (result.status === 'error') return result.error
  if (result.status === 'conflict') return `revision conflict at ${result.currentRevision}`
  return 'server command unavailable'
}

async function runCharacterRecovery(characterId: string, key: string): Promise<boolean> {
  try {
    alertWait(language.loadingChatData)
    const baseRevision = await getServerCommandBaseRevision()
    if (baseRevision === null) return reportRecoveryFailure(key, 'server revision unavailable')

    const result = await recoverColdStorageCharacterCommand({ baseRevision, characterId, key })
    if (result.status !== 'ok') return reportRecoveryFailure(key, commandFailureDetail(result))
    if (result.character.chaId !== characterId || result.character.coldstorage !== undefined) {
      return reportRecoveryFailure(key, 'server returned an invalid recovered character')
    }

    const current = getCharacterResourceOwner(characterId)
    if (!current) return reportRecoveryFailure(key, 'character owner is unavailable')
    if (current.coldstorage && current.coldstorage !== key) {
      return reportRecoveryFailure(key, 'character archive pointer changed before recovery completed')
    }

    const applied = applyCharacterResource({
      revision: result.revision,
      character: result.character as unknown as character,
    })
    const resident = getCharacterResourceOwner(characterId)
    if (!applied && resident?.coldstorage) {
      return reportRecoveryFailure(key, 'recovered character was superseded by another owner revision')
    }
    if (applied) applyRecoveredCharacterTranscripts(result.character as unknown as character, result.revision)
    alertClear()
    return true
  } catch (error) {
    return reportRecoveryFailure(key, error)
  }
}

export function recoverColdStorageCharacter(characterIndex: number): Promise<boolean> {
  const current = characterOwnerAt(characterIndex)
  if (!current) return Promise.resolve(false)
  if (!current.coldstorage) return Promise.resolve(true)
  if (!current.chaId) return Promise.resolve(reportRecoveryFailure(current.coldstorage, 'character id is missing'))

  const key = current.coldstorage
  const jobKey = `${current.chaId}:${key}`
  const active = characterRecoveryJobs.get(jobKey)
  if (active) return active
  const job = runCharacterRecovery(current.chaId, key).finally(() => characterRecoveryJobs.delete(jobKey))
  characterRecoveryJobs.set(jobKey, job)
  return job
}

async function runChatRecovery(characterId: string, chatId: string, key: string): Promise<boolean> {
  try {
    const baseRevision = await getServerCommandBaseRevision()
    if (baseRevision === null) return reportRecoveryFailure(key, 'server revision unavailable')

    const result = await recoverColdStorageChatCommand({ baseRevision, chatId, key })
    if (result.status !== 'ok') return reportRecoveryFailure(key, commandFailureDetail(result))
    if (result.characterId !== characterId || result.chat.id !== chatId) {
      return reportRecoveryFailure(key, 'server returned an invalid recovered chat')
    }

    const character = getCharacterResourceOwner(characterId)
    const current = character ? uniqueCharacterChatOwner(character, chatId) : undefined
    const pointer = getChatMessageOwnerState(chatId)?.messages?.[0]?.data
    if (!character || !current) return reportRecoveryFailure(key, 'chat owner is unavailable')
    if (pointer?.startsWith(coldStorageHeader) && pointer !== `${coldStorageHeader}${key}`) {
      return reportRecoveryFailure(key, 'chat archive pointer changed before recovery completed')
    }
    if (!pointer?.startsWith(coldStorageHeader)) return true

    const chatIndex = character.chats.indexOf(current)
    const nextCharacter = structuredClone(character)
    nextCharacter.chats[chatIndex] = result.chat as unknown as Chat
    const rowApplied = applyCharacterResource({ revision: result.revision, character: nextCharacter })
    if (!rowApplied) {
      const residentPointer = getChatMessageOwnerState(chatId)?.messages?.[0]?.data
      if (!residentPointer?.startsWith(coldStorageHeader)) return true
      return reportRecoveryFailure(key, 'recovered chat metadata was superseded by another owner revision')
    }

    const recovered = result.chat as unknown as Chat
    const bodyApplied = applyServerChatMessagesResource(
      chatId,
      recovered.message ?? [],
      recovered.hypaV3Data,
      [],
      undefined,
      { hypaV3DataIncluded: Object.prototype.hasOwnProperty.call(recovered, 'hypaV3Data') },
    )
    if (!bodyApplied) return reportRecoveryFailure(key, 'recovered chat transcript could not be applied')
    markChatBodyResourceRevision(chatId, result.revision)
    return true
  } catch (error) {
    return reportRecoveryFailure(key, error)
  }
}

export function preLoadChat(characterIndex: number, chatIndex: number): Promise<boolean> {
  const character = characterOwnerAt(characterIndex)
  const chat = character?.chats?.[chatIndex]

  if (!character || !chat) return Promise.resolve(false)

  if (!chat?.id || getChatMetadataOwnerState(chat.id)?.chatId !== chat.id) return Promise.resolve(false)
  const pointer = getChatMessageOwnerState(chat.id)?.messages?.[0]?.data
  if (!pointer?.startsWith(coldStorageHeader)) return Promise.resolve(true)
  const key = pointer.slice(coldStorageHeader.length)
  if (!character.chaId || !chat.id || !key) {
    return Promise.resolve(reportRecoveryFailure(key || 'unknown', 'archive pointer is incomplete'))
  }

  const jobKey = `${character.chaId}:${chat.id}:${key}`
  const active = chatRecoveryJobs.get(jobKey)
  if (active) return active
  const job = runChatRecovery(character.chaId, chat.id, key).finally(() => chatRecoveryJobs.delete(jobKey))
  chatRecoveryJobs.set(jobKey, job)
  return job
}

function characterOwnerAt(index: number): character | undefined {
  if (charactersResourceState.status !== 'ready' || index < 0) return undefined
  const candidate = charactersResourceState.characters[index]
  return candidate?.chaId && getCharacterResourceOwner(candidate.chaId) === candidate ? candidate : undefined
}

function uniqueCharacterChatOwner(character: character, chatId: string): Chat | undefined {
  if (getChatMetadataOwnerState(chatId)?.chatId !== chatId) return undefined
  const matches = (character.chats ?? []).filter((candidate) => candidate?.id === chatId)
  return matches.length === 1 ? matches[0] : undefined
}

function applyRecoveredCharacterTranscripts(character: character, revision: number): void {
  for (const chat of character.chats ?? []) {
    if (!chat?.id || getChatMetadataOwnerState(chat.id)?.chatId !== chat.id) continue
    if (
      applyServerChatMessagesResource(chat.id, chat.message ?? [], chat.hypaV3Data, [], undefined, {
        hypaV3DataIncluded: Object.prototype.hasOwnProperty.call(chat, 'hypaV3Data'),
      })
    ) {
      markChatBodyResourceRevision(chat.id, revision)
    }
  }
}
