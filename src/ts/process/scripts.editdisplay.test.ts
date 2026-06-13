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
import { DBState, selectedCharID } from '../stores.svelte'
import type { character } from '../storage/database.svelte'
import { setServerProjectionWriteGuardEnabled } from '../server/projectionWriteGuard.svelte'

function seedDb(): character {
  selectedCharID.set(0)
  DBState.db = {
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        desc: '',
        chatPage: 0,
        chats: [
          {
            id: 'chat-1',
            message: [{ role: 'char', data: 'rendered body', chatId: 'm-0' }],
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
  return DBState.db.characters[0] as unknown as character
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).safeStructuredClone = safeStructuredClone
  resetScriptCache()
  setServerProjectionWriteGuardEnabled(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
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
      DBState.db.characters[0].chats[0].message[0].data = 'raw'
    }).toThrow(/read-only server projection/)

    const result = await processScriptFull(char, 'keep REMOVE after', 'editdisplay', 0)

    expect(result.data).toBe('keep  after')
    expect(DBState.db.characters[0].chats[0].message[0].data).toBe('keep REMOVE after')
  })

  it('skips missing and malformed regex script entries during edit-display processing', async () => {
    const char = seedDb()
    ;(DBState.db as any).presetRegex = [undefined]
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

  it('treats absent character regex scripts as an empty script list', async () => {
    const char = seedDb()
    ;(char as any).customscript = undefined
    ;(DBState.db as any).presetRegex = undefined

    const result = await processScriptFull(char, 'rendered body', 'editdisplay', 0)

    expect(result.data).toBe('rendered body')
  })
})
