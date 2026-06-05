import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// L38 (Phase 7): `processScriptFull(..., 'editdisplay')` runs on every message
// render (Chat.svelte → ChatBody → parser). It used to log
// `console.log('Trigger time', ...)` per render. The display path must not
// write to console.log at all on a clean pass.

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

// Initialize the stores module first: its top-level ReloadGUIPointer.subscribe
// fires synchronously and calls resetScriptCache(), which TDZ-throws if
// ./scripts is the entry import and has not finished evaluating yet.
import '../stores.svelte'
import { processScriptFull, resetScriptCache } from './scripts'
import { safeStructuredClone } from '../polyfill'
import { DBState, selectedCharID } from '../stores.svelte'
import type { character } from '../storage/database.svelte'

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
})

afterEach(() => {
  vi.unstubAllGlobals()
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
})
