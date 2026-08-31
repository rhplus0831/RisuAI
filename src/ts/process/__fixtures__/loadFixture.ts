import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LLMModel } from '../../model/types'
import { getResourceDatabase as getDatabase } from '../../server/resourceState.svelte'
import { selectedCharID } from '../../stores.svelte'
import { setDatabase, type Database, type character } from '../../storage/database.svelte'
import {
  resolveChatGenerationControlRequirements,
  type ChatGenerationModelPresetReference,
  type ChatGenerationModuleReference,
  type ChatGenerationPersonaReference,
  type ChatGenerationPromptPresetReference,
} from '../../chatGenerationSettings'

const HERE = dirname(fileURLToPath(import.meta.url))

const FIXTURE_PRESET_MIRROR_KEYS: Array<[string, string]> = [
  ['apiType', 'apiType'],
  ['openAIKey', 'openAIKey'],
  ['localNetworkMode', 'localNetworkMode'],
  ['localNetworkTimeoutSec', 'localNetworkTimeoutSec'],
  ['mainPrompt', 'mainPrompt'],
  ['jailbreak', 'jailbreak'],
  ['globalNote', 'globalNote'],
  ['temperature', 'temperature'],
  ['maxContext', 'maxContext'],
  ['maxResponse', 'maxResponse'],
  ['frequencyPenalty', 'frequencyPenalty'],
  ['PresensePenalty', 'PresensePenalty'],
  ['formatingOrder', 'formatingOrder'],
  ['aiModel', 'aiModel'],
  ['subModel', 'subModel'],
  ['modelRoles', 'modelRoles'],
  ['currentPluginProvider', 'currentPluginProvider'],
  ['textgenWebUIStreamURL', 'textgenWebUIStreamURL'],
  ['textgenWebUIBlockingURL', 'textgenWebUIBlockingURL'],
  ['forceReplaceUrl', 'forceReplaceUrl'],
  ['promptPreprocess', 'promptPreprocess'],
  ['bias', 'bias'],
  ['koboldURL', 'koboldURL'],
  ['proxyKey', 'proxyKey'],
  ['ooba', 'ooba'],
  ['ainconfig', 'ainconfig'],
  ['proxyRequestModel', 'proxyRequestModel'],
  ['openrouterRequestModel', 'openrouterRequestModel'],
  ['NAISettings', 'NAIsettings'],
  ['promptTemplate', 'promptTemplate'],
  ['NAIadventure', 'NAIadventure'],
  ['NAIappendName', 'NAIappendName'],
  ['localStopStrings', 'localStopStrings'],
  ['autoSuggestPrompt', 'autoSuggestPrompt'],
  ['customProxyRequestModel', 'customProxyRequestModel'],
  ['reverseProxyOobaArgs', 'reverseProxyOobaArgs'],
  ['top_p', 'top_p'],
  ['promptSettings', 'promptSettings'],
  ['repetition_penalty', 'repetition_penalty'],
  ['min_p', 'min_p'],
  ['top_a', 'top_a'],
  ['openrouterProvider', 'openrouterProvider'],
  ['useInstructPrompt', 'useInstructPrompt'],
  ['customPromptTemplateToggle', 'customPromptTemplateToggle'],
  ['templateDefaultVariables', 'templateDefaultVariables'],
  ['moduleIntergration', 'moduleIntergration'],
  ['top_k', 'top_k'],
  ['instructChatTemplate', 'instructChatTemplate'],
  ['JinjaTemplate', 'JinjaTemplate'],
  ['jsonSchemaEnabled', 'jsonSchemaEnabled'],
  ['jsonSchema', 'jsonSchema'],
  ['strictJsonSchema', 'strictJsonSchema'],
  ['extractJson', 'extractJson'],
  ['seperateParametersEnabled', 'seperateParametersEnabled'],
  ['seperateParameters', 'seperateParameters'],
  ['customAPIFormat', 'customAPIFormat'],
  ['systemContentReplacement', 'systemContentReplacement'],
  ['systemRoleReplacement', 'systemRoleReplacement'],
  ['customFlags', 'customFlags'],
  ['enableCustomFlags', 'enableCustomFlags'],
  ['regex', 'presetRegex'],
  ['reasonEffort', 'reasoningEffort'],
  ['thinkingTokens', 'thinkingTokens'],
  ['thinkingType', 'thinkingType'],
  ['deepseekThinkingType', 'deepseekThinkingType'],
  ['adaptiveThinkingEffort', 'adaptiveThinkingEffort'],
  ['deepseekReasoningEffort', 'deepseekReasoningEffort'],
  ['outputImageModal', 'outputImageModal'],
  ['seperateModelsForAxModels', 'seperateModelsForAxModels'],
  ['seperateModels', 'seperateModels'],
  ['modelTools', 'modelTools'],
  ['fallbackModels', 'fallbackModels'],
  ['fallbackWhenBlankResponse', 'fallbackWhenBlankResponse'],
  ['verbosity', 'verbosity'],
  ['dynamicOutput', 'dynamicOutput'],
]

