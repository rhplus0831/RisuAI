import { untrack } from 'svelte'
import { get } from 'svelte/store'
import {
  CHARACTER_PATCH_EXCLUDED_KEYS,
  cloneJsonValue,
  dispatchUpdateCharacter,
  restoreCharacterState,
  sanitizeCharacterPatch,
  type CharacterStateSnapshot,
} from '../characterCommands'
import { canUseServerCommands, type CharacterSnapshot, type ServerCommandTransportOptions } from './commands'
import { DBState, selectedCharID } from '../stores.svelte'
import { getServerProjectionApplyEpoch, withTrustedServerProjectionWrite } from './projectionWriteGuard.svelte'
import { isServerCharacterShell, SERVER_CHARACTER_SHELL_MARKER } from '../storage/database.svelte'
import { applyAttemptedFieldRollback, mergeProjectionIntoDirtyDraft } from './staleStateGuards'

interface PendingCharacterPatch {
  characterId: string
  patch: CharacterSnapshot
  previous: CharacterStateSnapshot
  timer: ReturnType<typeof setTimeout> | null
}

const pendingPatches = new Map<string, PendingCharacterPatch>()
let suppressRollbackDispatch = false

export interface WatchServerBackedCharacterProfileOptions {
  delayMs?: number
}

export type CharacterDraftValue = Record<string, any> & CharacterSnapshot

export interface ServerBackedCharacterDraft {
  characterId: string | null
  value: CharacterDraftValue
}

export function createServerBackedCharacterDraft(keys: readonly string[]): ServerBackedCharacterDraft {
  const draft = $state<ServerBackedCharacterDraft>({
    characterId: null,
    value: {},
  })
  let initialized = false
  let suppressDraftDispatch = false
  let previousServerSnapshot = ''
  let previousSeedSelected = Number.NaN
  let previousSeedCharacterId: string | null = null
  let previousSeedProjectionApplyEpoch = -1
  const dirtyFields = new Set<keyof CharacterDraftValue & string>()
  const selectedCharMirror = $state({ value: get(selectedCharID) })

  $effect(() => {
    const unsubscribe = selectedCharID.subscribe((value) => {
      selectedCharMirror.value = value
    })
    return unsubscribe
  })

  $effect(() => {
    const selected = selectedCharMirror.value
    const projectionApplyEpoch = getServerProjectionApplyEpoch()
    const selectedCharacter = DBState.db.characters?.[selected]
    const characterId =
      selectedCharacter && !isServerCharacterShell(selectedCharacter) ? (selectedCharacter.chaId ?? null) : null
    const identityChanged = !initialized || selected !== previousSeedSelected || characterId !== previousSeedCharacterId
    const projectionApplyChanged = projectionApplyEpoch !== previousSeedProjectionApplyEpoch

    if (!identityChanged && !projectionApplyChanged) return

    previousSeedSelected = selected
    previousSeedCharacterId = characterId
    previousSeedProjectionApplyEpoch = projectionApplyEpoch

    const { serverSnapshot, serverValue } = untrack(() => currentCharacterDraftSeed(selected, characterId, keys))

    if (identityChanged || !characterId) {
      dirtyFields.clear()
    } else if (projectionApplyChanged) {
      clearDirtyFieldsMatchingProjection(dirtyFields, draft.value, serverValue)
    }

    const shouldSeedDraft =
      identityChanged ||
      untrack(() => {
        const draftSnapshot = snapshotJson({
          characterId: draft.characterId,
          value: draft.value,
        })
        return serverSnapshot !== previousServerSnapshot && serverSnapshot !== draftSnapshot
      })

    if (shouldSeedDraft) {
      suppressDraftDispatch = true
      if (!identityChanged && projectionApplyChanged && dirtyFields.size > 0) {
        draft.characterId = characterId
        mergeProjectionIntoDirtyDraft({
          draft: draft.value,
          projection: serverValue,
          dirtyFields,
        })
        reassertDirtyDraftFields(selected, characterId, draft.value, dirtyFields)
      } else {
        dirtyFields.clear()
        draft.characterId = characterId
        draft.value = cloneJsonValue(serverValue)
      }
      queueMicrotask(() => {
        suppressDraftDispatch = false
      })
      initialized = true
    }

    previousServerSnapshot = dirtyFields.size > 0 ? snapshotJson({ characterId, value: draft.value }) : serverSnapshot
  })

  let draftInitialized = false
  let previousDraftDispatchSnapshot = ''
  $effect(() => {
    const characterId = draft.characterId
    const draftSnapshot = snapshotJson(draft.value)
    if (!draftInitialized) {
      draftInitialized = true
      previousDraftDispatchSnapshot = draftSnapshot
      return
    }
    if (suppressDraftDispatch || !characterId) {
      previousDraftDispatchSnapshot = draftSnapshot
      return
    }
    if (draftSnapshot === previousDraftDispatchSnapshot) return
    const previousDraftValue = parseDraftSnapshot(previousDraftDispatchSnapshot)
    for (const key of changedTopLevelDraftFields(previousDraftValue, draft.value)) {
      dirtyFields.add(key)
    }
    previousDraftDispatchSnapshot = draftSnapshot

    untrack(() => {
      const patch = sanitizeCharacterPatch(cloneJsonValue(draft.value))
      withTrustedServerProjectionWrite(() => {
        const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
        if (!character) return
        Object.assign(character, patch)
      })
      previousServerSnapshot = snapshotJson({ characterId, value: patch })
    })
  })

  return draft
}

