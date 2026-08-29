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
import { setResourceWriteGuardEnabled } from '../server/resourceWriteGuard.svelte'
import { clearCachedServerCommandRevision } from '../server/commands'
import { setClientRegexWorkerFactoryForTesting } from './clientRegexWorker'
import { CLIENT_REGEX_LIMITS, executeRegexWorkerRequest, type RegexWorkerRequest } from './regexWorkerRuntime'

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

function stubCommandFetch(options: { failMessagePatch?: boolean } = {}): CapturedFetch[] {
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
        if (options.failMessagePatch) return jsonResponse({ error: 'message patch failed' }, 500)
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
  setResourceWriteGuardEnabled(false)
  setClientRegexWorkerFactoryForTesting(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearCachedServerCommandRevision()
  setResourceWriteGuardEnabled(false)
  setClientRegexWorkerFactoryForTesting(null)
  selectedCharID.set(-1)
})

class FakeRegexWorker {
  readonly messageListeners: Array<(event: MessageEvent<unknown>) => void> = []
  readonly errorListeners: Array<(event: ErrorEvent) => void> = []
  terminated = false

  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent<unknown> & ErrorEvent) => void): void {
    if (type === 'message') this.messageListeners.push(listener)
    else this.errorListeners.push(listener)
  }

  postMessage(message: unknown): void {
    const envelope = message as { id: number; request: RegexWorkerRequest }
    queueMicrotask(() => {
      if (this.terminated) return
      try {
        const result = executeRegexWorkerRequest(envelope.request)
        for (const listener of this.messageListeners) {
          listener({ data: { id: envelope.id, ok: true, result } } as MessageEvent<unknown>)
        }
      } catch (error) {
        for (const listener of this.messageListeners) {
          listener({
            data: {
              id: envelope.id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            },
          } as MessageEvent<unknown>)
        }
      }
    })
  }

  terminate(): void {
    this.terminated = true
  }
}

class HangingRegexWorker extends FakeRegexWorker {
  override postMessage(): void {}
}

describe('editdisplay render path logging', () => {
  it('preserves native replacement semantics across the regex worker boundary', async () => {
    const worker = new FakeRegexWorker()
    setClientRegexWorkerFactoryForTesting(() => worker)
    const char = seedDb()
    char.customscript = [
      {
        comment: 'worker replacement parity',
        type: 'editdisplay',
        in: '(a)(b)',
        out: '[$2$1][$&][$$]',
        flag: 'g',
        ableFlag: true,
      },
    ] as any

    await expect(processScriptFull(char, 'ab ab', 'editdisplay', 0)).resolves.toMatchObject({
      data: '[ba][ab][$] [ba][ab][$]',
    })
    expect(worker.terminated).toBe(false)
  })

  it('terminates a non-responsive regex worker at the configured display timeout', async () => {
    const worker = new HangingRegexWorker()
    setClientRegexWorkerFactoryForTesting(() => worker)
    const char = seedDb()
    ;(testDatabaseState.db as any).complexRegexDisplayTimeoutMs = 5
    char.customscript = [
      {
        comment: 'catastrophic worker regex',
        type: 'editdisplay',
        in: '(a+)+$',
        out: 'blocked',
        flag: 'g',
        ableFlag: true,
      },
    ] as any
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(processScriptFull(char, `${'a'.repeat(256)}!`, 'editdisplay', 0)).resolves.toMatchObject({
        data: `${'a'.repeat(256)}!`,
      })
      expect(worker.terminated).toBe(true)
      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('timed out') }))
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('preflights replacement and move amplification inside the regex worker runtime', () => {
    expect(CLIENT_REGEX_LIMITS).toMatchObject({ replacement: 16 * 1024 * 1024, output: 16 * 1024 * 1024 })
    const sizeLimit = 128 * 1024
    const replacement = 'x'.repeat(sizeLimit)
    expect(() =>
      executeRegexWorkerRequest({
        operation: 'replace',
        pattern: '(a)',
        flags: 'g',
        source: 'a a a a',
        replacement,
        sizeLimit,
      }),
    ).toThrow(/output length .* exceeds cap 131072/)

    expect(() =>
      executeRegexWorkerRequest({
        operation: 'testMove',
        pattern: '(a)',
        flags: 'g',
        source: 'a a a a',
        replacement: `@@move_bottom ${'x'.repeat(sizeLimit - '@@move_bottom '.length)}`,
        toTop: false,
        sizeLimit,
      }),
    ).toThrow(/output length .* exceeds cap 131072/)
  })

  it('allows browser regex OUT values above the former 128 KiB ceiling by default', () => {
    const replacement = 'x'.repeat(256 * 1024)

    expect(
      executeRegexWorkerRequest({
        operation: 'replace',
        pattern: 'a',
        flags: 'g',
        source: 'a',
        replacement,
      }),
    ).toEqual({ operation: 'replace', result: replacement })
  })

  it('a display-trigger render pass writes nothing to console.log', async () => {
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

  it('@@inject display action runs under the resource guard without durable persistence', async () => {
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
    setResourceWriteGuardEnabled(true)
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

  it('does not reuse script output across delimiter-shaped definition identities', async () => {
    const char = seedDb()
    char.customscript = [
      {
        comment: 'whole delimiter pattern',
        type: 'editprocess',
        in: 'x|||y',
        out: 'A',
        flag: 'g',
        ableFlag: true,
      },
    ] as any

    const first = await processScriptFull(char, 'x|||y', 'editprocess')

    char.customscript = [
      {
        comment: 'prefix pattern',
        type: 'editprocess',
        in: 'x',
        out: 'y|||A',
        flag: 'g',
        ableFlag: true,
      },
    ] as any

    expect(first.data).not.toBe('y|||A|||y')
    await expect(processScriptFull(char, 'x|||y', 'editprocess')).resolves.toMatchObject({ data: 'y|||A|||y' })
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
    setResourceWriteGuardEnabled(true)

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

  it('rolls back a failed server-mode @@inject projection update', async () => {
    const calls = stubCommandFetch({ failMessagePatch: true })
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
    setResourceWriteGuardEnabled(true)

    const result = await processScriptFull(char, 'keep REMOVE after', 'editprocess', 0)

    expect(result.data).toBe('keep  after')
    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(testDatabaseState.db.characters[0].chats[0].message[0].data).toBe('rendered body')
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
    setResourceWriteGuardEnabled(true)

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

  it('runs global regex in addition to the active prompt preset', async () => {
    const char = seedDb()
    ;(testDatabaseState.db as any).globalscript = [
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

    expect(result.data).toBe('chat global')
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
