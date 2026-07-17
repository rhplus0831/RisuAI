import { compress as fflateCompress, decompress as fflateDecompress } from 'fflate'
import { alertClear, alertError, alertWait } from '../alert'
import { language } from 'src/lang'
import { getDatabase, type character } from '../storage/database.svelte'
import { createNonSecurityUuid } from '../nonSecurityUuid'
import { forageStorage } from '../globalApi.svelte'
import {
  getServerCommandBaseRevision,
  recoverColdStorageCharacterCommand,
  recoverColdStorageChatCommand,
  type ServerCommandResult,
} from '../server/commands'
import { withTrustedResourceWrite } from '../server/resourceWriteGuard.svelte'

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
  const keys: string[] = []
  const characters = getDatabase().characters
  for (let i = 0; i < characters.length; i++) {
    if (characters[i].coldstorage) {
      keys.push(characters[i].coldstorage!)
      keys.push(...(characters[i].coldStoragedChats ?? []))
    }
    for (let j = 0; j < characters[i].chats.length; j++) {
      const chat = characters[i].chats[j]
      if (chat.message?.[0]?.data?.startsWith(coldStorageHeader)) {
        const coldDataKey = chat.message[0].data.slice(coldStorageHeader.length)
        keys.push(coldDataKey)
      }
    }
  }
  return keys
}

async function makeColdDataForCharacter(i: number, coldTime: number) {
  const lastInteraction = getDatabase().characters[i].lastInteraction ?? Date.now()
  if (lastInteraction < coldTime && !getDatabase().characters[i].coldstorage) {
    console.log(
      `Character ${getDatabase().characters[i].name ?? i} has not been interacted with since ${new Date(lastInteraction).toLocaleDateString()}, moving to cold storage`,
    )
    const id = createNonSecurityUuid()
    const writeSuccess = await setColdStorageItem(id, {
      character: getDatabase().characters[i],
    })

    if (!writeSuccess) {
      console.error(`Cold storage write failed for character ${i}, keeping original data`)
      return
    }

    const verifyData = await getColdStorageItem(id)
    if (!verifyData || (!Array.isArray(verifyData) && !verifyData.character)) {
      console.error(
        `Cold storage verification failed for character ${getDatabase().characters[i].chaId ?? i}, keeping original data`,
        verifyData,
      )
      return
    }

    //get cold storaged chats in this character
    const coldStoragedChats: string[] = []
    for (let j = 0; j < getDatabase().characters[i].chats.length; j++) {
      const chat = getDatabase().characters[i].chats[j]
      if (chat.message?.[0]?.data?.startsWith(coldStorageHeader)) {
        const coldDataKey = chat.message[0].data.slice(coldStorageHeader.length)
        coldStoragedChats.push(coldDataKey)
      }
    }

    // Not a full character object,
    // just the data needed to show in the character list and load the chat when clicked. The rest will be loaded back when the character is opened.
    const coldCharacter: character = {
      type: 'character',
      image: getDatabase().characters[i].image,
      name: getDatabase().characters[i].name,
      chats: [
        {
          message: [
            {
              time: Date.now(),
              data: '',
              role: 'char',
            },
          ],
          note: '',
          name: '',
          localLore: [],
        },
      ],
      chatPage: 0,
      chaId: getDatabase().characters[i].chaId,
      firstMsgIndex: 0,
      coldstorage: id,
      coldStoragedChats: coldStoragedChats,
    } as any

    getDatabase().characters[i] = coldCharacter
  }
}

async function makeColdDataForChat(i: number, j: number, coldTime: number) {
  const chat = getDatabase().characters[i].chats[j]
  let greatestTime = chat.lastDate ?? 0

  if (chat.message.length < 4) {
    //it is inefficient to store small data
    return
  }

  if (chat.message?.[0]?.data?.startsWith(coldStorageHeader)) {
    //already cold storage
    return
  }

  if (getDatabase().characters[i].coldstorage) {
    //character is in cold storage, no need to cold storage individual chats
    return
  }

  for (let k = 0; k < chat.message.length; k++) {
    const message = chat.message[k]
    const time = message.time
    if (!time) {
      continue
    }

    if (time > greatestTime) {
      greatestTime = time
    }
  }

  if (greatestTime < coldTime) {
    const id = createNonSecurityUuid()
    const writeSuccess = await setColdStorageItem(id, {
      message: chat.message,
      hypaV3Data: chat.hypaV3Data,
      scriptstate: chat.scriptstate,
      localLore: chat.localLore,
    })

    if (!writeSuccess) {
      console.error(`Cold storage write failed for chat ${chat.id ?? j} in character ${i}, keeping original data`)
      alertError(language.errors.coldStorageWriteFailed)
      return
    }

    // Verify the data can be read back before replacing
    const verifyData = await getColdStorageItem(id)
    if (!verifyData || (!Array.isArray(verifyData) && !verifyData.message)) {
      console.error(`Cold storage verification failed for chat ${chat.id ?? j}, keeping original data`)
      alertError(language.errors.coldStorageVerifyFailed)
      return
    }

    chat.message = [
      {
        time: Date.now(),
        data: coldStorageHeader + id,
        role: 'char',
      },
    ]
    chat.hypaV3Data = {
      summaries: [],
    }
    chat.scriptstate = {}
    chat.localLore = []
  }
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

    withTrustedResourceWrite(() => {
      const index = getDatabase().characters.findIndex((candidate) => candidate.chaId === characterId)
      const current = getDatabase().characters[index]
      if (index >= 0 && (!current.coldstorage || current.coldstorage === key)) {
        getDatabase().characters[index] = result.character as unknown as character
      }
    })
    alertClear()
    return true
  } catch (error) {
    return reportRecoveryFailure(key, error)
  }
}

export function recoverColdStorageCharacter(characterIndex: number): Promise<boolean> {
  const current = getDatabase().characters?.[characterIndex]
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

    withTrustedResourceWrite(() => {
      const character = getDatabase().characters.find((candidate) => candidate.chaId === characterId)
      const chatIndex = character?.chats.findIndex((candidate) => candidate.id === chatId) ?? -1
      const current = character?.chats[chatIndex]
      const pointer = current?.message?.[0]?.data
      if (
        character &&
        chatIndex >= 0 &&
        (!pointer?.startsWith(coldStorageHeader) || pointer === `${coldStorageHeader}${key}`)
      ) {
        character.chats[chatIndex] = result.chat as (typeof character.chats)[number]
      }
    })
    return true
  } catch (error) {
    return reportRecoveryFailure(key, error)
  }
}

export function preLoadChat(characterIndex: number, chatIndex: number): Promise<boolean> {
  const character = getDatabase().characters?.[characterIndex]
  const chat = character?.chats?.[chatIndex]

  if (!character || !chat) return Promise.resolve(false)

  const pointer = chat.message?.[0]?.data
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