function parseDraftSnapshot(snapshot: string): CharacterDraftValue {
  if (!snapshot || snapshot === '__undefined__') return {}
  return JSON.parse(snapshot) as CharacterDraftValue
}

function changedTopLevelDraftFields(
  previous: CharacterDraftValue,
  current: CharacterDraftValue,
): Array<keyof CharacterDraftValue & string> {
  const changed: Array<keyof CharacterDraftValue & string> = []
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)])
  for (const key of keys) {
    if (snapshotJson(previous[key]) !== snapshotJson(current[key])) {
      changed.push(key)
    }
  }
  return changed
}

function clearDirtyFieldsMatchingProjection(
  dirtyFields: Set<keyof CharacterDraftValue & string>,
  draft: CharacterDraftValue,
  projection: CharacterDraftValue,
): void {
  for (const key of Array.from(dirtyFields)) {
    if (snapshotJson(draft[key]) === snapshotJson(projection[key])) {
      dirtyFields.delete(key)
    }
  }
}

function reassertDirtyDraftFields(
  selected: number,
  characterId: string | null,
  draft: CharacterDraftValue,
  dirtyFields: ReadonlySet<keyof CharacterDraftValue & string>,
): void {
  if (!characterId || dirtyFields.size === 0) return

  const patch: CharacterSnapshot = {}
  for (const key of dirtyFields) {
    patch[key] = cloneJsonValue(draft[key])
  }
  const sanitized = sanitizeCharacterPatch(patch)
  if (Object.keys(sanitized).length === 0) return

  withTrustedServerProjectionWrite(() => {
    const character = DBState.db.characters?.[selected]
    if (!character || character.chaId !== characterId || isServerCharacterShell(character)) return
    Object.assign(character, sanitized)
  })
}

function currentCharacterDraftSeed(
  selected: number,
  characterId: string | null,
  keys: readonly string[],
): { serverSnapshot: string; serverValue: CharacterDraftValue } {
  const character = DBState.db.characters?.[selected]
  if (!character || isServerCharacterShell(character)) {
    const serverValue = normalizeCharacterDraft(pickCharacterFields({}, keys))
    return {
      serverSnapshot: snapshotJson({ characterId: null, value: serverValue }),
      serverValue,
    }
  }

  const serverValue = normalizeCharacterDraft(pickCharacterFields(character as unknown as CharacterSnapshot, keys))
  return {
    serverSnapshot: snapshotJson({ characterId, value: serverValue }),
    serverValue,
  }
}

