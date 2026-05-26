import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Regression coverage for the Phase 9 projection-guard audit: trigger data
// effects that mutate durable character/persona state must route through
// typed commands instead of writing `DBState.db` directly, so they do not
// throw under the server-backed read-only projection guard.

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

vi.mock('../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('../../storage/nodeStorage', () => ({
  getNodeServerProxyAuth: async () => 'trigger-command-token',
}))

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import { safeStructuredClone } from '../../polyfill'
import { runTrigger } from '../triggers'
import { clearCachedServerCommandRevision } from '../../server/commands'
import { setServerProjectionWriteGuardEnabled } from '../../server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import type { character } from '../../storage/database.svelte'

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
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url.startsWith('/api/v1/commands/characters/')) {
        return jsonResponse({
          revision: 11,
          event: { type: 'character.updated', revision: 11, resource: 'character' },
        })
      }
      if (url.startsWith('/api/v1/commands/personas/')) {
        return jsonResponse({
          revision: 11,
          event: { type: 'persona.updated', revision: 11, resource: 'persona' },
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
  selectedCharID.set(0)
  DBState.db = {
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        desc: '',
        chatPage: 0,
        chats: [{ message: [], note: '', name: 'main', localLore: [], scriptstate: {} }],
        triggerscript: [],
        defaultVariables: '',
        globalLore: [],
        type: 'character',
      },
    ],
    characterOrder: [],
    templateDefaultVariables: '',
    selectedPersona: 0,
    personas: [{ id: 'persona-a', name: 'Persona', personaPrompt: '', icon: '', note: '' }],
    personaPrompt: '',
    username: 'Persona',
    userIcon: '',
    userNote: '',
  } as any
}

function characterWithTriggers(triggerscript: unknown[]): character {
  return { ...DBState.db.characters[0], triggerscript } as unknown as character
}

beforeEach(() => {
  platformState.isFastifyServer = true
  // Re-establish the global the SPA bootstrap installs; afterEach's
  // vi.unstubAllGlobals() clears it between tests.
  ;(globalThis as Record<string, unknown>).safeStructuredClone = safeStructuredClone
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  seedDatabase()
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('trigger durable writes under the projection guard', () => {
  it('routes v2SetCharacterDesc through a character command instead of a guarded direct write', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    // Baseline: the guard is active, so a raw projection write throws.
    expect(() => {
      DBState.db.characters[0].desc = 'raw'
    }).toThrow()

    const char = characterWithTriggers([
      {
        comment: 'desc',
        type: 'manual',
        conditions: [],
        effect: [{ type: 'v2SetCharacterDesc', valueType: 'value', value: 'updated desc' }],
      },
    ])

    await expect(
      runTrigger(char, 'manual', { chat: char.chats[char.chatPage], manualName: 'desc' }),
    ).resolves.not.toThrow()

    const patch = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/characters/char-a' && call.method === 'PATCH',
    )
    expect(patch.body.patch.desc).toBe('updated desc')
  })

  it('routes v2SetPersonaDesc through a persona command instead of a guarded direct write', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    const char = characterWithTriggers([
      {
        comment: 'persona',
        type: 'manual',
        conditions: [],
        effect: [{ type: 'v2SetPersonaDesc', valueType: 'value', value: 'persona prompt' }],
      },
    ])

    await expect(
      runTrigger(char, 'manual', { chat: char.chats[char.chatPage], manualName: 'persona' }),
    ).resolves.not.toThrow()

    const patch = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/personas/persona-a' && call.method === 'PATCH',
    )
    expect(patch.body.patch.personaPrompt).toBe('persona prompt')
  })
})
