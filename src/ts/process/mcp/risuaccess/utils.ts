import { get } from 'svelte/store'
import type { character } from 'src/ts/storage/database.svelte'
import { charactersResourceState, getCharacterResourceOwner } from 'src/ts/server/resourceState.svelte'
import { selectedCharID } from 'src/ts/stores.svelte'

export function getCharacter(id: string): character {
  if (id) {
    const stableIdOwner = getCharacterResourceOwner(id)
    if (stableIdOwner) return stableIdOwner
    return charactersResourceState.characters.find((character) => character.name === id) as character
  }

  const candidate = charactersResourceState.characters[get(selectedCharID)]
  return (candidate?.chaId ? getCharacterResourceOwner(candidate.chaId) : undefined) as character
}