export interface Fixture {
  /** Optional partial Database overrides merged onto the defaulted base. */
  db?: Partial<Database> & { characters?: character[] }
  /** Which character slot the user has selected. Defaults to 0. */
  selectedCharID?: number
  /** Arguments passed to sendChat(). Subset of the real arg shape. */
  sendChatArgs?: {
    continue?: boolean
    preview?: boolean
    previewPrompt?: boolean
  }
  /**
   * When true, the test driver synthesizes a pre-aborted AbortSignal and
   * passes it as `signal`. Used to pin sendChat's behavior when the caller
   * has already cancelled before the function runs.
   */
  aborted?: boolean
  /**
   * Optional list of model entries to push into LLMModels for the duration of
   * the test. Useful for providers (e.g. Gemini) whose entries are normally
   * registered dynamically via registerModelDynamic; tests need the entry
   * present so getModelInfo resolves correctly. The cleanup callback restores
   * the prior LLMModels contents.
   */
  injectedModels?: LLMModel[]
}

export interface LoadedFixture {
  name: string
  fixture: Fixture
  cleanup: () => void
}

/**
 * Load a fixture by name and install it into resource database + selectedCharID.
 * Returns a cleanup() that restores the prior state.
 */
export async function loadFixture(name: string): Promise<LoadedFixture> {
  const path = resolve(HERE, 'db', `${name}.json`)
  const raw = await readFile(path, 'utf8')
  const fixture = JSON.parse(raw) as Fixture

  // Seed with full defaults then overlay the fixture's overrides.
  const seed = (fixture.db ?? {}) as Database
  // setDatabase forcibly resets some web-only fields (e.g. `promptInfoInsideChat`)
  // regardless of caller intent. Capture them up front so we can re-apply
  // post-seed when the fixture explicitly set a value.
  const promptInfoOverride = fixture.db?.promptInfoInsideChat
  const promptTextInfoOverride = fixture.db?.promptTextInfoInsideChat
  setDatabase(seed)
  // setDatabase mutates `seed` in place and assigns it to getDatabase() via setDatabaseLite.
  // Characters/chats from the fixture survive because they're carried in `seed`.
  // Post-generation writes resolve their owner strictly by stable IDs. The
  // characterization corpus predates that invariant, so give legacy fixture
  // chats deterministic IDs without consuming the mocked generation UUIDs.
  for (const [characterIndex, character] of getDatabase().characters.entries()) {
    for (const [chatIndex, chat] of character.chats.entries()) {
      chat.id ??= `fixture-chat-${characterIndex}-${chatIndex}`
    }
  }
  if (promptInfoOverride !== undefined) {
    getDatabase().promptInfoInsideChat = promptInfoOverride
  }
  if (promptTextInfoOverride !== undefined) {
    getDatabase().promptTextInfoInsideChat = promptTextInfoOverride
  }

  const selectId = fixture.selectedCharID ?? 0
  selectedCharID.set(selectId)

  // Push injected models (Gemini, AWS Bedrock, etc.) and remember each
  // one's index for cleanup. We splice from the end on cleanup to avoid
  // disturbing other indices. modellist is imported lazily so loading a
  // fixture without injectedModels does not drag the entire model registry
  // (and its `$effect` chain) into the dependency graph eagerly.
  const injectedIndices: number[] = []
  const toInject = fixture.injectedModels ?? []
  let modelRegistry: { LLMModels: LLMModel[] } | null = null
  if (toInject.length > 0) {
    modelRegistry = await import('../../model/modellist')
    for (const m of toInject) {
      injectedIndices.push(modelRegistry.LLMModels.length)
      modelRegistry.LLMModels.push(m)
    }
  }

  return {
    name,
    fixture,
    cleanup() {
      // Intentionally do not restore the prior resource database/selectedCharID:
      // downstream $effect.root listeners (parser.svelte.ts, stores.svelte.ts)
      // fire reactively on those writes, and tearing them back to `{}` mid-run
      // surfaces as an unhandled error. Each fixture's loadFixture() reseeds
      // resource database wholesale, so leaving stale state between tests is safe.
      // Remove injected models in reverse order so each splice doesn't shift
      // the remaining indices.
      if (modelRegistry !== null) {
        for (let i = injectedIndices.length - 1; i >= 0; i--) {
          modelRegistry.LLMModels.splice(injectedIndices[i], 1)
        }
      }
    },
  }
}

