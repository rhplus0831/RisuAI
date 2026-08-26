import { untrack } from 'svelte'
import { get, writable } from 'svelte/store'
import { resolveActiveModuleStates } from '../moduleActivation'
import { getCurrentCharacter, getDatabase, type Chat, type character } from '../storage/database.svelte'

export const RegexDisplayReloadPointer = writable(0)

export interface RegexDisplayReloadScopeState {
  epoch: number
  ownerEpochs: Readonly<Record<string, number>>
}

export interface RegexDisplayReloadContext {
  characterId?: string | null
  chatId?: string | null
}

const ALL_REGEX_DISPLAY_OWNERS = '*'

export const RegexDisplayReloadScope = writable<RegexDisplayReloadScopeState>({
  epoch: 0,
  ownerEpochs: {},
})

export function normalizeRegexDisplayOwnerKey(ownerKey: string | null | undefined): string {
  return ownerKey?.trim() || ALL_REGEX_DISPLAY_OWNERS
}

export function reloadRegexDisplay(ownerKey?: string | null) {
  const normalizedOwnerKey = normalizeRegexDisplayOwnerKey(ownerKey)
  const nextPointer = get(RegexDisplayReloadPointer) + 1
  RegexDisplayReloadScope.update((state) => ({
    epoch: nextPointer,
    ownerEpochs: {
      ...state.ownerEpochs,
      [normalizedOwnerKey]: nextPointer,
    },
  }))
  RegexDisplayReloadPointer.set(nextPointer)
}

/**
 * Produce a stable token containing only reload owners that can affect the
 * requested character/chat. Unrelated owner activations leave the token equal,
 * so Svelte dependents do not re-run their parsers.
 */
export function regexDisplayReloadTokenForContext(
  pointer: number,
  scope: RegexDisplayReloadScopeState,
  context: RegexDisplayReloadContext = {},
): string {
  if (scope.epoch !== pointer) return `legacy:${pointer}`

  return untrack(() => {
    const database = getDatabase()
    const selectedCharacter = resolveContextCharacter(database.characters ?? [], context.characterId)
    const selectedChat = resolveContextChat(selectedCharacter, context.chatId)
    const ownerKeys = [ALL_REGEX_DISPLAY_OWNERS, 'global']

    const characterId = selectedCharacter?.chaId ?? context.characterId?.trim()
    if (characterId) {
      ownerKeys.push(characterId, `character:${characterId}`)
    }

    const promptPresetId = selectedChat?.generationSettings?.promptPresetId?.trim()
    ownerKeys.push(promptPresetId ? `preset:${promptPresetId}` : 'root')

    for (const state of resolveActiveModuleStates(database, selectedCharacter, selectedChat)) {
      ownerKeys.push(`module:${state.module.id}`)
    }

    return ownerKeys.map((key) => `${key}:${scope.ownerEpochs[key] ?? 0}`).join('|')
  })
}

export function currentRegexDisplayReloadToken(context: RegexDisplayReloadContext = {}): string {
  return regexDisplayReloadTokenForContext(get(RegexDisplayReloadPointer), get(RegexDisplayReloadScope), context)
}

export function resetRegexDisplayReloadForTests(): void {
  RegexDisplayReloadPointer.set(0)
  RegexDisplayReloadScope.set({ epoch: 0, ownerEpochs: {} })
}

function resolveContextCharacter(
  characters: character[],
  characterId: string | null | undefined,
): character | undefined {
  if (characterId) return characters.find((candidate) => candidate?.chaId === characterId)
  try {
    return getCurrentCharacter()
  } catch {
    return undefined
  }
}

function resolveContextChat(
  selectedCharacter: character | undefined,
  chatId: string | null | undefined,
): Chat | undefined {
  if (!selectedCharacter) return undefined
  if (chatId) return selectedCharacter.chats?.find((candidate) => candidate?.id === chatId)
  return selectedCharacter.chats?.[selectedCharacter.chatPage]
}
