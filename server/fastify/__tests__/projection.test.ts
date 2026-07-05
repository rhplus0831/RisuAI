import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { MASKED_PROVIDER_SECRET, maskProviderSecrets } from '../src/providerSecrets.js'
import { jsonPayloadBytes } from '../src/protocolMetrics.js'
import {
  ensureDbJsonImported,
  loadPersisted,
  loadPersistedDatabaseFields,
  loadStubbedProjectionFields,
  writePersistedWithMessages,
} from '../src/repository.js'
import { openDatabase } from '../src/db.js'
import { fullBootstrapFallbackClass, resourceProjectionFields } from '../src/routes/projection.js'
import type { FastifyInstance } from 'fastify'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
}

interface ProjectionMetric {
  metric: string
  resource?: string
  revision?: number
  mode?: string
  fallbackClass?: string | null
  payloadBytes?: number | null
}

// Capture opt-in protocol metrics regardless of the logger sink so the
// sprawling-resource full-bootstrap measurement can assert which resources
// trigger a `mode: 'full'` fallback and how the route classifies them.
const capturedMetrics = vi.hoisted((): ProjectionMetric[] => [])

vi.mock('../src/protocolMetrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/protocolMetrics.js')>()
  return {
    ...actual,
    emitProtocolMetric: (name: string, fields: Record<string, unknown> | (() => Record<string, unknown>)) => {
      if (!actual.protocolMetricsEnabled()) return
      capturedMetrics.push({
        metric: name,
        ...(typeof fields === 'function' ? fields() : fields),
      } as ProjectionMetric)
    },
  }
})

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-projection-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
  })
  return { app, dataDir }
}

let harness: Harness
let assertion: string

beforeEach(async () => {
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
})

afterEach(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

async function importDatabase(database: unknown): Promise<number> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(res.statusCode).toBe(200)
  return res.json().revision as number
}

async function getProjection(resource: string, query = '') {
  return harness.app.inject({
    method: 'GET',
    url: `/api/v1/projection/${resource}${query}`,
    headers: { 'risu-auth': assertion },
  })
}

function selectFields(database: Record<string, unknown>, fieldKeys: readonly string[]): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const key of fieldKeys) {
    if (Object.prototype.hasOwnProperty.call(database, key)) {
      fields[key] = database[key]
    }
  }
  return fields
}

