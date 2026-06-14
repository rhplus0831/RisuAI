import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Regression coverage: trigger data effects that mutate durable character/persona
// state must route through typed commands instead of writing `DBState.db`
// directly, so they do not throw under the server-backed read-only projection
// guard.

vi.mock('../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../../storage/fastifyStorage', () => ({
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

function stubCommandFetch(options: { failPersonaPatch?: boolean } = {}): CapturedFetch[] {
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
        if (options.failPersonaPatch) {
          return jsonResponse({ error: 'persona patch failed' }, 500)
        }
        return jsonResponse({
          revision: 11,
          event: { type: 'persona.updated', revision: 11, resource: 'persona' },
        })
      }
      if (url.includes('/lorebooks')) {
        return jsonResponse({
          revision: 11,
          event: { type: 'lorebook.replaced', revision: 11, resource: 'lorebook' },
        })
      }
      if (url.startsWith('/api/v1/commands/chats/')) {
        return jsonResponse({
          revision: 11,
          event: { type: 'chat.updated', revision: 11, resource: 'chat' },
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
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
        chats: [{ id: 'chat-1', message: [], note: '', name: 'main', localLore: [], scriptstate: {} }],
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
  it('keeps readonly display trigger rows immutable while attaching low-level metadata', async () => {
    const trigger = Object.freeze({
      comment: 'readonly display',
      type: 'display',
      conditions: [],
      effect: [],
    })
    const char = characterWithTriggers([trigger])

    await expect(
      runTrigger(char, 'display', {
        chat: char.chats[char.chatPage],
        displayMode: true,
        displayData: 'shown',
      }),
    ).resolves.toMatchObject({ displayData: 'shown' })

    expect('lowLevelAccess' in trigger).toBe(false)
  })

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
    expect(patch.body.mirrorLegacyProfile).toBe(true)
  })

  it('rolls back v2SetPersonaDesc optimism when the persona command fails', async () => {
    DBState.db.personaPrompt = 'legacy prompt before trigger'
    DBState.db.personas[0].personaPrompt = 'saved prompt before trigger'
    const selectedPersona = DBState.db.selectedPersona
    const calls = stubCommandFetch({ failPersonaPatch: true })
    setServerProjectionWriteGuardEnabled(true)

    // Baseline: the guard is active, so a raw legacy prompt write throws.
    expect(() => {
      DBState.db.personaPrompt = 'raw prompt'
    }).toThrow()

    const char = characterWithTriggers([
      {
        comment: 'persona-fail',
        type: 'manual',
        conditions: [],
        effect: [{ type: 'v2SetPersonaDesc', valueType: 'value', value: 'trigger prompt' }],
      },
    ])

    await expect(
      runTrigger(char, 'manual', { chat: char.chats[char.chatPage], manualName: 'persona-fail' }),
    ).resolves.not.toThrow()

    const patch = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/personas/persona-a' && call.method === 'PATCH',
    )
    expect(patch.body.patch.personaPrompt).toBe('trigger prompt')
    expect(patch.body.mirrorLegacyProfile).toBe(true)

    await waitFor(
      () =>
        DBState.db.personaPrompt === 'legacy prompt before trigger' &&
        DBState.db.personas[selectedPersona]?.personaPrompt === 'saved prompt before trigger',
    )

    expect(DBState.db.personaPrompt).toBe('legacy prompt before trigger')
    expect(DBState.db.personas[selectedPersona]?.personaPrompt).toBe('saved prompt before trigger')
  })

  it('routes v2ModifyLorebook through a lorebook command instead of a guarded direct write', async () => {
    DBState.db.characters[0].globalLore = [['lore-key', 'old content']] as any
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    const char = characterWithTriggers([
      {
        comment: 'lore',
        type: 'manual',
        conditions: [],
        effect: [
          {
            type: 'v2ModifyLorebook',
            targetType: 'value',
            target: 'lore-key',
            valueType: 'value',
            value: 'new content',
          },
        ],
      },
    ])
    char.globalLore = [['lore-key', 'old content']] as any

    await expect(
      runTrigger(char, 'manual', { chat: char.chats[char.chatPage], manualName: 'lore' }),
    ).resolves.not.toThrow()

    const cmd = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/characters/char-a/lorebooks' && call.method === 'PUT',
    )
    expect(cmd.body.entries).toBeDefined()
  })

  it('routes v2CreateLorebook through a lorebook command instead of a guarded direct write', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    const char = characterWithTriggers([
      {
        comment: 'create-lore',
        type: 'manual',
        conditions: [],
        effect: [
          {
            type: 'v2CreateLorebook',
            nameType: 'value',
            name: 'new-lore',
            keyType: 'value',
            key: 'my-key',
            contentType: 'value',
            content: 'my-content',
            insertOrderType: 'value',
            insertOrder: '100',
          },
        ],
      },
    ])

    await expect(
      runTrigger(char, 'manual', { chat: char.chats[char.chatPage], manualName: 'create-lore' }),
    ).resolves.not.toThrow()

    const cmd = await waitForCommand(
      calls,
      (call) =>
        /\/api\/v1\/commands\/characters\/char-a\/lorebooks\/entries\/[^/]+$/.test(call.url) && call.method === 'PUT',
    )
    expect(cmd.body.entry).toMatchObject({
      key: 'my-key',
      comment: 'new-lore',
      content: 'my-content',
    })
  })

  it('routes v2DeleteLorebookByIndex through a lorebook command instead of a guarded direct write', async () => {
    DBState.db.characters[0].globalLore = [
      { key: 'k', comment: 'entry', content: 'c', mode: 'normal', insertorder: 100 },
    ] as any
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    const char = characterWithTriggers([
      {
        comment: 'delete-lore',
        type: 'manual',
        conditions: [],
        effect: [
          {
            type: 'v2DeleteLorebookByIndex',
            indexType: 'value',
            index: '0',
          },
        ],
      },
    ])
    char.globalLore = [{ key: 'k', comment: 'entry', content: 'c', mode: 'normal', insertorder: 100 }] as any

    await expect(
      runTrigger(char, 'manual', { chat: char.chats[char.chatPage], manualName: 'delete-lore' }),
    ).resolves.not.toThrow()

    const cmd = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/characters/char-a/lorebooks' && call.method === 'PUT',
    )
    expect(cmd.body.entries).toBeDefined()
    expect(cmd.body.entries.length).toBe(0)
  })

  it('routes v2SetLorebookAlwaysActive through a lorebook command instead of a guarded direct write', async () => {
    DBState.db.characters[0].globalLore = [
      { key: 'k', comment: 'entry', content: 'c', mode: 'normal', insertorder: 100, alwaysActive: false },
    ] as any
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    const char = characterWithTriggers([
      {
        comment: 'always-active',
        type: 'manual',
        conditions: [],
        effect: [
          {
            type: 'v2SetLorebookAlwaysActive',
            indexType: 'value',
            index: '0',
            value: true,
          },
        ],
      },
    ])
    char.globalLore = [
      { key: 'k', comment: 'entry', content: 'c', mode: 'normal', insertorder: 100, alwaysActive: false },
    ] as any

    await expect(
      runTrigger(char, 'manual', {
        chat: char.chats[char.chatPage],
        manualName: 'always-active',
      }),
    ).resolves.not.toThrow()

    const cmd = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/characters/char-a/lorebooks' && call.method === 'PUT',
    )
    expect(cmd.body.entries).toBeDefined()
  })

  it('routes v2SetAuthorNote through a chat command instead of a guarded direct write', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    const char = characterWithTriggers([
      {
        comment: 'note',
        type: 'manual',
        conditions: [],
        effect: [{ type: 'v2SetAuthorNote', valueType: 'value', value: 'author note text' }],
      },
    ])

    await expect(
      runTrigger(char, 'manual', { chat: char.chats[char.chatPage], manualName: 'note' }),
    ).resolves.not.toThrow()

    const cmd = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1' && call.method === 'PATCH',
    )
    expect(cmd.body.patch.note).toBe('author note text')
  })

  it('routes v2SetVar scriptstate through a chat command instead of a guarded direct write', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    // Baseline: the guard is active, so a raw scriptstate projection write throws.
    expect(() => {
      DBState.db.characters[0].chats[0].scriptstate = { $raw: '1' } as never
    }).toThrow()

    const char = characterWithTriggers([
      {
        comment: 'set',
        type: 'manual',
        conditions: [],
        effect: [{ type: 'v2SetVar', var: 'score', operator: '=', valueType: 'value', value: '7' }],
      },
    ])

    // The fix: setVar's optimistic live write goes through the projection guard, so
    // the pass resolves instead of throwing on the read-only projection.
    await expect(
      runTrigger(char, 'manual', { chat: char.chats[char.chatPage], manualName: 'set' }),
    ).resolves.not.toThrow()

    // The optimistic write landed on the live active chat's scriptstate.
    expect((DBState.db.characters[0].chats[0].scriptstate as any).$score).toBe('7')

    // ...and the scriptstate patch was dispatched to the chat scriptstate command.
    const cmd = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1/scriptstate' && call.method === 'PATCH',
    )
    expect(cmd.body.patch.$score).toBe('7')
  })
})

