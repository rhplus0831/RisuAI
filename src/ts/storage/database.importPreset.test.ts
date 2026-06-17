import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Importing presets must not write decoded payloads to console.log.

vi.mock('./fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'preset-import-token',
}))

// The stores.svelte $effect fires moduleUpdate when DBState.db is seeded;
// neutralize it so the import-order TDZ between modules.ts and this module
// graph cannot crash the run (same pattern as command.projectionGuard.test.ts).
vi.mock('../process/modules', async (importActual) => {
  const actual = await importActual<typeof import('../process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import * as fflate from 'fflate'
import { encode as encodeMsgpack } from 'msgpackr/index-no-eval'
import { encryptBuffer } from '../util'
import { importPreset, presetTemplate } from './database.svelte'
import { clearCachedServerCommandRevision } from '../server/commands'
import { setServerProjectionWriteGuardEnabled } from '../server/projectionWriteGuard.svelte'
import { DBState } from '../stores.svelte'

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

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
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
      if (url === '/api/v1/commands/prompt-presets/import') {
        return jsonResponse({
          revision: 11,
          event: { type: 'preset.imported', revision: 11, resource: 'preset' },
          presetId: 'preset-imported',
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

function stubFailedImportCommandFetch(onCommand?: (call: CapturedFetch) => void): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const call = {
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      }
      calls.push(call)
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 20 })
      if (url === '/api/v1/commands/prompt-presets/import') {
        onCommand?.(call)
        return jsonResponse({ error: 'forced import failure' }, 500)
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForImportCommand(calls: CapturedFetch[]): Promise<CapturedFetch> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const match = calls.find((call) => call.url === '/api/v1/commands/prompt-presets/import' && call.method === 'POST')
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`import command not dispatched; saw: ${JSON.stringify(calls)}`)
}

async function waitForState(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  throw lastError
}

/** A binary `.risupreset` file, built exactly like `downloadPreset` builds it. */
async function buildRisupresetFile(preset: Record<string, unknown>): Promise<Uint8Array> {
  return fflate.compressSync(
    encodeMsgpack({
      presetVersion: 2,
      type: 'preset',
      preset: await encryptBuffer(encodeMsgpack(preset), 'risupreset'),
    }),
  )
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = {
    promptPresets: [],
    promptPresetsId: -1,
  } as any
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('importPreset warm-path logging (L37)', () => {
  it('L37: a .risupreset binary import logs nothing to console.log', async () => {
    const calls = stubCommandFetch()
    const file = await buildRisupresetFile({ name: 'Risup Roundtrip', temperature: 42 })
    const logSpy = vi.spyOn(console, 'log')

    try {
      await importPreset({ name: 'roundtrip.risupreset', data: file })

      // The decoded envelope and preset really landed (non-vacuous)...
      const imported = DBState.db.promptPresets[DBState.db.promptPresets.length - 1]
      expect(imported).toMatchObject({ name: 'Risup Roundtrip', temperature: 42 })
      const cmd = await waitForImportCommand(calls)
      expect(cmd.body.preset).toMatchObject({ name: 'Risup Roundtrip', temperature: 42 })
      // ...without the former `console.log(decoded)` dump.
      expect(logSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
    }
  })

  it('L37: an ST/json preset import logs nothing to console.log, unknown and missing prompts included', async () => {
    const calls = stubCommandFetch()
    // Exercises all three former JSON-side log sites: the parsed `pre` dump,
    // the default-case `console.log(p)` for an unknown identifier, and the
    // `'Prompt not found'` dump for an order entry with no matching prompt.
    const stPreset = {
      temperature: 0.7,
      frequency_penalty: 0.5,
      presence_penalty: 0.5,
      top_p: 0.9,
      prompt_order: [
        {
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'customExtra', enabled: true },
            { identifier: 'ghostPrompt', enabled: true },
            { identifier: 'chatHistory', enabled: true },
          ],
        },
      ],
      prompts: [
        { identifier: 'main', content: 'You are a helper.', role: 'system' },
        { identifier: 'customExtra', content: 'Extra custom text.', role: 'system' },
        { identifier: 'chatHistory' },
      ],
    }
    const file = new TextEncoder().encode(JSON.stringify(stPreset))
    const logSpy = vi.spyOn(console, 'log')

    try {
      await importPreset({ name: 'st_preset.json', data: file })

      // The mapped preset really landed (non-vacuous): main + unknown-default
      // rows kept their text, the missing prompt contributed nothing.
      const imported = DBState.db.promptPresets[DBState.db.promptPresets.length - 1] as any
      expect(imported.name).toBe('Imported ST Preset')
      const texts = imported.promptTemplate
        .filter((row: any) => typeof row.text === 'string')
        .map((row: any) => row.text)
      expect(texts).toEqual(['You are a helper.', 'Extra custom text.'])
      expect(imported.promptTemplate.some((row: any) => row.type === 'chat')).toBe(true)
      await waitForImportCommand(calls)
      // ...without any of the former preset-object dumps.
      expect(logSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
    }
  })

  it('L21: a failed preset import removes only the unchanged imported row', async () => {
    DBState.db.promptPresets = [
      {
        ...clonePlain(presetTemplate),
        id: 'preset-existing',
        name: 'Existing',
        temperature: 33,
      },
      {
        ...clonePlain(presetTemplate),
        id: 'preset-sibling',
        name: 'Sibling',
        temperature: 44,
      },
    ]
    DBState.db.promptPresetsId = 0
    const beforeSelected = DBState.db.promptPresetsId
    const calls = stubFailedImportCommandFetch(() => {
      DBState.db.promptPresets[1] = {
        ...DBState.db.promptPresets[1],
        name: 'Sibling edited after dispatch',
      }
      DBState.db.promptPresets.push({
        ...clonePlain(presetTemplate),
        id: 'preset-appended',
        name: 'Appended after dispatch',
      })
    })
    const file = new TextEncoder().encode(JSON.stringify({ name: 'Import Will Roll Back', temperature: 66 }))

    await importPreset({ name: 'plain-preset.json', data: file })

    expect(DBState.db.promptPresets.map((preset) => preset.name)).toContain('Import Will Roll Back')
    await waitForImportCommand(calls)
    await waitForState(() => {
      expect(DBState.db.promptPresets.map((preset) => preset.id)).toEqual([
        'preset-existing',
        'preset-sibling',
        'preset-appended',
      ])
      expect(DBState.db.promptPresets[1]).toMatchObject({ name: 'Sibling edited after dispatch' })
      expect(DBState.db.promptPresets[2]).toMatchObject({ name: 'Appended after dispatch' })
      expect(DBState.db.promptPresetsId).toBe(beforeSelected)
    })
  })
})
