import { createBlankChar } from './characterDefaults'
import { getCharImage } from './characterImage'
import type { character, Database } from './storage/database.svelte'
import { charactersResourceState } from './server/resourceState.svelte'
import { defaultEmotion } from './util'

export function selectCharacterOwner(characters: readonly character[], selectedIndex: number): character | undefined {
  const candidate = characters[selectedIndex]
  if (!candidate?.chaId) return undefined
  return characters.filter((character) => character?.chaId === candidate.chaId).length === 1 ? candidate : undefined
}

export function getSelectedCharacterOwner(): character | undefined {
  if (charactersResourceState.status !== 'ready') return undefined
  return selectCharacterOwner(charactersResourceState.characters, charactersResourceState.currentChar)
}

function characterOwnerRows(): readonly character[] {
  return charactersResourceState.status === 'ready' ? charactersResourceState.characters : []
}

export async function getCustomBackground(db: unknown) {
  if (typeof db !== 'string' || db.length < 2) {
    return ''
  }
  const filesrc = await getCharImage(db, 'plain')
  return `background: url("${filesrc}"); background-size: cover;`
}

export function findCharacterbyId(id: string) {
  const matches = characterOwnerRows().filter((char) => char.chaId === id)
  if (matches.length === 1) return matches[0]
  const unknown = createBlankChar()
  unknown.name = 'Unknown Character'
  return unknown
}

export function findCharacterIndexbyId(id: string) {
  const characters = characterOwnerRows()
  if (characters.filter((char) => char.chaId === id).length !== 1) return -1
  let i = 0
  for (const char of characters) {
    if (char.chaId === id) {
      return i
    }
    i += 1
  }
  return -1
}

export function getCharacterIndexObject() {
  const characters = characterOwnerRows()
  let i = 0
  const result: { [key: string]: number } = {}
  const counts = new Map<string, number>()
  for (const char of characters) counts.set(char.chaId, (counts.get(char.chaId) ?? 0) + 1)
  for (const char of characters) {
    if ((counts.get(char.chaId) ?? 0) === 1) result[char.chaId] = i
    i += 1
  }
  return result
}

export async function getEmotionForCharacter(
  currentChar: character | undefined,
  chaEmotion: { [key: string]: [string, string, number][] },
  type: 'contain' | 'plain' | 'css',
) {
  if (!currentChar) return []
  const datas: string[] = ['normal' as const]
  if (currentChar.viewScreen === 'emotion') {
    const currEmotion = chaEmotion[currentChar.chaId]
    const image = currEmotion?.length
      ? await getCharImage(currEmotion[currEmotion.length - 1][1], type)
      : await getCharImage(defaultEmotion(currentChar.emotionImages), type)
    if (image && image.length > 2) datas.push(image)
  } else if (currentChar.viewScreen === 'imggen') {
    const currEmotion = chaEmotion[currentChar.chaId]
    if (!currEmotion || currEmotion.length === 0) {
      datas.push(await getCharImage(currentChar.image ?? '', 'plain'))
    } else {
      datas.push(currEmotion[currEmotion.length - 1][1])
    }
  }
  return datas
}

/** @deprecated Use getEmotionForCharacter with an explicit owner row. */
export async function getEmotion(
  _db: Database,
  chaEmotion: { [key: string]: [string, string, number][] },
  type: 'contain' | 'plain' | 'css',
) {
  return getEmotionForCharacter(getSelectedCharacterOwner(), chaEmotion, type)
}
