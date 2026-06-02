import { DBState } from '../stores.svelte'
import { compress as fflateCompress, decompress as fflateDecompress } from 'fflate'
import { alertClear, alertError, alertWait } from '../alert'
import { language } from 'src/lang'
import type { character } from '../storage/database.svelte'

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

export async function getColdStorageItem(key: string) {
  return null
}

export async function setColdStorageItem(key: string, value: any): Promise<boolean> {
  return false
}

export async function listColdStorageItems(): Promise<{ items: string[] }> {
  return {
    items: [],
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
  for (let i = 0; i < DBState.db.characters.length; i++) {
    if (DBState.db.characters[i].coldstorage) {
      keys.push(DBState.db.characters[i].coldstorage!)
      keys.push(...(DBState.db.characters[i].coldStoragedChats ?? []))
    }
    for (let j = 0; j < DBState.db.characters[i].chats.length; j++) {
      const chat = DBState.db.characters[i].chats[j]
      if (chat.message?.[0]?.data?.startsWith(coldStorageHeader)) {
        const coldDataKey = chat.message[0].data.slice(coldStorageHeader.length)
        keys.push(coldDataKey)
      }
    }
  }
  return keys
}

async function makeColdDataForCharacter(i: number, coldTime: number) {
  const lastInteraction = DBState.db.characters[i].lastInteraction ?? Date.now()
  if (lastInteraction < coldTime && !DBState.db.characters[i].coldstorage) {
    console.log(
      `Character ${DBState.db.characters[i].name ?? i} has not been interacted with since ${new Date(lastInteraction).toLocaleDateString()}, moving to cold storage`,
    )
    const id = crypto.randomUUID()
    const writeSuccess = await setColdStorageItem(id, {
      character: DBState.db.characters[i],
    })

    if (!writeSuccess) {
      console.error(`Cold storage write failed for character ${i}, keeping original data`)
      return
    }

    const verifyData = await getColdStorageItem(id)
    if (!verifyData || (!Array.isArray(verifyData) && !verifyData.character)) {
      console.error(
        `Cold storage verification failed for character ${DBState.db.characters[i].chaId ?? i}, keeping original data`,
        verifyData,
      )
      return
    }

    //get cold storaged chats in this character
    const coldStoragedChats: string[] = []
    for (let j = 0; j < DBState.db.characters[i].chats.length; j++) {
      const chat = DBState.db.characters[i].chats[j]
      if (chat.message?.[0]?.data?.startsWith(coldStorageHeader)) {
        const coldDataKey = chat.message[0].data.slice(coldStorageHeader.length)
        coldStoragedChats.push(coldDataKey)
      }
    }

    // Not a full character object,
    // just the data needed to show in the character list and load the chat when clicked. The rest will be loaded back when the character is opened.
    const coldCharacter: character = {
      type: 'character',
      image: DBState.db.characters[i].image,
      name: DBState.db.characters[i].name,
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
      chaId: DBState.db.characters[i].chaId,
      firstMsgIndex: 0,
      coldstorage: id,
      coldStoragedChats: coldStoragedChats,
    } as any

    DBState.db.characters[i] = coldCharacter
  }
}

async function makeColdDataForChat(i: number, j: number, coldTime: number) {
  const chat = DBState.db.characters[i].chats[j]
  let greatestTime = chat.lastDate ?? 0

  if (chat.message.length < 4) {
    //it is inefficient to store small data
    return
  }

  if (chat.message?.[0]?.data?.startsWith(coldStorageHeader)) {
    //already cold storage
    return
  }

  if (DBState.db.characters[i].coldstorage) {
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
    const id = crypto.randomUUID()
    const writeSuccess = await setColdStorageItem(id, {
      message: chat.message,
      hypaV3Data: chat.hypaV3Data,
      scriptstate: chat.scriptstate,
      localLore: chat.localLore,
    })

    if (!writeSuccess) {
      console.error(
        `Cold storage write failed for chat ${chat.id ?? j} in character ${i}, keeping original data`,
      )
      alertError(language.errors.coldStorageWriteFailed)
      return
    }

    // Verify the data can be read back before replacing
    const verifyData = await getColdStorageItem(id)
    if (!verifyData || (!Array.isArray(verifyData) && !verifyData.message)) {
      console.error(
        `Cold storage verification failed for chat ${chat.id ?? j}, keeping original data`,
      )
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

export async function preLoadChat(characterIndex: number, chatIndex: number) {
  const chat = DBState.db?.characters?.[characterIndex]?.chats?.[chatIndex]

  if (!chat) {
    return
  }

  if (chat.message?.[0]?.data?.startsWith(coldStorageHeader)) {
    alertError('Cold-storage chat hydration is not supported in server-backed web mode')
    return
  }
}
