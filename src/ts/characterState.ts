import { get } from 'svelte/store'
import { createBlankChar } from './characterDefaults'
import { getCharImage } from './characterImage'
import { selectedCharID } from './stores/coreStores.svelte'
import { getDatabase, type Database } from './storage/database.svelte'
import { defaultEmotion } from './util'

export async function getCustomBackground(db: unknown) {
  if (typeof db !== 'string' || db.length < 2) {
    return ''
  }
  const filesrc = await getCharImage(db, 'plain')
  return `background: url("${filesrc}"); background-size: cover;`
}

export function findCharacterbyId(id: string) {
  const db = getDatabase()
  for (const char of db.characters) {
    if (char.chaId === id) {
      return char
    }
  }
  const unknown = createBlankChar()
  unknown.name = 'Unknown Character'
  return unknown
}

export function findCharacterIndexbyId(id: string) {
  const db = getDatabase()
  let i = 0
  for (const char of db.characters) {
    if (char.chaId === id) {
      return i
    }
    i += 1
  }
  return -1
}

export function getCharacterIndexObject() {
  const db = getDatabase()
  let i = 0
  const result: { [key: string]: number } = {}
  for (const char of db.characters) {
    result[char.chaId] = i
    i += 1
  }
  return result
}

export async function getEmotion(
  db: Database,
  chaEmotion: { [key: string]: [string, string, number][] },
  type: 'contain' | 'plain' | 'css',
) {
  const selectedChar = get(selectedCharID)
  const currentDat = db.characters[selectedChar]
  if (!currentDat) {
    return []
  }
  const charIdList: string[] = [currentDat.chaId]

  const datas: string[] = ['normal' as const]
  for (const chaid of charIdList) {
    const currentChar = findCharacterbyId(chaid)
    if (currentChar.viewScreen === 'emotion') {
      const currEmotion = chaEmotion[currentChar.chaId]
      let im = ''
      if (!currEmotion || currEmotion.length === 0) {
        im = await getCharImage(defaultEmotion(currentChar?.emotionImages), type)
      } else {
        im = await getCharImage(currEmotion[currEmotion.length - 1][1], type)
      }
      if (im && im.length > 2) {
        datas.push(im)
      }
    } else if (currentChar.viewScreen === 'imggen') {
      const currEmotion = chaEmotion[currentChar.chaId]
      if (!currEmotion || currEmotion.length === 0) {
        datas.push(await getCharImage(currentChar.image ?? '', 'plain'))
      } else {
        datas.push(currEmotion[currEmotion.length - 1][1])
      }
    }
  }
  return datas
}