/**
 * The sendChat fixture corpus predates chat-scoped generation settings. Tests
 * that exercise successful sends must explicitly mark the active fixture chat
 * as configured instead of relying on the product's legacy global defaults.
 */
export function markFixtureActiveChatGenerationSettingsReady(): void {
  const db = getDatabase()
  const selectedCharacterIndex = getInteger(selectedCharIDValue(), 0)
  const character = db.characters?.[selectedCharacterIndex] ?? db.characters?.[0]
  const chatIndex = getInteger(character?.chatPage, 0)
  const chat = character?.chats?.[chatIndex] ?? character?.chats?.[0]
  if (!character || !chat) {
    throw new Error('Fixture did not seed an active chat')
  }

  db.personas = Array.isArray(db.personas) ? db.personas : []
  db.botPresets = Array.isArray(db.botPresets) ? db.botPresets : []

  const personaIndex = Math.min(Math.max(getInteger(db.selectedPersona, 0), 0), db.personas.length)
  if (!db.personas[personaIndex]) {
    db.personas[personaIndex] = {
      id: `fixture-persona-${personaIndex}`,
      name: db.username ?? 'User',
      icon: db.userIcon ?? '',
      personaPrompt: db.personaPrompt ?? '',
      note: db.userNote ?? '',
      largePortrait: false,
    }
  }
  const persona = db.personas[personaIndex] as ChatGenerationPersonaReference
  backfillFixturePersonaFromDatabase(db, persona)
  if (!isNonEmptyString(persona.id)) {
    persona.id = `fixture-persona-${personaIndex}`
  }
  db.selectedPersonaId = persona.id
  mirrorFixturePersonaIntoDatabase(db, persona)

  const modelPresetIndex = Math.min(Math.max(getInteger(db.modelPresetsId, 0), 0), db.modelPresets.length)
  if (!db.modelPresets[modelPresetIndex]) {
    db.modelPresets[modelPresetIndex] = {
      id: `fixture-model-preset-${modelPresetIndex}`,
      name: 'Fixture Model Preset',
    } as Database['modelPresets'][number]
  }
  const modelPreset = db.modelPresets[modelPresetIndex] as ChatGenerationModelPresetReference
  if (!isNonEmptyString(modelPreset.id)) {
    modelPreset.id = `fixture-model-preset-${modelPresetIndex}`
  }

  const promptPresetIndex = Math.min(Math.max(getInteger(db.promptPresetsId, 0), 0), db.promptPresets.length)
  if (!db.promptPresets[promptPresetIndex]) {
    db.promptPresets[promptPresetIndex] = {
      id: `fixture-prompt-preset-${promptPresetIndex}`,
      name: 'Fixture Prompt Preset',
    } as Database['promptPresets'][number]
  }
  const promptPreset = db.promptPresets[promptPresetIndex] as ChatGenerationPromptPresetReference
  if (!isNonEmptyString(promptPreset.id)) {
    promptPreset.id = `fixture-prompt-preset-${promptPresetIndex}`
  }
  mirrorFixtureDatabaseIntoPreset(db, modelPreset)
  mirrorFixtureDatabaseIntoPreset(db, promptPreset)

  const requirements = resolveChatGenerationControlRequirements({
    modelPresetId: modelPreset.id,
    promptPresetId: promptPreset.id,
    modelPresets: db.modelPresets as unknown as ChatGenerationModelPresetReference[],
    promptPresets: db.promptPresets as unknown as ChatGenerationPromptPresetReference[],
    modules: (Array.isArray(db.modules) ? db.modules : []) as ChatGenerationModuleReference[],
    enabledModuleIds: stringArray(db.enabledModules),
    characterModuleIds: stringArray(character.modules),
    chatModuleIds: stringArray(chat.modules),
    moduleIntegration:
      typeof (promptPreset as { moduleIntergration?: unknown }).moduleIntergration === 'string'
        ? (promptPreset as { moduleIntergration: string }).moduleIntergration
        : null,
  })
  const globalChatVariables = recordOfStrings(db.globalChatVariables)
  const sidebarToggles = Object.fromEntries(
    requirements.sidebarToggles.map((toggle) => [toggle.key, globalChatVariables[`toggle_${toggle.key}`] ?? '0']),
  )

  chat.generationSettings = {
    configured: true,
    personaId: persona.id,
    modelPresetId: modelPreset.id,
    promptPresetId: promptPreset.id,
    jailbreakToggle: db.jailbreakToggle === true,
    sidebarToggles,
  }
}

