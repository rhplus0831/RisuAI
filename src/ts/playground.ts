import { get } from 'svelte/store'
import { findCharacterIndexbyId } from './util'
import { characterFormatUpdate, createBlankChar } from './characters'
import { getDatabase, setCharacterByIndex, type character } from './storage/database.svelte'
import { PlaygroundStore, selectedCharID } from './stores.svelte'
import { currentCharacterSelectionSnapshot, dispatchSelectCharacter, toCharacterSnapshot } from './characterCommands'
import { withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import { canUseServerCommands, createAndSelectCharacterCommand, runServerCommand } from './server/commands'

export const PLAYGROUND_CHARACTER_ID = '§playground'

export async function openPlaygroundChat(options: { isFresh?: () => boolean } = {}): Promise<void> {
  const isFresh = options.isFresh ?? (() => true)
  if (!isFresh()) return

  const charIndex = findCharacterIndexbyId(PLAYGROUND_CHARACTER_ID)
  PlaygroundStore.set(2)

  if (charIndex !== -1) {
    if (get(selectedCharID) === charIndex) {
      return
    }

    const previous = currentCharacterSelectionSnapshot(PLAYGROUND_CHARACTER_ID)
    const char = structuredClone(getDatabase().characters[charIndex]) as character
    char.utilityBot = true
    char.name = 'assistant'
    char.firstMessage = '{{none}}'
    const formattedChar = characterFormatUpdate(char)
    const lastInteraction = Date.now()
    formattedChar.lastInteraction = lastInteraction
    setCharacterByIndex(charIndex, formattedChar)

    selectedCharID.set(charIndex)
    dispatchSelectCharacter(formattedChar.chaId, previous, lastInteraction)
    return
  }

  const character = createBlankChar()
  character.chaId = PLAYGROUND_CHARACTER_ID
  character.utilityBot = true
  character.name = 'assistant'
  character.firstMessage = '{{none}}'
  const formattedChar = characterFormatUpdate(character)
  const lastInteraction = Date.now()
  formattedChar.lastInteraction = lastInteraction

  if (canUseServerCommands()) {
    const result = await runServerCommand({
      command: (baseRevision) =>
        createAndSelectCharacterCommand({
          baseRevision,
          character: toCharacterSnapshot(formattedChar),
          lastInteraction,
        }),
    })
    if (result.status !== 'ok') {
      console.warn('Unable to create playground character', result)
      return
    }
    if (!isFresh()) return
    selectPlaygroundCharacter()
    return
  }

  withTrustedResourceWrite(() => {
    const database = getDatabase()
    database.characters.push(formattedChar)
    const index = database.characters.length - 1
    ;(database as unknown as { currentChar?: number }).currentChar = index
    selectedCharID.set(index)
  })
}

function selectPlaygroundCharacter(): void {
  const index = findCharacterIndexbyId(PLAYGROUND_CHARACTER_ID)
  if (index === -1) return
  selectedCharID.set(index)
}