export function watchServerBackedCharacterProfile(options: WatchServerBackedCharacterProfileOptions = {}): () => void {
  if (!canUseServerCommands()) return () => {}

  const delayMs = options.delayMs ?? 300
  let initialized = false
  let previousSelected = -1
  let previousProfileSnapshot = ''
  let previousProjectionApplyEpoch = getServerProjectionApplyEpoch()

  const stop = $effect.root(() => {
    $effect(() => {
      const projectionApplyEpoch = getServerProjectionApplyEpoch()
      const index = get(selectedCharID)
      const character = DBState.db.characters?.[index]
      const isShell = isServerCharacterShell(character)
      const currentProfile =
        character && !isShell ? scalarCharacterProfile(character as unknown as Record<string, unknown>) : {}
      const currentProfileSnapshot = snapshotJson(currentProfile)

      if (
        !initialized ||
        index !== previousSelected ||
        !character?.chaId ||
        isShell ||
        projectionApplyEpoch !== previousProjectionApplyEpoch
      ) {
        initialized = true
        previousSelected = index
        previousProjectionApplyEpoch = projectionApplyEpoch
        previousProfileSnapshot = currentProfileSnapshot
        return
      }

      if (suppressRollbackDispatch || currentProfileSnapshot === previousProfileSnapshot || !character.chaId) {
        if (suppressRollbackDispatch) {
          previousProfileSnapshot = currentProfileSnapshot
        }
        return
      }

      const previousProfile = JSON.parse(previousProfileSnapshot) as CharacterSnapshot
      const patch = changedProfileFields(previousProfile, currentProfile)
      if (Object.keys(patch).length > 0) {
        const previousState = selectedCharacterProfileSnapshot(character.chaId, previousProfile, get(selectedCharID))
        untrack(() => queueCharacterPatch(character.chaId, patch, previousState, delayMs))
      }

      previousProfileSnapshot = currentProfileSnapshot
    })
  })

  return () => {
    flushPendingServerBackedCharacterPatches()
    stop()
  }
}

function queueCharacterPatch(
  characterId: string,
  patch: CharacterSnapshot,
  previous: CharacterStateSnapshot,
  delay: number,
): void {
  const pendingPatch = pendingPatches.get(characterId)
  if (pendingPatch?.timer) clearTimeout(pendingPatch.timer)

  const nextPatch: PendingCharacterPatch = pendingPatch
    ? {
        ...pendingPatch,
        patch: { ...pendingPatch.patch, ...patch },
        timer: null,
      }
    : {
        characterId,
        patch,
        previous,
        timer: null,
      }

  nextPatch.timer = setTimeout(() => runPendingCharacterPatch(characterId), delay)
  pendingPatches.set(characterId, nextPatch)
}

export function flushPendingServerBackedCharacterPatches(options: ServerCommandTransportOptions = {}): void {
  for (const characterId of Array.from(pendingPatches.keys())) {
    runPendingCharacterPatch(characterId, options)
  }
}

function runPendingCharacterPatch(characterId: string, options: ServerCommandTransportOptions = {}): void {
  const commandPatch = pendingPatches.get(characterId)
  if (!commandPatch) return
  if (commandPatch.timer) clearTimeout(commandPatch.timer)
  pendingPatches.delete(characterId)

  const rollbackSnapshot = {
    ...commandPatch.previous,
    selectedCharID: get(selectedCharID),
    attemptedProfile: sanitizeCharacterPatch(commandPatch.patch),
  } as CharacterStateSnapshot

  dispatchUpdateCharacter(
    commandPatch.characterId,
    commandPatch.patch,
    rollbackSnapshot,
    rollbackServerBackedCharacterProfile,
    options,
  )
}

function scalarCharacterProfile(character: Record<string, unknown>): CharacterSnapshot {
  const profile: CharacterSnapshot = {}
  for (const [key, value] of Object.entries(character)) {
    if (key === SERVER_CHARACTER_SHELL_MARKER) continue
    if (CHARACTER_PATCH_EXCLUDED_KEYS.has(key) || value === undefined) continue
    profile[key] = cloneJsonValue(value)
  }
  return profile
}

function selectedCharacterProfileSnapshot(
  characterId: string,
  profile: CharacterSnapshot,
  selected: number,
): CharacterStateSnapshot {
  return {
    characters: [],
    characterOrder: [],
    currentChar: (DBState.db as unknown as { currentChar?: number }).currentChar,
    selectedCharID: selected,
    profileCharacterId: characterId,
    profile,
  } as CharacterStateSnapshot
}

function changedProfileFields(previous: CharacterSnapshot, current: CharacterSnapshot): CharacterSnapshot {
  const patch: CharacterSnapshot = {}
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)])
  for (const key of keys) {
    if (CHARACTER_PATCH_EXCLUDED_KEYS.has(key)) continue
    if (snapshotJson(previous[key]) !== snapshotJson(current[key])) {
      patch[key] = cloneJsonValue(current[key])
    }
  }
  return patch
}

function pickCharacterFields(character: CharacterSnapshot, keys: readonly string[]): CharacterDraftValue {
  const picked: CharacterDraftValue = {}
  for (const key of keys) {
    picked[key] = cloneJsonValue(character[key])
  }
  return picked
}