function mirrorFixtureDatabaseIntoPreset(
  db: Database,
  preset: ChatGenerationModelPresetReference | ChatGenerationPromptPresetReference,
): void {
  const dbRecord = db as unknown as Record<string, unknown>
  const presetRecord = preset as unknown as Record<string, unknown>
  for (const [presetKey, databaseKey] of FIXTURE_PRESET_MIRROR_KEYS) {
    if (!hasOwn(dbRecord, databaseKey)) continue
    presetRecord[presetKey] = cloneFixtureJson(dbRecord[databaseKey])
  }
}

function mirrorFixturePersonaIntoDatabase(db: Database, persona: ChatGenerationPersonaReference): void {
  const personaRecord = persona as Record<string, unknown>
  db.personaPrompt = typeof personaRecord.personaPrompt === 'string' ? personaRecord.personaPrompt : ''
  db.userNote = typeof personaRecord.note === 'string' ? personaRecord.note : ''
  db.username = typeof personaRecord.name === 'string' ? personaRecord.name : (db.username ?? '')
  db.userIcon = typeof personaRecord.icon === 'string' ? personaRecord.icon : (db.userIcon ?? '')
}

function backfillFixturePersonaFromDatabase(db: Database, persona: ChatGenerationPersonaReference): void {
  const personaRecord = persona as Record<string, unknown>
  if (!isNonEmptyString(personaRecord.personaPrompt) && typeof db.personaPrompt === 'string') {
    personaRecord.personaPrompt = db.personaPrompt
  }
  if (typeof personaRecord.note !== 'string' && typeof db.userNote === 'string') {
    personaRecord.note = db.userNote
  }
  if (!isNonEmptyString(personaRecord.name) && typeof db.username === 'string') {
    personaRecord.name = db.username
  }
  if (typeof personaRecord.icon !== 'string' && typeof db.userIcon === 'string') {
    personaRecord.icon = db.userIcon
  }
}

function selectedCharIDValue(): unknown {
  let value: unknown
  selectedCharID.subscribe((next) => {
    value = next
  })()
  return value
}

function getInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? (value as number) : fallback
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function recordOfStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') out[key] = raw
  }
  return out
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function cloneFixtureJson<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
