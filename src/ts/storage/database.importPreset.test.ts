import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Importing presets must not write decoded payloads to console.log.

vi.mock('./fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'preset-import-token',
}))

// Resource-state effects fire moduleUpdate when the database is seeded;
// neutralize it so the import-order TDZ between modules.ts and this module
// graph cannot crash the run (same pattern as command.resourceGuard.test.ts).
vi.mock('../process/modules', async (importActual) => {
  const actual = await importActual<typeof import('../process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import * as fflate from 'fflate'
import { encode as encodeMsgpack } from 'msgpackr/index-no-eval'
import { encryptBuffer } from '../util'
import { importPreset, presetTemplate } from './database.svelte'
import { clearCachedServerCommandRevision } from '../server/commands'
import { getResourceDatabase, replaceResourceDatabase } from '../server/resourceState.svelte'
import { setResourceWriteGuardEnabled } from '../server/resourceWriteGuard.svelte'

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
  let revision = 10
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
      if (url === '/api/v1/commands/model-presets/import') {
        revision += 1
        return jsonResponse({
          revision,
          event: { type: 'modelPreset.imported', revision, resource: 'model-preset' },
          modelPresetId: 'model-imported',
        })
      }
      if (url === '/api/v1/commands/prompt-presets/import') {
        revision += 1
        return jsonResponse({
          revision,
          event: { type: 'promptPreset.imported', revision, resource: 'prompt-preset' },
          promptPresetId: 'preset-imported',
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
  setResourceWriteGuardEnabled(false)
  replaceResourceDatabase({
    modelPresets: [],
    modelPresetsId: -1,
    promptPresets: [],
    promptPresetsId: -1,
  } as any)
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
      const imported = getResourceDatabase().promptPresets[getResourceDatabase().promptPresets.length - 1]
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
      const imported = getResourceDatabase().promptPresets[getResourceDatabase().promptPresets.length - 1] as any
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

  it('splits a full legacy binary preset into model and prompt presets without dropping runtime fields', async () => {
    const calls = stubCommandFetch()
    const file = await buildRisupresetFile({
      id: 'legacy-source-id',
      name: 'Legacy Full',
      apiType: 'openai',
      aiModel: 'gpt-4o',
      openrouterRequestModel: 'openai/gpt-4o',
      temperature: 42,
      maxContext: 16000,
      mainPrompt: 'Legacy main prompt',
      jailbreak: 'Legacy jailbreak',
    })

    await importPreset({ name: 'legacy-full.risupreset', data: file })

    expect(getResourceDatabase().modelPresets).toHaveLength(1)
    expect(getResourceDatabase().modelPresets[0]).toMatchObject({
      name: 'Legacy Full',
      apiType: 'openai',
      aiModel: 'gpt-4o',
      openrouterRequestModel: 'openai/gpt-4o',
      temperature: 42,
      maxContext: 16000,
    })
    expect(getResourceDatabase().modelPresets[0].id).not.toBe('legacy-source-id')

    expect(getResourceDatabase().promptPresets).toHaveLength(1)
    expect(getResourceDatabase().promptPresets[0]).toMatchObject({
      name: 'Legacy Full',
      mainPrompt: 'Legacy main prompt',
      jailbreak: 'Legacy jailbreak',
      temperature: 42,
      maxContext: 16000,
      overrideModelParameters: true,
    })
    expect(getResourceDatabase().promptPresets[0].id).not.toBe('legacy-source-id')

    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url.endsWith('/model-presets/import'))).toHaveLength(1)
      expect(calls.filter((call) => call.url.endsWith('/prompt-presets/import'))).toHaveLength(1)
    })
    const [modelCommand, promptCommand] = calls.filter((call) => call.url.includes('-presets/import'))
    expect(modelCommand.body.preset).toMatchObject({
      aiModel: 'gpt-4o',
      openrouterRequestModel: 'openai/gpt-4o',
      maxContext: 16000,
    })
    expect(promptCommand.body.preset).toMatchObject({
      mainPrompt: 'Legacy main prompt',
      overrideModelParameters: true,
      maxContext: 16000,
    })
  })

  it('imports a modern prompt export with blank redacted fields as prompt-only', async () => {
    const calls = stubCommandFetch()
    const file = await buildRisupresetFile({
      id: 'prompt-source-id',
      name: 'Modern Prompt Export',
      mainPrompt: 'Modern main prompt',
      temperature: 61,
      overrideModelParameters: true,
      openAIKey: '',
      forceReplaceUrl: '',
      forceReplaceUrl2: '',
      proxyKey: '',
      textgenWebUIStreamURL: '',
      textgenWebUIBlockingURL: '',
    })

    await importPreset({ name: 'modern-prompt.risupreset', data: file })

    expect(getResourceDatabase().modelPresets).toHaveLength(0)
    expect(getResourceDatabase().promptPresets).toHaveLength(1)
    expect(getResourceDatabase().promptPresets[0]).toMatchObject({
      name: 'Modern Prompt Export',
      mainPrompt: 'Modern main prompt',
      temperature: 61,
      overrideModelParameters: true,
    })
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url.endsWith('/model-presets/import'))).toHaveLength(0)
      expect(calls.filter((call) => call.url.endsWith('/prompt-presets/import'))).toHaveLength(1)
    })
  })

  it('L21: a failed preset import rolls back the optimistic imported row', async () => {
    getResourceDatabase().promptPresets = [
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
    getResourceDatabase().promptPresetsId = 0
    const beforeSelected = getResourceDatabase().promptPresetsId
    const calls = stubFailedImportCommandFetch(() => {
      getResourceDatabase().promptPresets[1] = {
        ...getResourceDatabase().promptPresets[1],
        name: 'Sibling edited after dispatch',
      }
      getResourceDatabase().promptPresets.push({
        ...clonePlain(presetTemplate),
        id: 'preset-appended',
        name: 'Appended after dispatch',
      })
    })
    const file = new TextEncoder().encode(JSON.stringify({ name: 'Import Will Roll Back', temperature: 66 }))

    await importPreset({ name: 'plain-preset.json', data: file })

    expect(getResourceDatabase().promptPresets.map((preset) => preset.name)).toContain('Import Will Roll Back')
    await waitForImportCommand(calls)
    await waitForState(() => {
      expect(getResourceDatabase().promptPresets.map((preset) => preset.id)).toEqual([
        'preset-existing',
        'preset-sibling',
        'preset-appended',
      ])
      expect(getResourceDatabase().promptPresets[1]).toMatchObject({ name: 'Sibling edited after dispatch' })
      expect(getResourceDatabase().promptPresets[2]).toMatchObject({ name: 'Appended after dispatch' })
      expect(getResourceDatabase().promptPresetsId).toBe(beforeSelected)
    })
  })
})
