import { get } from 'svelte/store'
import type { character } from 'src/ts/storage/database.svelte'
import { getResourceDatabase } from 'src/ts/server/resourceState.svelte'
import { selectedCharID } from 'src/ts/stores.svelte'

export function getCharacter(id: string): character {
  const database = getResourceDatabase()
  return id
    ? database.characters.find((character) => character.chaId === id || character.name === id)
    : database.characters[get(selectedCharID)]
}