function normalizeCharacterDraft(value: CharacterSnapshot): CharacterDraftValue {
  value.name ??= ''
  if (Object.prototype.hasOwnProperty.call(value, 'displayName')) {
    value.displayName ??= ''
  }
  value.desc ??= ''
  value.firstMessage ??= ''
  value.customNotificationMessage ??= ''
  value.image ??= ''
  value.ccAssets ??= []
  value.largePortrait ??= false
  value.viewScreen ??= 'none'
  value.emotionImages ??= []
  value.inlayViewScreen ??= false
  value.newGenData ??= {
    prompt: '',
    negative: '',
    instructions: '',
    emotionInstructions: '',
  }
  value.additionalAssets ??= []
  value.prebuiltAssetCommand ??= false
  value.prebuiltAssetStyle ??= ''
  value.prebuiltAssetExclude ??= []
  value.lowLevelAccess ??= false
  value.hideChatIcon ??= false
  value.utilityBot ??= false
  value.escapeOutput ??= false
  value.backgroundHTML ??= ''
  value.virtualscript ??= ''
  value.ttsMode ??= ''
  value.ttsSpeech ??= ''
  value.voicevoxConfig ??= {
    speaker: '',
    SPEED_SCALE: 1,
    PITCH_SCALE: 0,
    VOLUME_SCALE: 1,
    INTONATION_SCALE: 1,
  }
  value.naittsConfig ??= {
    customvoice: false,
    voice: 'Aini',
    version: 'v2',
  }
  value.oaiVoice ??= ''
  value.oaiTTSConfig ??= {
    enabled: false,
    format: 'mp3',
  }
  value.hfTTS ??= {
    model: '',
    language: 'en',
  }
  value.gptSoVitsConfig ??= {
    url: '',
    use_auto_path: false,
    ref_audio_path: '',
    use_long_audio: false,
    ref_audio_data: {
      fileName: '',
      assetId: '',
    },
    volume: 1.0,
    text_lang: 'auto',
    text: 'en',
    use_prompt: false,
    prompt_lang: 'en',
    top_p: 1,
    temperature: 0.7,
    speed: 1,
    top_k: 5,
    text_split_method: 'cut0',
  }
  value.fishSpeechConfig ??= {
    model: {
      _id: '',
      title: '',
      description: '',
    },
    chunk_length: 200,
    normalize: false,
  }
  value.ttsReadOnlyQuoted ??= false
  value.bias ??= []
  value.exampleMessage ??= ''
  value.creatorNotes ??= ''
  value.systemPrompt ??= ''
  value.replaceGlobalNote ??= ''
  value.additionalText ??= ''
  value.personality ??= ''
  value.scenario ??= ''
  value.defaultVariables ??= ''
  value.translatorNote ??= ''
  const additionalData =
    value.additionalData && typeof value.additionalData === 'object'
      ? (value.additionalData as Record<string, unknown>)
      : {}
  additionalData.creator ??= ''
  additionalData.character_version ??= ''
  value.additionalData = additionalData
  value.nickname ??= ''
  value.depth_prompt ??= {
    depth: 4,
    prompt: '',
  }
  value.alternateGreetings ??= []
  value.removedQuotes ??= false
  value.lorePlus ??= false
  return value
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

export function rollbackServerBackedCharacterProfile(snapshot: CharacterStateSnapshot): void {
  const profileSnapshot = snapshot as CharacterStateSnapshot & {
    profileCharacterId?: string
    profile?: CharacterSnapshot
    attemptedProfile?: CharacterSnapshot
  }

  suppressRollbackDispatch = true
  try {
    if (profileSnapshot.profileCharacterId && profileSnapshot.profile) {
      withTrustedServerProjectionWrite(() => {
        const character = DBState.db.characters?.find(
          (candidate) => candidate.chaId === profileSnapshot.profileCharacterId,
        )
        if (!character) return
        if (profileSnapshot.attemptedProfile) {
          applyAttemptedFieldRollback({
            target: character as unknown as Record<string, unknown>,
            previous: profileSnapshot.profile,
            attempted: profileSnapshot.attemptedProfile,
            deleteMissingPrevious: true,
          })
          return
        }
        Object.assign(character, cloneJsonValue(profileSnapshot.profile))
      })
    } else {
      restoreCharacterState(snapshot)
    }
  } finally {
    queueMicrotask(() => {
      suppressRollbackDispatch = false
    })
  }
}
