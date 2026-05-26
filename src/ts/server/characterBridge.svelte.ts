import { untrack } from 'svelte'
import { get } from 'svelte/store'
import {
  CHARACTER_PATCH_EXCLUDED_KEYS,
  cloneJsonValue,
  currentCharacterStateSnapshot,
  dispatchUpdateCharacter,
  restoreCharacterState,
  sanitizeCharacterPatch,
  type CharacterStateSnapshot,
} from '../characterCommands'
import { canUseServerCommands, type CharacterSnapshot } from './commands'
import { DBState, selectedCharID } from '../stores.svelte'
import { withTrustedServerProjectionWrite } from './projectionWriteGuard.svelte'

interface PendingCharacterPatch {
  characterId: string
  patch: CharacterSnapshot
  previous: CharacterStateSnapshot
  timer: ReturnType<typeof setTimeout> | null
}

let pendingPatch: PendingCharacterPatch | null = null
let suppressRollbackDispatch = false

export interface WatchServerBackedCharacterProfileOptions {
  delayMs?: number
}

export type CharacterDraftValue = Record<string, any> & CharacterSnapshot

export interface ServerBackedCharacterDraft {
  characterId: string | null
  value: CharacterDraftValue
}

export function createServerBackedCharacterDraft(
  keys: readonly string[],
): ServerBackedCharacterDraft {
  const draft = $state<ServerBackedCharacterDraft>({
    characterId: null,
    value: {},
  })
  let initialized = false
  let suppressDraftDispatch = false
  let previousServerSnapshot = ''

  $effect(() => {
    const character = DBState.db.characters?.[get(selectedCharID)]
    const characterId = character?.chaId ?? null
    const serverValue = character
      ? normalizeCharacterDraft(
          pickCharacterFields(character as unknown as CharacterSnapshot, keys),
        )
      : {}
    const serverSnapshot = snapshotJson({ characterId, value: serverValue })
    const draftSnapshot = snapshotJson({ characterId: draft.characterId, value: draft.value })

    if (
      !initialized ||
      characterId !== draft.characterId ||
      (serverSnapshot !== previousServerSnapshot && serverSnapshot !== draftSnapshot)
    ) {
      suppressDraftDispatch = true
      draft.characterId = characterId
      draft.value = cloneJsonValue(serverValue)
      queueMicrotask(() => {
        suppressDraftDispatch = false
      })
      initialized = true
    }

    previousServerSnapshot = serverSnapshot
  })

  let draftInitialized = false
  $effect(() => {
    const characterId = draft.characterId
    if (!draftInitialized) {
      draftInitialized = true
      return
    }
    if (suppressDraftDispatch || !characterId) return

    untrack(() => {
      const patch = sanitizeCharacterPatch(cloneJsonValue(draft.value))
      withTrustedServerProjectionWrite(() => {
        const character = DBState.db.characters?.find(
          (candidate) => candidate.chaId === characterId,
        )
        if (!character) return
        Object.assign(character, patch)
      })
      previousServerSnapshot = snapshotJson({ characterId, value: patch })
    })
  })

  return draft
}

export function watchServerBackedCharacterProfile(
  options: WatchServerBackedCharacterProfileOptions = {},
): () => void {
  if (!canUseServerCommands()) return () => {}

  const delayMs = options.delayMs ?? 300
  let initialized = false
  let previousSelected = -1
  let previousProfileSnapshot = ''
  let previousState = currentCharacterStateSnapshot()

  const stop = $effect.root(() => {
    $effect(() => {
      const index = get(selectedCharID)
      const character = DBState.db.characters?.[index]
      const currentState = currentCharacterStateSnapshot()
      const currentProfile = character
        ? scalarCharacterProfile(character as unknown as Record<string, unknown>)
        : {}
      const currentProfileSnapshot = snapshotJson(currentProfile)

      if (!initialized || index !== previousSelected || !character?.chaId) {
        initialized = true
        previousSelected = index
        previousProfileSnapshot = currentProfileSnapshot
        previousState = currentState
        return
      }

      if (
        suppressRollbackDispatch ||
        currentProfileSnapshot === previousProfileSnapshot ||
        !character.chaId
      ) {
        previousState = currentState
        return
      }

      const previousProfile = JSON.parse(previousProfileSnapshot) as CharacterSnapshot
      const patch = changedProfileFields(previousProfile, currentProfile)
      if (Object.keys(patch).length > 0) {
        untrack(() => queueCharacterPatch(character.chaId, patch, previousState, delayMs))
      }

      previousProfileSnapshot = currentProfileSnapshot
      previousState = currentState
    })
  })

  return stop
}

function queueCharacterPatch(
  characterId: string,
  patch: CharacterSnapshot,
  previous: CharacterStateSnapshot,
  delay: number,
): void {
  if (pendingPatch?.timer) clearTimeout(pendingPatch.timer)

  pendingPatch =
    pendingPatch && pendingPatch.characterId === characterId
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

  pendingPatch.timer = setTimeout(() => {
    const commandPatch = pendingPatch
    pendingPatch = null
    if (!commandPatch) return

    dispatchUpdateCharacter(
      commandPatch.characterId,
      commandPatch.patch,
      {
        ...commandPatch.previous,
        selectedCharID: get(selectedCharID),
      },
      rollbackServerBackedCharacterProfile,
    )
  }, delay)
}

function scalarCharacterProfile(character: Record<string, unknown>): CharacterSnapshot {
  return sanitizeCharacterPatch(cloneJsonValue(character) as CharacterSnapshot)
}

function changedProfileFields(
  previous: CharacterSnapshot,
  current: CharacterSnapshot,
): CharacterSnapshot {
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

function pickCharacterFields(
  character: CharacterSnapshot,
  keys: readonly string[],
): CharacterDraftValue {
  const picked: CharacterDraftValue = {}
  for (const key of keys) {
    picked[key] = cloneJsonValue(character[key])
  }
  return picked
}

function normalizeCharacterDraft(value: CharacterSnapshot): CharacterDraftValue {
  value.name ??= ''
  value.desc ??= ''
  value.firstMessage ??= ''
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
  suppressRollbackDispatch = true
  try {
    restoreCharacterState(snapshot)
  } finally {
    queueMicrotask(() => {
      suppressRollbackDispatch = false
    })
  }
}
