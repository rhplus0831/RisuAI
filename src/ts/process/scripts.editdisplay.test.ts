import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Edit-display script rendering must stay silent on console.log.

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'editdisplay-token',
}))

vi.mock('./modules', async (importActual) => {
  const actual = await importActual<typeof import('./modules')>()
  return {
    ...actual,
    getModuleTriggers: () => [],
    getModuleRegexScripts: () => [],
    moduleUpdate: () => {},
  }
})

// Initialize the shared stores before importing the script processing helpers.
import '../stores.svelte'
import { processScriptFull, resetScriptCache } from './scripts'
import { safeStructuredClone } from '../polyfill'
import { selectedCharID } from '../stores.svelte'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'
import type { character } from '../storage/database.svelte'
import { setServerProjectionWriteGuardEnabled } from '../server/projectionWriteGuard.svelte'
import { clearCachedServerCommandRevision } from '../server/commands'

interface CapturedFetch {
  url: string
  method: string
  body: unknown
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
      if (url === '/api/v1/commands/messages/m-0') {
        return jsonResponse({
          revision: 11,
          event: { type: 'message.updated', revision: 11, resource: 'message', id: 'm-0', parentId: 'chat-1' },
          chatId: 'chat-1',
          messageId: 'm-0',
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForCallCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(expected)
}

function seedDb(messageChatId: string | null = 'm-0'): character {
  selectedCharID.set(0)
  const message = {
    role: 'char',
    data: 'rendered body',
    ...(messageChatId !== null ? { chatId: messageChatId } : {}),
  }
  testDatabaseState.db = {
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        desc: '',
        chatPage: 0,
        chats: [
          {
            id: 'chat-1',
            message: [message],
            note: '',
            name: 'main',
            localLore: [],
            scriptstate: {},
          },
        ],
        triggerscript: [
          {
            comment: 'display-pass',
            type: 'display',
            conditions: [],
            effect: [
              {
                type: 'v2SetVar',
                var: 'displayTouched',
                operator: '=',
                valueType: 'value',
                value: '1',
              },
            ],
          },
        ],
        customscript: [],
        defaultVariables: '',
        globalLore: [],
        type: 'character',
      },
    ],
    characterOrder: [],
    presetRegex: [],
    templateDefaultVariables: '',
  } as any
  return testDatabaseState.db.characters[0] as unknown as character
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).safeStructuredClone = safeStructuredClone
  clearCachedServerCommandRevision()
  resetScriptCache()
  setServerProjectionWriteGuardEnabled(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(-1)
})