describe('targeted projection route (lazy-projection Phase 2)', () => {
  it('returns the owned top-level fields for a structural resource', async () => {
    const revision = await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          chats: [
            {
              id: 'chat-a',
              message: [{ role: 'user', data: 'hello' }],
              hypaV3Data: { mainChunks: [{ text: 'summary' }] },
            },
          ],
          oaiTTSConfig: { apiKey: 'tts-secret' },
        },
      ],
      botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
      language: 'en',
    })

    const res = await getProjection('character')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.revision).toBe(revision)
    expect(body.resource).toBe('character')
    expect(body.mode).toBe('fields')
    // Only the resource's owned keys are present.
    expect(Object.keys(body.fields).sort()).toEqual(['characterOrder', 'characters', 'currentChar'])
    expect(body.fields.characters[0]).toMatchObject({ chaId: 'char-a', name: 'Ada' })
    expect(body.fields.characters[0].oaiTTSConfig.apiKey).toBe(MASKED_PROVIDER_SECRET)
    expect(body.fields.characters[0].chats[0].message).toEqual([])
    expect(body.fields.characters[0].chats[0]).not.toHaveProperty('hypaV3Data')
    expect(body.fields).not.toHaveProperty('botPresets')
    expect(body.fields).not.toHaveProperty('language')
  })

  it('returns only character stubs for character-family resources', async () => {
    await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hello' }] }],
        },
      ],
      characterOrder: ['char-a'],
      currentChar: 'char-a',
      botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
    })

    const body = (await getProjection('chat')).json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields)).toEqual(['characters'])
    expect(body.fields.characters[0].chats[0].message).toEqual([])
    expect(body.fields).not.toHaveProperty('characterOrder')
    expect(body.fields).not.toHaveProperty('botPresets')
  })

  it('returns only the selected character pointer data for character selection', async () => {
    const revision = await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          lastInteraction: 111,
          chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hello' }] }],
        },
        {
          chaId: 'char-b',
          name: 'Babbage',
          lastInteraction: 222,
          chats: [{ id: 'chat-b', message: [{ role: 'char', data: 'hi' }] }],
        },
      ],
      characterOrder: ['char-a', 'char-b'],
      currentChar: 1,
    })

    const res = await getProjection('characterSelection', '?id=char-b')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({
      revision,
      resource: 'characterSelection',
      mode: 'character-selection',
      characterId: 'char-b',
      currentChar: 1,
      lastInteraction: 222,
    })
    expect(body).not.toHaveProperty('fields')
    expect(JSON.stringify(body)).not.toContain('Ada')
    expect(JSON.stringify(body)).not.toContain('Babbage')
  })

  it('returns preset stubs for preset field refreshes and masks secrets in full preset hydration', async () => {
    await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      botPresets: [
        {
          id: 'p1',
          name: 'Preset 1',
          image: 'data:image/png;base64,stub',
          metadata: { tag: 'kept' },
          customPromptTemplateToggle: 'mode=Mode',
          moduleIntergration: 'preset-space',
          openAIKey: 'sk-secret',
          proxyKey: 'px-secret',
          promptTemplate: [{ id: 'prompt-a', type: 'plain', text: 'heavy prompt' }],
        },
      ],
      language: 'en',
    })

    const res = await getProjection('preset')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields).sort()).toEqual(['botPresets', 'botPresetsId'])
    expect(body.fields.botPresets).toEqual([
      {
        id: 'p1',
        name: 'Preset 1',
        image: 'data:image/png;base64,stub',
        metadata: { tag: 'kept' },
        customPromptTemplateToggle: 'mode=Mode',
        moduleIntergration: 'preset-space',
      },
    ])
    expect(body.fields.botPresets[0]).not.toHaveProperty('promptTemplate')
    expect(body.fields.botPresets[0]).not.toHaveProperty('openAIKey')
    expect(body.fields).not.toHaveProperty('characters')
    expect(body.fields).not.toHaveProperty('language')

    const hydrated = await getProjection('preset', '?id=p1')
    expect(hydrated.statusCode).toBe(200)
    const hydratedBody = hydrated.json()
    expect(hydratedBody.mode).toBe('preset')
    expect(hydratedBody.preset.openAIKey).toBe(MASKED_PROVIDER_SECRET)
    expect(hydratedBody.preset.proxyKey).toBe(MASKED_PROVIDER_SECRET)
    expect(hydratedBody.preset.promptTemplate).toEqual([{ id: 'prompt-a', type: 'plain', text: 'heavy prompt' }])
  })

  it('reships promptTemplate (not botPresets) for a promptItem refresh', async () => {
    // Phase 4 prompt-items slice co-fix: a foreign client refreshing on a
    // promptItem event must see the changed prompt-items collection, not the
    // unrelated botPresets the resource used to point at.
    await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      promptTemplate: [{ type: 'plain', text: 'stale top-level' }],
      promptPresetsId: 0,
      promptPresets: [
        {
          id: 'prompt-a',
          name: 'Prompt A',
          promptTemplate: [{ type: 'plain', text: 'item-0' }],
        },
      ],
      botPresets: [{ id: 'p1', name: 'P1' }],
      language: 'en',
    })

    const res = await getProjection('promptItem')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields)).toEqual(['promptTemplate'])
    expect(body.fields.promptTemplate[0]).toMatchObject({ type: 'plain', text: 'item-0' })
    expect(body.fields).not.toHaveProperty('botPresets')
  })

  it('derives promptItem projection from the selected prompt preset template', async () => {
    await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      promptTemplate: [{ id: 'top-level-stale', type: 'plain', text: 'stale top-level' }],
      promptPresetsId: 1,
      promptPresets: [
        { id: 'prompt-a', name: 'Prompt A', promptTemplate: [{ id: 'prompt-a-row', text: 'A' }] },
        { id: 'prompt-b', name: 'Prompt B', promptTemplate: [{ id: 'prompt-b-row', text: 'B' }] },
      ],
      language: 'en',
    })

    const res = await getProjection('promptItem')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields)).toEqual(['promptTemplate'])
    expect(body.fields.promptTemplate).toEqual([{ id: 'prompt-b-row', text: 'B' }])
  })

  it('derives promptItem projection from a requested prompt preset owner', async () => {
    await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      promptPresetsId: 1,
      promptPresets: [
        { id: 'prompt-a', name: 'Prompt A', promptTemplate: [{ id: 'prompt-a-row', text: 'A' }] },
        { id: 'prompt-b', name: 'Prompt B', promptTemplate: [{ id: 'prompt-b-row', text: 'B' }] },
      ],
      language: 'en',
    })

    const res = await getProjection('promptItem', '?parentId=prompt-a')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(body.fields.promptTemplate).toEqual([{ id: 'prompt-a-row', text: 'A' }])
  })

  it('clears promptItem compatibility projection when the selected prompt preset has no template', async () => {
    await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      promptTemplate: [{ id: 'top-level-stale', type: 'plain', text: 'stale top-level' }],
      promptPresetsId: 0,
      promptPresets: [{ id: 'prompt-a', name: 'Prompt A' }],
      language: 'en',
    })

    const res = await getProjection('promptItem')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields)).toEqual(['promptTemplate'])
    expect(body.fields.promptTemplate).toBeNull()
  })

  it('reships the applied prompt fields for a promptPreset refresh', async () => {
    const revision = await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      modelPresets: [{ id: 'model-a', name: 'Model A' }],
      promptPresetsId: 0,
      promptPresets: [
        {
          id: 'prompt-a',
          name: 'Prompt A',
          mainPrompt: 'main a',
          presetRegex: [{ id: 'regex-a' }],
          promptTemplate: [{ id: 'prompt-item-a', type: 'plain', text: 'template a' }],
        },
        {
          id: 'prompt-b',
          name: 'Prompt B',
          mainPrompt: 'main b',
          customPromptTemplateToggle: 'tone=Tone',
          presetRegex: [{ id: 'regex-b' }],
          promptTemplate: [{ id: 'prompt-item-b', type: 'plain', text: 'template b' }],
        },
      ],
      promptTemplate: [{ id: 'current-item', type: 'plain', text: 'current template' }],
      language: 'en',
    })

    const selected = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/prompt-presets/select',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, promptPresetId: 'prompt-b' },
    })
    expect(selected.statusCode).toBe(200)

    const res = await getProjection('promptPreset')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(resourceProjectionFields('promptPreset')).toEqual(
      expect.arrayContaining([
        'promptPresets',
        'promptPresetsId',
        'mainPrompt',
        'customPromptTemplateToggle',
        'presetRegex',
        'promptTemplate',
      ]),
    )
    expect(body.fields.promptPresetsId).toBe(1)
    expect(body.fields.mainPrompt).toBe('main b')
    expect(body.fields.customPromptTemplateToggle).toBe('tone=Tone')
    expect(body.fields.presetRegex).toEqual([{ id: 'regex-b' }])
    expect(body.fields.promptTemplate).toEqual([{ id: 'prompt-item-b', type: 'plain', text: 'template b' }])
    expect(body.fields).not.toHaveProperty('characters')
  })

  it('projects an empty applied promptTemplate for a promptPreset refresh', async () => {
    const revision = await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      modelPresets: [{ id: 'model-a', name: 'Model A' }],
      promptPresetsId: 0,
      promptPresets: [
        {
          id: 'prompt-a',
          name: 'Prompt A',
          mainPrompt: 'main a',
          promptTemplate: [{ id: 'prompt-item-a', type: 'plain', text: 'template a' }],
        },
        {
          id: 'prompt-b',
          name: 'Prompt B',
          mainPrompt: 'main b',
          promptTemplate: [],
        },
      ],
      promptTemplate: [{ id: 'current-item', type: 'plain', text: 'current template' }],
      language: 'en',
    })

    const selected = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/prompt-presets/select',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, promptPresetId: 'prompt-b' },
    })
    expect(selected.statusCode).toBe(200)

    const res = await getProjection('promptPreset')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(body.fields.promptPresetsId).toBe(1)
    expect(body.fields.mainPrompt).toBe('main b')
    expect(body.fields.promptTemplate).toEqual([])
  })

  it('projects an empty applied promptTemplate after updating the selected promptPreset', async () => {
    const revision = await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      modelPresets: [{ id: 'model-a', name: 'Model A' }],
      promptPresetsId: 0,
      promptPresets: [
        {
          id: 'prompt-a',
          name: 'Prompt A',
          mainPrompt: 'main a',
          promptTemplate: [{ id: 'prompt-item-a', type: 'plain', text: 'template a' }],
        },
      ],
      promptTemplate: [{ id: 'prompt-item-a', type: 'plain', text: 'template a' }],
      language: 'en',
    })

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/prompt-presets/prompt-a',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { promptTemplate: [] } },
    })
    expect(updated.statusCode).toBe(200)

    const res = await getProjection('promptPreset')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(body.fields.promptPresetsId).toBe(0)
    expect(body.fields.promptTemplate).toEqual([])
  })

  it('projects an empty applied promptTemplate after deleting the selected promptPreset', async () => {
    const revision = await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      modelPresets: [{ id: 'model-a', name: 'Model A' }],
      promptPresetsId: 1,
      promptPresets: [
        {
          id: 'prompt-a',
          name: 'Prompt A',
          mainPrompt: 'main a',
          promptTemplate: [],
        },
        {
          id: 'prompt-b',
          name: 'Prompt B',
          mainPrompt: 'main b',
          promptTemplate: [{ id: 'prompt-item-b', type: 'plain', text: 'template b' }],
        },
      ],
      promptTemplate: [{ id: 'prompt-item-b', type: 'plain', text: 'template b' }],
      language: 'en',
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/prompt-presets/prompt-b',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, promptPresetId: 'prompt-a' },
    })
    expect(deleted.statusCode).toBe(200)

    const res = await getProjection('promptPreset')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(body.fields.promptPresetsId).toBe(0)
    expect(body.fields.promptTemplate).toEqual([])
  })

  it('includes the legacy mirror scalars for a persona refresh', async () => {
    // Phase 4 personas slice co-fix: select/delete mirror the profile into the
    // username/userIcon/personaPrompt/userNote settings scalars, so a foreign
    // refresh must reship them alongside personas + selectedPersona.
    await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      personas: [{ id: 'persona-a', name: 'Persona A' }],
      selectedPersona: 0,
      username: 'Persona A',
      userIcon: '',
      personaPrompt: 'pa-prompt',
      userNote: 'pa-note',
      language: 'en',
    })

    const res = await getProjection('persona')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields).sort()).toEqual([
      'personaPrompt',
      'personas',
      'selectedPersona',
      'userIcon',
      'userNote',
      'username',
    ])
    expect(body.fields.username).toBe('Persona A')
    expect(body.fields.personaPrompt).toBe('pa-prompt')
    expect(body.fields).not.toHaveProperty('language')
  })

  it('includes lastLoadedLoadoutName for a loadout refresh', async () => {
    // Phase 4 loadouts slice co-fix: touch/delete write the lastLoadedLoadoutName
    // settings scalar, so a foreign refresh must reship it with the loadouts.
    await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      loadouts: [{ id: 'loadout-a', name: 'Loadout A', lastUsed: 1 }],
      lastLoadedLoadoutName: 'Loadout A',
      language: 'en',
    })

    const res = await getProjection('loadout')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields).sort()).toEqual(['lastLoadedLoadoutName', 'loadouts'])
    expect(body.fields.lastLoadedLoadoutName).toBe('Loadout A')
    expect(body.fields).not.toHaveProperty('language')
  })

  it('includes model profile fields and masks profile secrets for a modelProfile refresh', async () => {
    await importDatabase({
      modelProfiles: [
        {
          id: 'profile-a',
          name: 'Profile A',
          providerOptions: {
            apiKey: 'profile-key',
            vertex: { privateKey: 'vertex-private', region: 'us-central1' },
          },
        },
      ],
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'profile-a' } },
      modelRuntimeDefaults: { temperature: 55 },
      language: 'en',
    })

    const res = await getProjection('modelProfile')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields).sort()).toEqual(['modelProfiles', 'modelRoleProfiles', 'modelRuntimeDefaults'])
    expect(body.fields.modelProfiles[0].providerOptions.apiKey).toBe(MASKED_PROVIDER_SECRET)
    expect(body.fields.modelProfiles[0].providerOptions.vertex.privateKey).toBe(MASKED_PROVIDER_SECRET)
    expect(body.fields.modelRoleProfiles.chatMain).toEqual({ mode: 'profile', profileId: 'profile-a' })
    expect(body.fields.modelRuntimeDefaults).toEqual({ temperature: 55 })
    expect(body.fields).not.toHaveProperty('language')
  })

  it('falls back to full for a prompt-settings refresh (not botPresets)', async () => {
    // Projection field-bug fix: prompt-settings writes ~21 scattered settings
    // scalars, so a foreign refresh must full-bootstrap. The prior
    // `prompt → ['botPresets']` mapping pointed at an unrelated field, so a
    // foreign refresh never reflected the changed prompt settings.
    const revision = await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      botPresets: [{ id: 'p1', name: 'P1' }],
      language: 'en',
    })

    const res = await getProjection('prompt')
    const body = res.json()
    expect(body.revision).toBe(revision)
    expect(body.mode).toBe('full')
    expect(body.fields).toBeUndefined()
    // Must not point at the unrelated botPresets field any more.
    expect(resourceProjectionFields('prompt')).toBeNull()
    expect(fullBootstrapFallbackClass('prompt')).toBe('sprawling')
  })

  it('returns mode "full" for a sprawling resource (settings)', async () => {
    const revision = await importDatabase({ characters: [], language: 'en' })
    const res = await getProjection('settings')
    const body = res.json()
    expect(body.revision).toBe(revision)
    expect(body.mode).toBe('full')
    expect(body.fields).toBeUndefined()
  })

  it('returns mode "full" for an unknown resource', async () => {
    await importDatabase({ characters: [] })
    const res = await getProjection('does-not-exist')
    expect(res.json().mode).toBe('full')
  })

  it('returns empty fields for the asset resource (no projected change)', async () => {
    await importDatabase({ characters: [] })
    const res = await getProjection('asset')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(body.fields).toEqual({})
  })

  it('returns empty fields for the asset resource even when no database is seeded', async () => {
    // db.json is never read; asset projection always returns empty fields.
    const res = await getProjection('asset')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(body.fields).toEqual({})
  })

  it('maps every command-event resource to either fields or full', () => {
    // The structural resources the decision tree narrows; everything else
    // (settings/state/pluginStorage/unknown) intentionally falls back to full.
    expect(resourceProjectionFields('character')).toEqual(['characters', 'characterOrder', 'currentChar'])
    expect(resourceProjectionFields('characterSelection')).toEqual([])
    expect(resourceProjectionFields('message')).toEqual([])
    expect(resourceProjectionFields('generation')).toEqual(['characters'])
    expect(resourceProjectionFields('module')).toEqual(['modules', 'enabledModules', 'loadouts', 'characters'])
    // Narrowed module-family resources (Phase 5 collection-projection slice).
    expect(resourceProjectionFields('moduleUpdated')).toEqual(['modules'])
    expect(resourceProjectionFields('moduleReordered')).toEqual(['modules'])
    expect(resourceProjectionFields('moduleEnabled')).toEqual(['enabledModules'])
    expect(resourceProjectionFields('scriptDefinition')).toEqual(['characters'])
    expect(resourceProjectionFields('triggerDefinition')).toEqual(['characters'])
    expect(resourceProjectionFields('moduleScriptDefinition')).toEqual(['modules'])
    expect(resourceProjectionFields('moduleTriggerDefinition')).toEqual(['modules'])
    expect(resourceProjectionFields('lorebook')).toEqual(['characters', 'modules', 'loreBook', 'loreBookPage'])
    expect(resourceProjectionFields('asset')).toEqual([])
    expect(resourceProjectionFields('preset')).toEqual(['botPresets', 'botPresetsId'])
    expect(resourceProjectionFields('promptItem')).toEqual(['promptTemplate'])
    expect(resourceProjectionFields('modelProfile')).toEqual([
      'modelProfiles',
      'modelRoleProfiles',
      'modelRuntimeDefaults',
    ])
    expect(resourceProjectionFields('agentPreset')).toEqual(['agentPresets', 'agentPresetDefaultId'])
    expect(resourceProjectionFields('agentPresetDeleted')).toEqual([
      'agentPresets',
      'agentPresetDefaultId',
      'characters',
      'loadouts',
    ])
    expect(resourceProjectionFields('persona')).toEqual([
      'personas',
      'selectedPersona',
      'username',
      'userIcon',
      'personaPrompt',
      'userNote',
    ])
    expect(resourceProjectionFields('loadout')).toEqual(['loadouts', 'lastLoadedLoadoutName'])
    expect(resourceProjectionFields('settings')).toBeNull()
    expect(resourceProjectionFields('state')).toBeNull()
  })

  it('classifies full-bootstrap fallbacks as sprawling, unknown, or narrowable', () => {
    // Narrowable resources never trigger the fallback.
    expect(fullBootstrapFallbackClass('character')).toBeNull()
    expect(fullBootstrapFallbackClass('characterSelection')).toBeNull()
    expect(fullBootstrapFallbackClass('asset')).toBeNull()
    // Known sprawling resources fall back on purpose.
    expect(fullBootstrapFallbackClass('settings')).toBe('sprawling')
    expect(fullBootstrapFallbackClass('state')).toBe('sprawling')
    expect(fullBootstrapFallbackClass('pluginStorage')).toBe('sprawling')
    expect(fullBootstrapFallbackClass('prompt')).toBe('sprawling')
    // Anything else is an unknown/foreign resource fallback.
    expect(fullBootstrapFallbackClass('does-not-exist')).toBe('unknown')
  })

  it('returns module deletion cross-writes with character stubs', async () => {
    const revision = await importDatabase({
      enabledModules: ['mod-a', 'mod-b'],
      loadouts: [{ id: 'load-a', modules: ['mod-a', 'mod-b'] }],
      modules: [
        { id: 'mod-a', name: 'Module A', description: '' },
        { id: 'mod-b', name: 'Module B', description: '' },
      ],
      characters: [
        {
          chaId: 'char-a',
          modules: ['mod-a', 'mod-b'],
          chats: [
            {
              id: 'chat-a',
              modules: ['mod-a', 'mod-b'],
              message: [{ role: 'user', data: 'hello' }],
              hypaV3Data: { mainChunks: [{ text: 'summary' }] },
            },
          ],
        },
      ],
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/modules/mod-b',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision },
    })
    expect(deleted.statusCode).toBe(200)

    const res = await getProjection('module')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.revision).toBe(revision + 1)
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields).sort()).toEqual(['characters', 'enabledModules', 'loadouts', 'modules'])
    expect(body.fields.modules.map((module: { id: string }) => module.id)).toEqual(['mod-a'])
    expect(body.fields.enabledModules).toEqual(['mod-a'])
    expect(body.fields.loadouts[0].modules).toEqual(['mod-a'])
    expect(body.fields.characters[0].modules).toEqual(['mod-a'])
    expect(body.fields.characters[0].chats[0].modules).toEqual(['mod-a'])
    expect(body.fields.characters[0].chats[0].message).toEqual([])
    expect(body.fields.characters[0].chats[0]).not.toHaveProperty('hypaV3Data')
  })

  it('narrows module enable/update/reorder refreshes to their own fields', async () => {
    // Phase 5 collection-projection slice: an enable/update/reorder edit no
    // longer re-ships every character + loadout via the broad `module` resource.
    const seed = () =>
      importDatabase({
        enabledModules: [],
        loadouts: [{ id: 'load-a', modules: ['mod-a'] }],
        modules: [
          { id: 'mod-a', name: 'Module A', description: '' },
          { id: 'mod-b', name: 'Module B', description: '' },
        ],
        characters: [
          {
            chaId: 'char-a',
            chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hello' }] }],
          },
        ],
      })

    const enableRevision = await seed()
    const enabled = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/modules/enable',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: enableRevision, moduleId: 'mod-a', enabled: true },
    })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json().event.resource).toBe('moduleEnabled')
    const enabledBody = (await getProjection('moduleEnabled')).json()
    expect(enabledBody.mode).toBe('fields')
    expect(Object.keys(enabledBody.fields)).toEqual(['enabledModules'])
    expect(enabledBody.fields.enabledModules).toEqual(['mod-a'])

    const updateRevision = await seed()
    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/modules/mod-b',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: updateRevision, patch: { name: 'Renamed B' } },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().event.resource).toBe('moduleUpdated')
    const updatedBody = (await getProjection('moduleUpdated')).json()
    expect(updatedBody.mode).toBe('fields')
    expect(Object.keys(updatedBody.fields)).toEqual(['modules'])
    expect(updatedBody.fields.modules.find((m: { id: string }) => m.id === 'mod-b').name).toBe('Renamed B')

    const reorderRevision = await seed()
    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/modules/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: reorderRevision, moduleIds: ['mod-b', 'mod-a'] },
    })
    expect(reordered.statusCode).toBe(200)
    expect(reordered.json().event.resource).toBe('moduleReordered')
    const reorderedBody = (await getProjection('moduleReordered')).json()
    expect(reorderedBody.mode).toBe('fields')
    expect(Object.keys(reorderedBody.fields)).toEqual(['modules'])
    expect(reorderedBody.fields.modules.map((m: { id: string }) => m.id)).toEqual(['mod-b', 'mod-a'])
  })

  it('M6: foreign field projections are byte-identical to the broad composition', async () => {
    const revision = await importDatabase({
      botPresets: [{ id: 'preset-a', name: 'Preset A', openAIKey: 'sk-preset-secret' }],
      botPresetsId: 3,
      currentPluginProvider: 'plugin-a',
      enabledModules: ['mod-a'],
      modules: [{ id: 'mod-a', name: 'Module A', description: '' }],
      plugins: [{ id: 'plugin-a', name: 'Plugin A', enabled: true }],
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          chats: [
            {
              id: 'chat-a',
              message: [{ role: 'user', data: 'hello' }],
              hypaV3Data: { mainChunks: [{ text: 'summary' }] },
            },
          ],
        },
      ],
    })

    const db = openDatabase(harness.dataDir)
    try {
      const database = loadPersisted(db, harness.dataDir).database as Record<string, unknown>
      for (const resource of ['plugin', 'moduleEnabled'] as const) {
        const fieldKeys = resourceProjectionFields(resource)
        expect(fieldKeys).not.toBeNull()
        const expected = {
          revision,
          resource,
          mode: 'fields',
          fields: maskProviderSecrets(selectFields(database, fieldKeys!)),
        }

        const res = await getProjection(resource)
        expect(res.statusCode).toBe(200)
        expect(res.body).toBe(JSON.stringify(expected))
      }

      const presetFields = resourceProjectionFields('preset')
      expect(presetFields).not.toBeNull()
      const expectedPreset = {
        revision,
        resource: 'preset',
        mode: 'fields',
        fields: {
          ...maskProviderSecrets(selectFields(database, presetFields!)),
          botPresets: [{ id: 'preset-a', name: 'Preset A' }],
        },
      }
      const presetRes = await getProjection('preset')
      expect(presetRes.statusCode).toBe(200)
      expect(presetRes.body).toBe(JSON.stringify(expectedPreset))
    } finally {
      db.close()
    }
  })

  it('narrows script/trigger refreshes to the affected character or module table', async () => {
    // Phase 5 collection-projection slice: character scripts ship `characters`
    // (no modules); module scripts ship `modules` (no characters).
    const seed = () =>
      importDatabase({
        modules: [{ id: 'mod-a', name: 'Module A', description: '', regex: [], trigger: [] }],
        characters: [
          {
            chaId: 'char-a',
            customscript: [],
            triggerscript: [],
            chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hello' }] }],
          },
        ],
        characterOrder: ['char-a'],
      })

    const charRevision = await seed()
    const charScripts = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/scripts',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: charRevision,
        scripts: [{ id: 's1', type: 'regex', in: 'a', out: 'b' }],
      },
    })
    expect(charScripts.statusCode).toBe(200)
    expect(charScripts.json().event.resource).toBe('scriptDefinition')
    const charBody = (await getProjection('scriptDefinition')).json()
    expect(charBody.mode).toBe('fields')
    expect(Object.keys(charBody.fields)).toEqual(['characters'])
    expect(charBody.fields.characters[0].customscript[0].id).toBe('s1')
    // Messages stay stubbed and modules are not re-shipped.
    expect(charBody.fields.characters[0].chats[0].message).toEqual([])

    const moduleRevision = await seed()
    const moduleScripts = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/modules/mod-a/scripts',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: moduleRevision,
        scripts: [{ id: 'ms1', type: 'regex', in: 'a', out: 'b' }],
      },
    })
    expect(moduleScripts.statusCode).toBe(200)
    expect(moduleScripts.json().event.resource).toBe('moduleScriptDefinition')
    const moduleBody = (await getProjection('moduleScriptDefinition')).json()
    expect(moduleBody.mode).toBe('fields')
    expect(Object.keys(moduleBody.fields)).toEqual(['modules'])
    expect(moduleBody.fields.modules[0].regex[0].id).toBe('ms1')
  })

  it('returns lorebook page and mixed lorebook fields with stubs', async () => {
    await importDatabase({
      enableLorebookStubs: true,
      loreBook: [
        { id: 'lore-a', name: 'A', data: [] },
        { id: 'lore-b', name: 'B', data: [] },
      ],
      loreBookPage: 1,
      modules: [{ id: 'mod-a', name: 'Module A', description: '', lorebook: [] }],
      characters: [
        {
          chaId: 'char-a',
          globalLore: [{ key: 'secret', content: 'lore' }],
          chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hello' }] }],
        },
      ],
    })

    const body = (await getProjection('lorebook')).json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields).sort()).toEqual(['characters', 'loreBook', 'loreBookPage', 'modules'])
    expect(body.fields.loreBookPage).toBe(1)
    expect(body.fields.loreBook.map((lorebook: { id: string }) => lorebook.id)).toEqual(['lore-a', 'lore-b'])
    expect(body.fields.characters[0]).not.toHaveProperty('globalLore')
    expect(body.fields.characters[0].chats[0].message).toEqual([])
  })

  it('narrows a global-lorebook refresh to loreBook fields (globalLorebook split)', async () => {
    // Phase 5 lorebook-resource-split slice: a global-lorebook edit no longer
    // re-ships every character + module via the broad `lorebook` resource.
    const revision = await importDatabase({
      loreBook: [{ id: 'book-a', name: 'A', data: [] }],
      loreBookPage: 0,
      modules: [{ id: 'mod-a', name: 'Module A', description: '' }],
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          globalLore: [{ key: 'k', content: 'lore' }],
          chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hi' }] }],
        },
      ],
    })

    const entries = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/lorebooks/book-a/entries',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        entries: [
          {
            id: 'e1',
            key: 'k',
            secondkey: '',
            insertorder: 100,
            comment: 'c',
            content: 'x',
            mode: 'normal',
            alwaysActive: false,
            selective: false,
          },
        ],
      },
    })
    expect(entries.statusCode).toBe(200)
    expect(entries.json().event.resource).toBe('globalLorebook')

    const body = (await getProjection('globalLorebook')).json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields).sort()).toEqual(['loreBook', 'loreBookPage'])
    expect(body.fields.loreBook[0].data[0].id).toBe('e1')
    // The global-lorebook refresh must never re-ship characters or modules.
    expect(body.fields).not.toHaveProperty('characters')
    expect(body.fields).not.toHaveProperty('modules')
  })

  it('narrows a character-lorebook refresh to the changed character (lorebook split)', async () => {
    // Phase 5 lorebook-resource-split slice: a character globalLore edit ships
    // only that character's globalLore, not the whole characters array.
    const revision = await importDatabase({
      loreBook: [{ id: 'book-a', name: 'A', data: [] }],
      loreBookPage: 0,
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          globalLore: [],
          chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hi' }], localLore: [] }],
          chatFolders: [],
          chatPage: 0,
        },
        {
          chaId: 'char-b',
          name: 'Babbage',
          globalLore: [],
          chats: [{ id: 'chat-b', message: [] }],
        },
      ],
      characterOrder: ['char-a', 'char-b'],
    })

    const replaced = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/lorebooks',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        entries: [
          {
            id: 'gl1',
            key: 'k',
            secondkey: '',
            insertorder: 100,
            comment: 'c',
            content: 'x',
            mode: 'normal',
            alwaysActive: false,
            selective: false,
          },
        ],
      },
    })
    expect(replaced.statusCode).toBe(200)
    expect(replaced.json().event.resource).toBe('characterLorebook')

    const body = (await getProjection('characterLorebook', '?id=char-a')).json()
    expect(body.mode).toBe('character-lorebook')
    expect(body.characterId).toBe('char-a')
    expect(body.globalLore).toHaveLength(1)
    expect(body.globalLore[0].id).toBe('gl1')
    // Only the changed character — no second-character data, no full fields blob.
    expect(body).not.toHaveProperty('fields')
    expect(JSON.stringify(body)).not.toContain('Babbage')
  })

  it('narrows a character field edit to a single character row (characterRow)', async () => {
    // Phase 5 character-chat-projection slice: a one-character edit ships just
    // that character (message-free) instead of re-shipping every character.
    const revision = await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hi' }] }],
        },
        {
          chaId: 'char-b',
          name: 'Babbage',
          chats: [{ id: 'chat-b', message: [{ role: 'user', data: 'yo' }] }],
        },
      ],
      characterOrder: ['char-a', 'char-b'],
    })

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/characters/char-a',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { name: 'Ada Lovelace' } },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().event.resource).toBe('characterRow')

    const body = (await getProjection('characterRow', '?id=char-a')).json()
    expect(body.mode).toBe('character-row')
    expect(body.characterId).toBe('char-a')
    expect(body.character.name).toBe('Ada Lovelace')
    // Messages are stubbed; only the changed character is shipped.
    expect(body.character.chats[0].message).toEqual([])
    expect(body).not.toHaveProperty('fields')
    expect(JSON.stringify(body)).not.toContain('Babbage')

    // Chat/folder events key the character row by parentId (the character id).
    const viaParent = (await getProjection('characterRow', '?parentId=char-a')).json()
    expect(viaParent.mode).toBe('character-row')
    expect(viaParent.characterId).toBe('char-a')
  })

  it('projects chat generation settings on stubbed character rows', async () => {
    const revision = await importDatabase({
      modelPresets: [{ id: 'model-a', name: 'Model A' }],
      promptPresets: [{ id: 'prompt-a', name: 'Prompt A' }],
      personas: [{ id: 'persona-a', name: 'Persona A', icon: '', personaPrompt: '', note: '' }],
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          chats: [
            {
              id: 'chat-a',
              message: [{ role: 'user', data: 'hi', chatId: 'msg-a' }],
              hypaV3Data: { mainChunks: [{ text: 'summary' }] },
            },
          ],
        },
        {
          chaId: 'char-b',
          name: 'Babbage',
          chats: [{ id: 'chat-b', message: [{ role: 'user', data: 'yo' }] }],
        },
      ],
      characterOrder: ['char-a', 'char-b'],
    })
    const generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-a',
      promptPresetId: 'prompt-a',
      jailbreakToggle: false,
      sidebarToggles: {},
    }

    const saved = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        generationSettings,
      },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().event.resource).toBe('characterRow')

    const broad = (await getProjection('character')).json()
    expect(broad.mode).toBe('fields')
    expect(broad.fields.characters[0].chats[0].message).toEqual([])
    expect(broad.fields.characters[0].chats[0]).not.toHaveProperty('hypaV3Data')
    expect(broad.fields.characters[0].chats[0].generationSettings).toEqual(generationSettings)

    const row = (await getProjection('characterRow', '?parentId=char-a')).json()
    expect(row.mode).toBe('character-row')
    expect(row.characterId).toBe('char-a')
    expect(row.character.chats[0].message).toEqual([])
    expect(row.character.chats[0]).not.toHaveProperty('hypaV3Data')
    expect(row.character.chats[0].generationSettings).toEqual(generationSettings)
    expect(JSON.stringify(row)).not.toContain('Babbage')
  })

  it('narrows a generation.persisted refresh to the changed chat messages', async () => {
    // Phase 5 character-chat-projection slice: generation.persisted (the one
    // foreign-firing command) ships just the changed chat's messages, keyed by
    // the event parentId (chatId), instead of re-stubbing every character.
    const revision = await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          chats: [
            {
              id: 'chat-a',
              message: [{ role: 'user', data: 'hi', chatId: 'msg-a' }],
              chatFolders: [],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const appended = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/generation-result',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        generationResult: {
          message: {
            role: 'char',
            data: 'fresh answer',
            chatId: 'gen-1',
            generationInfo: { generationId: 'gen-1', model: 'echo_model' },
          },
        },
      },
    })
    expect(appended.statusCode).toBe(200)
    expect(appended.json().event).toMatchObject({ resource: 'generation', parentId: 'chat-a' })

    // The narrow per-chat branch fires when the event parentId (chatId) is sent.
    const body = (await getProjection('generation', '?parentId=chat-a&id=gen-1')).json()
    expect(body.mode).toBe('generation-chat')
    expect(body.chatId).toBe('chat-a')
    expect(body.message.map((m: { chatId: string }) => m.chatId)).toEqual(['gen-1'])
    expect(body.messageStart).toBe(1)
    expect(body.messageTotal).toBe(2)
    expect(body).not.toHaveProperty('fields')
    expect(body).not.toHaveProperty('characters')

    // Without a chat id (recovery fetch) it falls back to the broad fields path.
    const fallback = (await getProjection('generation')).json()
    expect(fallback.mode).toBe('fields')
    expect(Object.keys(fallback.fields)).toEqual(['characters'])
  })

  it('narrows ordinary message refreshes to the changed chat messages', async () => {
    const revision = await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          chats: [
            {
              id: 'chat-a',
              message: [
                { role: 'user', data: 'hi', chatId: 'msg-a' },
                { role: 'char', data: 'reply', chatId: 'msg-b' },
              ],
            },
          ],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const body = (await getProjection('message', '?parentId=chat-a&id=msg-b')).json()
    expect(body).toMatchObject({
      revision,
      resource: 'message',
      mode: 'chat-messages',
      chatId: 'chat-a',
      message: [{ role: 'char', data: 'reply', chatId: 'msg-b' }],
      messageStart: 1,
      messageTotal: 2,
      alternates: [],
    })
    expect(body).not.toHaveProperty('fields')
    expect(body).not.toHaveProperty('characters')
  })
})