describe('Phase 2 trigger lorebook scoped rollback', () => {
  it('restores only the one character globalLore when the lorebook command fails', async () => {
    // two characters with distinct globalLore; a whole-array rollback would clone
    // and re-write both, the scoped rollback touches only the edited character.
    selectedCharID.set(0)
    DBState.db = {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chatPage: 0,
          chats: [{ id: 'chat-1', message: [], note: '', name: 'main', localLore: [], scriptstate: {} }],
          triggerscript: [],
          globalLore: [['k', 'old content']],
          type: 'character',
        },
        {
          chaId: 'char-b',
          name: 'B',
          chatPage: 0,
          chats: [],
          triggerscript: [],
          globalLore: [['sib', 'sibling content']],
          type: 'character',
        },
      ],
      characterOrder: [],
    } as any

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
        if (url.includes('/lorebooks')) return jsonResponse({ error: 'nope' }, 500)
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setServerProjectionWriteGuardEnabled(true)

    const char = characterWithTriggers([
      {
        comment: 'lore',
        type: 'manual',
        conditions: [],
        effect: [
          {
            type: 'v2ModifyLorebook',
            targetType: 'value',
            target: 'k',
            valueType: 'value',
            value: 'new content',
          },
        ],
      },
    ])
    char.globalLore = [['k', 'old content']] as any

    await expect(
      runTrigger(char, 'manual', { chat: char.chats[char.chatPage], manualName: 'lore' }),
    ).resolves.not.toThrow()

    // the optimistic edit is applied to the selected character's row
    expect((DBState.db.characters[0].globalLore as any)[0][1]).toBe('new content')

    // the lorebook PUT fires then fails, restoring only char-a's globalLore
    await waitForCommand(calls, (c) => c.url.includes('/lorebooks') && c.method === 'PUT')
    await waitFor(() => (DBState.db.characters[0].globalLore as any)?.[0]?.[1] === 'old content')

    expect((DBState.db.characters[0].globalLore as any)[0][1]).toBe('old content')
    // the sibling character's lorebook was never part of the scoped rollback
    expect((DBState.db.characters[1].globalLore as any)[0][1]).toBe('sibling content')
  })
})