describe('editdisplay render path logging (L38)', () => {
  it('L38: a display-trigger render pass writes nothing to console.log', async () => {
    const char = seedDb()
    const logSpy = vi.spyOn(console, 'log')

    try {
      const result = await processScriptFull(char, 'rendered body', 'editdisplay', 0)
      // The display pass actually ran (trigger machinery engaged), and the
      // render path stayed silent — no per-render 'Trigger time' logging.
      expect(result.data).toBe('rendered body')
      expect(logSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
    }
  })

  it('I20: @@inject display action runs under the projection guard without durable persistence', async () => {
    const char = seedDb()
    char.customscript = [
      {
        comment: 'inject-display-only',
        type: 'editdisplay',
        in: 'REMOVE',
        out: '@@inject',
        flag: 'g',
        ableFlag: true,
      },
    ] as any
    setServerProjectionWriteGuardEnabled(true)
    expect(() => {
      testDatabaseState.db.characters[0].chats[0].message[0].data = 'raw'
    }).toThrow(/resource database compatibility view is read-only/)

    const result = await processScriptFull(char, 'keep REMOVE after', 'editdisplay', 0)

    expect(result.data).toBe('keep  after')
    expect(testDatabaseState.db.characters[0].chats[0].message[0].data).toBe('rendered body')
  })

  it('does not reuse editdisplay script cache across chat variable changes', async () => {
    const char = seedDb()
    const chat = testDatabaseState.db.characters[0].chats[0]
    chat.scriptstate = { $choice: 'first' }
    char.customscript = [
      {
        comment: 'variable-display',
        type: 'editdisplay',
        in: 'CHOICE',
        out: '{{getvar::choice}}',
        flag: 'g',
        ableFlag: true,
      },
    ] as any

    await expect(processScriptFull(char, 'CHOICE', 'editdisplay', -1)).resolves.toMatchObject({ data: 'first' })
    chat.scriptstate = { $choice: 'second' }
    await expect(processScriptFull(char, 'CHOICE', 'editdisplay', -1)).resolves.toMatchObject({ data: 'second' })
  })

  it('server-mode non-display @@inject optimistically updates and dispatches a message patch', async () => {
    const calls = stubCommandFetch()
    const char = seedDb()
    char.customscript = [
      {
        comment: 'inject-process-command',
        type: 'editprocess',
        in: 'REMOVE',
        out: '@@inject',
        flag: 'g',
        ableFlag: true,
      },
    ] as any
    setServerProjectionWriteGuardEnabled(true)

    const result = await processScriptFull(char, 'keep REMOVE after', 'editprocess', 0)

    expect(result.data).toBe('keep  after')
    expect(testDatabaseState.db.characters[0].chats[0].message[0].data).toBe('keep REMOVE after')
    await waitForCallCount(calls, 2)
    expect(calls.map((call) => call.url)).toEqual(['/api/v1/bootstrap', '/api/v1/commands/messages/m-0'])
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/messages/m-0',
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: { data: 'keep REMOVE after' },
      },
    })
  })

  it('server-mode non-display @@inject without a message id strips display data without a projection write', async () => {
    const calls = stubCommandFetch()
    const char = seedDb(null)
    char.customscript = [
      {
        comment: 'inject-process-no-message-id',
        type: 'editprocess',
        in: 'REMOVE',
        out: '@@inject',
        flag: 'g',
        ableFlag: true,
      },
    ] as any
    setServerProjectionWriteGuardEnabled(true)

    const result = await processScriptFull(char, 'keep REMOVE after', 'editprocess', 0)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(result.data).toBe('keep  after')
    expect(testDatabaseState.db.characters[0].chats[0].message[0].data).toBe('rendered body')
    expect(calls).toHaveLength(0)
  })

  it('skips missing and malformed regex script entries during edit-display processing', async () => {
    const char = seedDb()
    ;(testDatabaseState.db as any).presetRegex = [undefined]
    char.customscript = [
      undefined,
      null,
      { comment: 'missing type', in: 'ignored', out: 'ignored' },
      {
        comment: 'valid-display-script',
        type: 'editdisplay',
        in: 'body',
        out: 'BODY',
        flag: 'g',
        ableFlag: true,
      },
    ] as any

    const result = await processScriptFull(char, 'rendered body', 'editdisplay', 0)

    expect(result.data).toBe('rendered BODY')
  })

  it('uses regex from the active chat selected prompt preset', async () => {
    const char = seedDb()
    ;(testDatabaseState.db as any).presetRegex = [
      {
        comment: 'global-regex',
        type: 'editdisplay',
        in: 'GLOBAL',
        out: 'global',
        flag: 'g',
        ableFlag: true,
      },
    ]
    ;(testDatabaseState.db as any).promptPresets = [
      {
        id: 'chat-preset',
        presetRegex: [
          {
            comment: 'chat-preset-regex',
            type: 'editdisplay',
            in: 'CHAT',
            out: 'chat',
            flag: 'g',
            ableFlag: true,
          },
        ],
      },
    ]
    ;(testDatabaseState.db.characters[0].chats[0] as any).generationSettings = {
      promptPresetId: 'chat-preset',
    }

    const result = await processScriptFull(char, 'CHAT GLOBAL', 'editdisplay', 0)

    expect(result.data).toBe('chat GLOBAL')
  })

  it('does not fall back to global regex when the active chat selected prompt has none', async () => {
    const char = seedDb()
    ;(testDatabaseState.db as any).presetRegex = [
      {
        comment: 'global-regex',
        type: 'editdisplay',
        in: 'GLOBAL',
        out: 'global',
        flag: 'g',
        ableFlag: true,
      },
    ]
    ;(testDatabaseState.db as any).promptPresets = [{ id: 'plain-preset' }]
    ;(testDatabaseState.db.characters[0].chats[0] as any).generationSettings = {
      promptPresetId: 'plain-preset',
    }

    const result = await processScriptFull(char, 'CHAT GLOBAL', 'editdisplay', 0)

    expect(result.data).toBe('CHAT GLOBAL')
  })

  it('treats absent character regex scripts as an empty script list', async () => {
    const char = seedDb()
    ;(char as any).customscript = undefined
    ;(testDatabaseState.db as any).presetRegex = undefined

    const result = await processScriptFull(char, 'rendered body', 'editdisplay', 0)

    expect(result.data).toBe('rendered body')
  })
})