describe('single chat message hydration route', () => {
  it('serves full history by default and a tail window on request', async () => {
    const revision = await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          chats: [
            {
              id: 'chat-a',
              message: [
                { role: 'user', data: 'm0', chatId: 'm0' },
                { role: 'char', data: 'm1', chatId: 'm1' },
                { role: 'user', data: 'm2', chatId: 'm2' },
                { role: 'char', data: 'm3', chatId: 'm3' },
              ],
              hypaV3Data: { mainChunks: [{ text: 'summary' }] },
            },
          ],
        },
      ],
    })

    const full = (await getProjection('chatMessages', '?id=chat-a')).json()
    expect(full).toMatchObject({
      revision,
      resource: 'chatMessages',
      mode: 'chat-messages',
      chatId: 'chat-a',
      message: [
        { role: 'user', data: 'm0', chatId: 'm0' },
        { role: 'char', data: 'm1', chatId: 'm1' },
        { role: 'user', data: 'm2', chatId: 'm2' },
        { role: 'char', data: 'm3', chatId: 'm3' },
      ],
      hypaV3Data: { mainChunks: [{ text: 'summary' }] },
      alternates: [],
    })
    expect(full).not.toHaveProperty('messageStart')
    expect(full).not.toHaveProperty('messageTotal')

    const tail = (await getProjection('chatMessages', '?id=chat-a&tail=2')).json()
    expect(tail).toMatchObject({
      revision,
      resource: 'chatMessages',
      mode: 'chat-messages',
      chatId: 'chat-a',
      message: [
        { role: 'user', data: 'm2', chatId: 'm2' },
        { role: 'char', data: 'm3', chatId: 'm3' },
      ],
      messageStart: 2,
      messageTotal: 4,
      hypaV3Data: { mainChunks: [{ text: 'summary' }] },
      alternates: [],
    })
  })

  it('rejects malformed chat message ranges', async () => {
    await importDatabase({ characters: [] })
    const res = await getProjection('chatMessages', '?id=chat-a&tail=0')

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: 'invalid_chat_message_range',
      reason: 'Expected tail, or start and limit, to be positive integers.',
    })
  })
})

