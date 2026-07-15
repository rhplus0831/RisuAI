import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testDatabaseState } from './__tests__/resourceDatabaseState'

// Regression coverage: ordinary keydown matching must not mutate
// `testDatabaseState.db.hotkeys`, and hotkey settings edits must route through a
// server-backed settings patch instead of a raw resource write. Both throw
// under the read-only server resource guard otherwise.

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))
const changeCharMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'hotkey-command-token',
}))

vi.mock('./characters', () => ({
  changeChar: changeCharMock,
}))

// stores.svelte.ts installs a root $effect that calls moduleUpdate() whenever
// testDatabaseState.db changes; stub it so seeding the database does not trigger the
// module pipeline (and its circular-import init order) under test.
vi.mock('./process/modules', async (importActual) => {
  const actual = await importActual<typeof import('./process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import { adjacentCharacterIndex, changeToAdjacentCharacter, changeToPreset, hotkeyMatches } from './hotkey'
import { applyServerBackedSetting } from './server/settingsBridge.svelte'
import { settingsGroupForKey, clearCachedServerCommandRevision } from './server/commands'
import { setResourceWriteGuardEnabled } from './server/resourceWriteGuard.svelte'
import { selectedCharID } from './stores.svelte'

interface CapturedFetch {
  url: string
  method: string
  body: any
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({
        url,
        method: init.method ?? 'GET',
        body,
      })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url.startsWith('/api/v1/commands/settings/')) {
        return jsonResponse({
          revision: 11,
          event: { type: 'settings.patched', revision: 11, resource: 'settings' },
        })
      }
      if (url === '/api/v1/commands/model-presets/select') {
        return jsonResponse({
          revision: 11,
          event: { type: 'modelPreset.selected', revision: 11, resource: 'model-preset' },
          modelPresetId: 'model-second',
        })
      }
      if (url === '/api/v1/commands/chats/chat-a/generation-settings') {
        return jsonResponse({
          revision: 11,
          event: {
            type: 'chat.updated',
            revision: 11,
            resource: 'characterRow',
            id: 'chat-a',
            parentId: 'char-a',
          },
          chatId: 'chat-a',
          characterId: 'char-a',
          certificate: 'chat-generation-settings-sparse-v1',
          patchedKeys: Object.keys(body?.patch ?? {}).sort(),
          deletedKeys: [...(body?.deleteKeys ?? [])].sort(),
          sidebarTogglePatchedKeys: Object.keys(body?.patch?.sidebarToggles ?? {}).sort(),
          sidebarToggleDeletedKeys: [...(body?.sidebarToggleDeleteKeys ?? [])].sort(),
          prunedSidebarToggleKeys: [],
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForCommand(
  calls: CapturedFetch[],
  predicate: (call: CapturedFetch) => boolean,
): Promise<CapturedFetch> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const match = calls.find(predicate)
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`command not dispatched; saw: ${JSON.stringify(calls)}`)
}

function seedDatabase(): void {
  testDatabaseState.db = {
    hotkeys: [
      { key: 'a', action: 'home' },
      { key: 'r', ctrl: true, alt: true, action: 'reroll' },
    ],
    botPresets: [],
    modelPresets: [
      { id: 'model-default', name: 'Default Model' },
      { id: 'model-second', name: 'Second Model' },
    ],
    modelPresetsId: 0,
    promptPresets: [{ id: 'prompt-default', name: 'Default Prompt' }],
    promptPresetsId: 0,
  } as any
}

beforeEach(() => {
  changeCharMock.mockClear()
  platformState.isFastifyServer = true
  selectedCharID.set(-1)
  clearCachedServerCommandRevision()
  setResourceWriteGuardEnabled(false)
  seedDatabase()
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('hotkey handling under the resource guard', () => {
  it('finds adjacent characters at both ends of the alphabetized list', () => {
    const characters = [{ name: 'Charlie' }, { name: 'Alpha' }, { name: 'Bravo' }] as any

    expect(adjacentCharacterIndex(characters, 1, 'next')).toBe(2)
    expect(adjacentCharacterIndex(characters, 0, 'previous')).toBe(2)
    expect(adjacentCharacterIndex(characters, 1, 'previous')).toBeNull()
    expect(adjacentCharacterIndex(characters, 0, 'next')).toBeNull()
  })

  it('uses the normal character selection flow for adjacent-character hotkeys', async () => {
    testDatabaseState.db.characters = [
      { name: 'Charlie', chaId: 'char-c' },
      { name: 'Alpha', chaId: 'char-a' },
      { name: 'Bravo', chaId: 'char-b' },
    ] as any

    selectedCharID.set(1)
    await expect(changeToAdjacentCharacter('next')).resolves.toBe(true)
    expect(changeCharMock).toHaveBeenLastCalledWith(2)

    selectedCharID.set(0)
    await expect(changeToAdjacentCharacter('previous')).resolves.toBe(true)
    expect(changeCharMock).toHaveBeenLastCalledWith(2)

    selectedCharID.set(1)
    await expect(changeToAdjacentCharacter('previous')).resolves.toBe(false)
    expect(changeCharMock).toHaveBeenCalledTimes(2)
  })

  it('maps hotkeys to sidebar settings group', () => {
    expect(settingsGroupForKey('hotkeys')).toBe('sidebar')
  })

  it('matches hotkeys without mutating the read-only projection', () => {
    setResourceWriteGuardEnabled(true)

    // Baseline: the guard is active, so a raw resource write throws.
    expect(() => {
      ;(testDatabaseState.db.hotkeys[0] as any).ctrl = true
    }).toThrow()

    const hotkey = testDatabaseState.db.hotkeys[0]
    const event = new KeyboardEvent('keydown', { key: 'a' })

    // hotkeyMatches must not write default modifier fields back onto the entry.
    let matched = false
    expect(() => {
      matched = hotkeyMatches(hotkey, event)
    }).not.toThrow()
    expect(matched).toBe(true)
    // The entry is left untouched: no defaults were projected onto it.
    expect(hotkey.ctrl).toBeUndefined()
    expect(hotkey.alt).toBeUndefined()
    expect(hotkey.shift).toBeUndefined()
  })

  it('rejects mismatched modifiers without mutation', () => {
    setResourceWriteGuardEnabled(true)

    const hotkey = testDatabaseState.db.hotkeys[0]
    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true })

    expect(hotkeyMatches(hotkey, event)).toBe(false)
    expect(hotkey.ctrl).toBeUndefined()
  })

  it('routes numbered preset shortcuts to modern model presets on a fresh split database', async () => {
    const calls = stubCommandFetch()
    expect(testDatabaseState.db.botPresets).toEqual([])

    expect(changeToPreset(1)).toBe(true)
    expect(testDatabaseState.db.modelPresetsId).toBe(1)
    expect(changeToPreset(8)).toBe(false)

    const command = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/model-presets/select' && call.method === 'POST',
    )
    expect(command.body).toMatchObject({ modelPresetId: 'model-second' })
  })

  it('keeps Ctrl+1 functional when a fresh database has only its default modern preset', async () => {
    const calls = stubCommandFetch()
    testDatabaseState.db.modelPresets = [{ id: 'model-default', name: 'Default Model' }]
    testDatabaseState.db.modelPresetsId = 0

    expect(changeToPreset(0)).toBe(true)

    const command = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/model-presets/select' && call.method === 'POST',
    )
    expect(command.body).toMatchObject({ modelPresetId: 'model-default' })
  })

  it('switches the active chat generation model preset when the chat owns preset selection', async () => {
    const calls = stubCommandFetch()
    testDatabaseState.db.characters = [
      {
        chaId: 'char-a',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            generationSettings: {
              configured: true,
              personaId: 'persona-default',
              modelPresetId: 'model-default',
              promptPresetId: 'prompt-default',
              jailbreakToggle: false,
              sidebarToggles: {},
            },
          },
        ],
      },
    ] as any
    selectedCharID.set(0)

    expect(changeToPreset(1)).toBe(true)
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings.modelPresetId).toBe('model-second')
    expect(testDatabaseState.db.modelPresetsId).toBe(0)

    const command = await waitForCommand(calls, (call) => call.url.endsWith('/chat-a/generation-settings'))
    expect(command.body).toEqual({
      baseRevision: 10,
      baseGenerationSettingsDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      patch: { modelPresetId: 'model-second' },
    })
  })

  it('routes a hotkey settings edit through a sidebar settings patch', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    // Mirror HotkeySettings.svelte: build a fresh array and apply it.
    const next = testDatabaseState.db.hotkeys.map((hotkey, i) => (i === 0 ? { ...hotkey, ctrl: true } : { ...hotkey }))

    expect(() => applyServerBackedSetting('hotkeys', next)).not.toThrow()

    // Optimistic projection update is applied without throwing the guard.
    expect(testDatabaseState.db.hotkeys[0].ctrl).toBe(true)

    const patch = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/settings/sidebar' && call.method === 'PATCH',
    )
    expect(patch.body.patch.hotkeys).toBeDefined()
    expect(patch.body.patch.hotkeys[0].ctrl).toBe(true)
    expect(patch.body.patch.hotkeys[0].action).toBe('home')
  })
})
