import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Regression coverage (stability/perf plan, Phase 7 L37): `importPreset` used
// to `console.log` full decoded preset objects on every import — the msgpack
// `decoded` envelope for `.risupreset`/`.risup` files, the parsed `pre` object
// for JSON files, and per-prompt dumps (`p` / 'Prompt not found') while
// mapping ST presets. Those logs are gone; importing must stay silent while
// the preset still lands and dispatches the import command.

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
import { importPreset } from './database.svelte'
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
      if (url === '/api/v1/commands/presets/import') {
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

async function waitForImportCommand(calls: CapturedFetch[]): Promise<CapturedFetch> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const match = calls.find(
      (call) => call.url === '/api/v1/commands/presets/import' && call.method === 'POST',
    )
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`import command not dispatched; saw: ${JSON.stringify(calls)}`)
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
    botPresets: [],
    botPresetsId: -1,
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
      const imported = DBState.db.botPresets[DBState.db.botPresets.length - 1]
      expect(imported).toMatchObject({ name: 'Risup Roundtrip', temperature: 42 })
      const cmd = await waitForImportCommand(calls)
      expect(cmd.body.preset).toMatchObject({ name: 'Risup Roundtrip' })
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
      const imported = DBState.db.botPresets[DBState.db.botPresets.length - 1] as any
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
})