describe('bulk chat message hydration route', () => {
  it('serves requested chat histories in one read-only response', async () => {
    const revision = await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          chats: [
            {
              id: 'chat-a',
              message: [{ role: 'user', data: 'hello', chatId: 'm1' }],
              hypaV3Data: { mainChunks: [{ text: 'summary' }] },
            },
            {
              id: 'chat-b',
              message: [{ role: 'char', data: 'hi', chatId: 'm2' }],
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/projection/chatMessages/bulk',
      headers: { 'risu-auth': assertion },
      payload: { ids: ['chat-a', 'missing-chat', 'chat-b', 'chat-a'] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      revision,
      resource: 'chatMessages',
      mode: 'chat-messages-bulk',
      missing: ['missing-chat'],
    })
    expect(body.chats).toHaveLength(2)
    expect(body.chats[0]).toMatchObject({
      chatId: 'chat-a',
      message: [{ role: 'user', data: 'hello', chatId: 'm1' }],
      hypaV3Data: { mainChunks: [{ text: 'summary' }] },
    })
    expect(body.chats[0]).not.toHaveProperty('alternates')
    expect(body.chats[1]).toMatchObject({
      chatId: 'chat-b',
      message: [{ role: 'char', data: 'hi', chatId: 'm2' }],
    })
    expect(body.chats[1]).not.toHaveProperty('alternates')
    expect(body.chats[1]).not.toHaveProperty('hypaV3Data')
  })

  it('rejects malformed bulk chat ids', async () => {
    await importDatabase({ characters: [] })
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/projection/chatMessages/bulk',
      headers: { 'risu-auth': assertion },
      payload: { ids: ['chat-a', ''] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('invalid_chat_ids')
  })

  it('rejects malformed bulk chat envelope with the route error shape', async () => {
    await importDatabase({ characters: [] })

    for (const payload of [{}, { ids: 'chat-a' }, { ids: [123] }]) {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/projection/chatMessages/bulk',
        headers: { 'risu-auth': assertion },
        payload,
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({
        error: 'invalid_chat_ids',
        reason: 'Expected body.ids to be an array of non-empty chat ids.',
      })
    }
  })
})

describe('targeted projection field loader', () => {
  it('selects only requested persisted database fields', () => {
    const db = openDatabase(harness.dataDir)
    try {
      writePersistedWithMessages(db, harness.dataDir, {
        _version: 1,
        database: {
          botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
          botPresetsId: 2,
          characters: [{ chaId: 'char-a', chats: [{ id: 'chat-a', message: [{ data: 'hi' }] }] }],
          language: 'en',
        },
        assets: [],
      })
      expect(loadPersistedDatabaseFields(db, harness.dataDir, ['botPresets', 'botPresetsId'])).toEqual({
        botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
        botPresetsId: 2,
      })
    } finally {
      db.close()
    }
  })

  it('selects character fields with chat and lorebook stubs', () => {
    const db = openDatabase(harness.dataDir)
    const generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-a',
      promptPresetId: 'prompt-a',
      jailbreakToggle: false,
      sidebarToggles: { mode: '1' },
    }
    try {
      writePersistedWithMessages(db, harness.dataDir, {
        _version: 1,
        database: {
          enableLorebookStubs: true,
          characters: [
            {
              chaId: 'char-a',
              globalLore: [{ key: 'k', content: 'secret lore' }],
              chats: [
                {
                  id: 'chat-a',
                  message: [{ data: 'hi' }],
                  hypaV3Data: { mainChunks: [{ text: 'summary' }] },
                  generationSettings,
                },
              ],
            },
          ],
          characterOrder: ['char-a'],
          currentChar: 'char-a',
          botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
        },
        assets: [],
      })
      expect(loadStubbedProjectionFields(db, harness.dataDir, ['characters', 'characterOrder', 'currentChar'])).toEqual(
        {
          characters: [
            {
              chaId: 'char-a',
              chats: [{ id: 'chat-a', message: [], generationSettings }],
            },
          ],
          characterOrder: ['char-a'],
          currentChar: 'char-a',
        },
      )
    } finally {
      db.close()
    }
  })
})

describe('Phase 5 lorebook stubs (enableLorebookStubs)', () => {
  const characterWithLore = (extra: Record<string, unknown> = {}) => ({
    characters: [
      {
        chaId: 'char-a',
        name: 'Ada',
        globalLore: [{ key: 'k', content: 'secret lore' }],
      },
    ],
    language: 'en',
    ...extra,
  })

  it('keeps character globalLore resident by default (stubs off)', async () => {
    await importDatabase(characterWithLore())
    const body = (await getProjection('character')).json()
    expect(body.fields.characters[0]).toHaveProperty('globalLore')
    expect(body.fields.characters[0].globalLore).toHaveLength(1)
  })

  it('strips character globalLore from the projection when enableLorebookStubs is on', async () => {
    await importDatabase(characterWithLore({ enableLorebookStubs: true }))
    const body = (await getProjection('character')).json()
    expect(body.fields.characters[0]).not.toHaveProperty('globalLore')
  })

  it('serves the full globalLore via /projection/characterLorebook even when stubbed', async () => {
    await importDatabase(characterWithLore({ enableLorebookStubs: true }))
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/characterLorebook?id=char-a',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.mode).toBe('character-lorebook')
    expect(body.characterId).toBe('char-a')
    expect(body.globalLore).toHaveLength(1)
    expect(body.globalLore[0].content).toBe('secret lore')
  })

  it('matches single and bulk character lorebook hydration for the same character', async () => {
    await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          globalLore: [
            { key: 'a', content: 'lore a' },
            { key: 'aa', content: 'second lore a' },
          ],
        },
        {
          chaId: 'char-b',
          name: 'Babbage',
          globalLore: [{ key: 'b', content: 'lore b' }],
        },
      ],
      enableLorebookStubs: true,
    })

    const single = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/characterLorebook?id=char-a',
      headers: { 'risu-auth': assertion },
    })
    const bulk = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/projection/characterLorebooks/bulk',
      headers: { 'risu-auth': assertion },
      payload: { ids: ['char-a'] },
    })

    expect(single.statusCode).toBe(200)
    expect(bulk.statusCode).toBe(200)
    expect(bulk.json().characters).toEqual([
      {
        characterId: 'char-a',
        globalLore: single.json().globalLore,
      },
    ])
  })

  it('serves requested character lorebooks in one read-only response', async () => {
    const revision = await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          globalLore: [{ key: 'a', content: 'lore a' }],
        },
        {
          chaId: 'char-b',
          name: 'Babbage',
          globalLore: [{ key: 'b', content: 'lore b' }],
        },
        {
          chaId: 'char-empty',
          name: 'Empty',
        },
      ],
      enableLorebookStubs: true,
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/projection/characterLorebooks/bulk',
      headers: { 'risu-auth': assertion },
      payload: { ids: ['char-a', 'missing-char', 'char-empty', 'char-a'] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      revision,
      resource: 'characterLorebooks',
      mode: 'character-lorebooks-bulk',
      missing: ['missing-char'],
    })
    expect(body.characters).toHaveLength(2)
    expect(body.characters[0].characterId).toBe('char-a')
    expect(body.characters[0].globalLore[0]).toMatchObject({ key: 'a', content: 'lore a' })
    expect(body.characters[1]).toEqual({
      characterId: 'char-empty',
      globalLore: [],
    })
  })

  it('rejects malformed bulk character lorebook ids', async () => {
    await importDatabase(characterWithLore())
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/projection/characterLorebooks/bulk',
      headers: { 'risu-auth': assertion },
      payload: { ids: ['char-a', ''] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: 'invalid_character_lorebook_ids',
      reason: 'Expected body.ids to be an array of non-empty character ids.',
    })
  })

  it('returns mode:full for a missing characterLorebook id', async () => {
    await importDatabase(characterWithLore())
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/characterLorebook',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().mode).toBe('full')
  })
})

