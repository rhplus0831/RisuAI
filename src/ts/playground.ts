import { get } from 'svelte/store'
import { findCharacterIndexbyId } from './util'
import { characterFormatUpdate, createBlankChar } from './characters'
import { setCharacterByIndex, type character } from './storage/database.svelte'
import { DBState, PlaygroundStore, selectedCharID } from './stores.svelte'
import {
  currentCharacterSelectionSnapshot,
  dispatchSelectCharacter,
  toCharacterSnapshot,
} from './characterCommands'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import {
  canUseServerCommands,
  createAndSelectCharacterCommand,
  runServerCommand,
} from './server/commands'
import { fetchServerProjectionResource } from './server/projection'
import { mergeServerProjectionFields } from './storage/database.svelte'
import { resetChatHydration } from './server/chatMessageHydration.svelte'
import {
  recordHydratedCharacterLorebooks,
  resetLorebookHydration,
} from './server/lorebookBridge.svelte'

export const PLAYGROUND_CHARACTER_ID = '§playground'

export async function openPlaygroundChat(): Promise<void> {
  const charIndex = findCharacterIndexbyId(PLAYGROUND_CHARACTER_ID)
  PlaygroundStore.set(2)

  if (charIndex !== -1) {
    if (get(selectedCharID) === charIndex) {
      return
    }

    const previous = currentCharacterSelectionSnapshot(PLAYGROUND_CHARACTER_ID)
    const char = structuredClone(DBState.db.characters[charIndex]) as character
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
    }
    await refreshPlaygroundProjection()
    selectPlaygroundCharacter()
    return
  }

  withTrustedServerProjectionWrite(() => {
    DBState.db.characters.push(formattedChar)
    const index = DBState.db.characters.length - 1
    ;(DBState.db as unknown as { currentChar?: number }).currentChar = index
    selectedCharID.set(index)
  })
}

async function refreshPlaygroundProjection(): Promise<void> {
  const result = await fetchServerProjectionResource('character', {
    id: PLAYGROUND_CHARACTER_ID,
  })
  if (result.status !== 'ok' || result.mode !== 'fields') return
  mergeServerProjectionFields(result.fields)
  if (Object.prototype.hasOwnProperty.call(result.fields, 'characters')) {
    resetChatHydration()
    resetLorebookHydration()
    recordHydratedCharacterLorebooks(result.fields.characters)
  }
}

function selectPlaygroundCharacter(): void {
  const index = findCharacterIndexbyId(PLAYGROUND_CHARACTER_ID)
  if (index === -1) return
  selectedCharID.set(index)
}