// Phase 3 sprawling-resource full-bootstrap measurement.
//
// Measurement-only: the route behavior is unchanged (these resources still
// return `mode: 'full'`). The opt-in `projection_response` metric now records
// `mode` plus a `fallbackClass` so the cost of expensive sprawling-resource and
// unknown-resource full-bootstrap fallbacks can be attributed per resource.
describe('sprawling-resource full-bootstrap measurement', () => {
  const PREVIOUS_PROTOCOL_METRICS = process.env.RISU_PROTOCOL_METRICS

  beforeEach(() => {
    process.env.RISU_PROTOCOL_METRICS = '1'
    capturedMetrics.length = 0
  })

  afterEach(() => {
    if (PREVIOUS_PROTOCOL_METRICS === undefined) {
      delete process.env.RISU_PROTOCOL_METRICS
    } else {
      process.env.RISU_PROTOCOL_METRICS = PREVIOUS_PROTOCOL_METRICS
    }
  })

  function latestProjectionMetric(resource: string): ProjectionMetric {
    const metric = [...capturedMetrics]
      .reverse()
      .find((entry) => entry.metric === 'projection_response' && entry.resource === resource)
    expect(metric, `missing projection_response metric for ${resource}`).toBeTruthy()
    return metric as ProjectionMetric
  }

  it('records mode and a sprawling fallback class for settings/state/pluginStorage', async () => {
    await importDatabase({ characters: [], language: 'en' })

    for (const resource of ['settings', 'state', 'pluginStorage']) {
      capturedMetrics.length = 0
      const res = await getProjection(resource)
      const body = res.json()
      expect(body.mode).toBe('full')

      const metric = latestProjectionMetric(resource)
      expect(metric.mode).toBe('full')
      expect(metric.fallbackClass).toBe('sprawling')
      expect(metric.payloadBytes).toBe(jsonPayloadBytes(body))
    }
  })

  it('records an unknown fallback class for foreign resources', async () => {
    await importDatabase({ characters: [] })
    const res = await getProjection('does-not-exist')
    expect(res.json().mode).toBe('full')

    const metric = latestProjectionMetric('does-not-exist')
    expect(metric.mode).toBe('full')
    expect(metric.fallbackClass).toBe('unknown')
  })

  it('records mode without a fallback class for narrowable resources', async () => {
    await importDatabase({ characters: [{ chaId: 'char-a', name: 'Ada', chats: [] }] })
    const res = await getProjection('character')
    expect(res.json().mode).toBe('fields')

    const metric = latestProjectionMetric('character')
    expect(metric.mode).toBe('fields')
    expect(metric.fallbackClass).toBeUndefined()
  })

  it('summarizes sprawling fallback payload sizes when RISU_PROJECTION_FULL_SUMMARY=1', async () => {
    await importDatabase({ characters: [], language: 'en' })
    capturedMetrics.length = 0

    const resources = ['settings', 'state', 'pluginStorage', 'does-not-exist']
    for (const resource of resources) {
      await getProjection(resource)
    }

    const fullFallbacks = capturedMetrics.filter(
      (entry) => entry.metric === 'projection_response' && entry.mode === 'full',
    )
    expect(fullFallbacks).toHaveLength(resources.length)

    if (process.env.RISU_PROJECTION_FULL_SUMMARY === '1') {
      console.log(
        JSON.stringify(
          fullFallbacks.map((entry) => ({
            resource: entry.resource,
            fallbackClass: entry.fallbackClass,
            payloadBytes: entry.payloadBytes,
          })),
          null,
          2,
        ),
      )
    }
  })
})
