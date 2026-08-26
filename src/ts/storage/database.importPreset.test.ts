import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { get } from 'svelte/store'

// Importing presets must not write decoded payloads to console.log.

vi.mock('./fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'preset-import-token',
}))

vi.mock('../rpack/rpack_js', () => ({
  encodeRPack: async (data: Uint8Array) => data,
  decodeRPack: async (data: Uint8Array) => data,
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
import {
  addImportedLegacyPreset,
  downloadPreset,
  importPreset,
  presetTemplate,
  resetPendingPresetMutationsForTests,
} from './database.svelte'
import { clearCachedServerCommandRevision, setServerCommandSuccessReconciler } from '../server/commands'
import {
  clearPendingMutationOutbox,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
} from '../server/pendingMutationOutbox'
import { replayPendingMutations } from '../server/pendingMutationReplay'
import { getResourceDatabase, replaceResourceDatabase } from '../server/resourceState.svelte'
import { setResourceWriteGuardEnabled } from '../server/resourceWriteGuard.svelte'
import { alertStore } from '../stores.svelte'
import { resolveAlertSelection } from '../alert'
import { language } from '../../lang'

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
      if (url === '/api/v1/commands/model-presets') {
        revision += 1
        return jsonResponse({
          revision,
          event: { type: 'modelPreset.imported', revision, resource: 'model-preset' },
          modelPresetId: 'model-imported',
        })
      }
      if (url === '/api/v1/commands/prompt-presets') {
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

function stubFailedImportCommandFetch(onCommand?: (call: CapturedFetch) => void, status = 500): CapturedFetch[] {
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
      if (url === '/api/v1/commands/prompt-presets') {
        onCommand?.(call)
        return jsonResponse({ error: 'forced import failure' }, status)
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForImportCommand(calls: CapturedFetch[]): Promise<CapturedFetch> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const match = calls.find((call) => call.url === '/api/v1/commands/prompt-presets' && call.method === 'POST')
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

async function resolvePresetImportChoice(selection: number | null): Promise<void> {
  await vi.waitFor(() => expect(get(alertStore).type).toBe('select'))
  const dialog = get(alertStore)
  expect(resolveAlertSelection(dialog.dialogOwner, selection)).toBe(true)
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

async function prepareDurablePresetImport(label: string): Promise<void> {
  vi.stubGlobal('indexedDB', new IDBFactory())
  resetPendingMutationOutboxForTests()
  await preparePendingMutationOutbox({
    writerSessionId: `writer-preset-import-${label}`,
    writerEpoch: 7,
    databaseLineage: `lineage-preset-import-${label}`,
    requestedWriterWasActive: true,
  })
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
  resetPendingPresetMutationsForTests()
  clearCachedServerCommandRevision()
  setServerCommandSuccessReconciler(null)
  setResourceWriteGuardEnabled(false)
  replaceResourceDatabase({
    modelPresets: [],
    modelPresetsId: -1,
    promptPresets: [],
    promptPresetsId: -1,
  } as any)
  alertStore.set({ type: 'none', msg: 'n' })
})

afterEach(async () => {
  setServerCommandSuccessReconciler(null)
  await clearPendingMutationOutbox()
  resetPendingMutationOutboxForTests()
  resetPendingPresetMutationsForTests()
  vi.unstubAllGlobals()
})

describe('importPreset warm-path logging', () => {
  it('rejects malformed JSON without changing presets or escaping the event handler', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(importPreset({ name: 'broken.json', data: new TextEncoder().encode('{"name":') })).resolves.toBe(
        'failed',
      )

      expect(getResourceDatabase().modelPresets).toEqual([])
      expect(getResourceDatabase().promptPresets).toEqual([])
      expect(get(alertStore)).toMatchObject({ type: 'error', msg: language.errors.noData })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('rejects a binary file with the wrong envelope before reading its payload', async () => {
    const file = fflate.compressSync(
      encodeMsgpack({
        presetVersion: 2,
        type: 'character',
        preset: new Uint8Array([1, 2, 3]),
      }),
    )
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(importPreset({ name: 'wrong.risupreset', data: file })).resolves.toBe('failed')

      expect(getResourceDatabase().modelPresets).toEqual([])
      expect(getResourceDatabase().promptPresets).toEqual([])
      expect(get(alertStore)).toMatchObject({ type: 'error', msg: language.errors.noData })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('a .risupreset binary import logs nothing to console.log', async () => {
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

  it('an ST/json preset import logs nothing to console.log, unknown and missing prompts included', async () => {
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

  it('lets a full legacy binary preset stay prompt-only and names both routed models', async () => {
    const calls = stubCommandFetch()
    const file = await buildRisupresetFile({
      id: 'legacy-source-id',
      name: 'Legacy Full',
      apiType: 'openai',
      aiModel: 'gpt-4o',
      subModel: 'gpt-4o-mini',
      openrouterRequestModel: 'openai/gpt-4o',
      temperature: 42,
      maxContext: 16000,
      mainPrompt: 'Legacy main prompt',
      jailbreak: 'Legacy jailbreak',
    })

    const importing = importPreset({ name: 'legacy-full.risupreset', data: file })
    await vi.waitFor(() => {
      expect(get(alertStore)).toMatchObject({ type: 'select' })
      expect(get(alertStore).msg).toContain('legacy-full.risupreset')
      expect(get(alertStore).msg).toContain('gpt-4o')
      expect(get(alertStore).msg).toContain('gpt-4o-mini')
    })
    await resolvePresetImportChoice(1)
    await expect(importing).resolves.toBe('applied')

    expect(getResourceDatabase().modelPresets).toHaveLength(0)
    expect(getResourceDatabase().promptPresets).toHaveLength(1)
    expect(getResourceDatabase().promptPresets[0]).toMatchObject({
      name: 'Legacy Full',
      mainPrompt: 'Legacy main prompt',
      jailbreak: 'Legacy jailbreak',
      temperature: 42,
      maxContext: 16000,
    })
    expect(getResourceDatabase().promptPresets[0].id).toBe('legacy-source-id')
    expect(getResourceDatabase().promptPresets[0]).not.toHaveProperty('apiType')
    expect(getResourceDatabase().promptPresets[0]).not.toHaveProperty('aiModel')
    expect(getResourceDatabase().promptPresets[0]).not.toHaveProperty('openrouterRequestModel')
    expect(getResourceDatabase().promptPresets[0]).not.toHaveProperty('overrideModelParameters')

    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url.endsWith('/model-presets'))).toHaveLength(0)
      expect(calls.filter((call) => call.url.endsWith('/prompt-presets'))).toHaveLength(1)
    })
    const [promptCommand] = calls.filter((call) => /\/commands\/prompt-presets$/.test(call.url))
    expect(promptCommand.body.preset).toMatchObject({
      mainPrompt: 'Legacy main prompt',
      maxContext: 16000,
    })
    expect(promptCommand.body.preset).not.toHaveProperty('apiType')
    expect(promptCommand.body.preset).not.toHaveProperty('aiModel')
    expect(promptCommand.body.preset).not.toHaveProperty('openrouterRequestModel')
    expect(promptCommand.body.preset).not.toHaveProperty('overrideModelParameters')
  })

  it('imports both halves of a full legacy preset when legacy routing is selected', async () => {
    const calls = stubCommandFetch()
    const file = await buildRisupresetFile({
      name: 'Legacy Routing',
      apiType: 'openai',
      aiModel: 'gpt4o',
      subModel: 'gpt4om',
      openrouterRequestModel: 'openai/gpt-4o',
      mainPrompt: 'Legacy prompt',
      temperature: 37,
    })

    const importing = importPreset({ name: 'legacy-routing.risup', data: file })
    await resolvePresetImportChoice(0)
    await expect(importing).resolves.toBe('applied')

    expect(getResourceDatabase().modelPresets).toHaveLength(1)
    expect(getResourceDatabase().modelPresets[0]).toMatchObject({
      name: 'Legacy Routing',
      apiType: 'openai',
      aiModel: 'gpt4o',
      subModel: 'gpt4om',
      openrouterRequestModel: 'openai/gpt-4o',
    })
    expect(getResourceDatabase().promptPresets).toHaveLength(1)
    expect(getResourceDatabase().promptPresets[0]).toMatchObject({
      name: 'Legacy Routing',
      mainPrompt: 'Legacy prompt',
      temperature: 37,
      overrideModelParameters: true,
    })
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url.endsWith('/model-presets'))).toHaveLength(1)
      expect(calls.filter((call) => call.url.endsWith('/prompt-presets'))).toHaveLength(1)
    })
  })

  it('cancels a model-bearing preset import without writing either half', async () => {
    const calls = stubCommandFetch()
    const file = await buildRisupresetFile({
      name: 'Already Profiled',
      apiType: 'openai',
      aiModel: 'gpt4o',
      subModel: 'gpt4om',
      mainPrompt: 'Do not import',
    })

    const importing = importPreset({ name: 'already-profiled.risupreset', data: file })
    await resolvePresetImportChoice(null)
    await expect(importing).resolves.toBeNull()

    expect(getResourceDatabase().modelPresets).toEqual([])
    expect(getResourceDatabase().promptPresets).toEqual([])
    expect(calls.filter((call) => call.url.includes('/commands/'))).toEqual([])
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
      expect(calls.filter((call) => call.url.endsWith('/model-presets'))).toHaveLength(0)
      expect(calls.filter((call) => call.url.endsWith('/prompt-presets'))).toHaveLength(1)
    })
  })

  it.each([
    { format: 'json' as const, archived: true },
    { format: 'json' as const, archived: false },
    { format: 'risup' as const, archived: true },
    { format: 'risup' as const, archived: false },
  ])('round-trips archived=$archived through standalone $format export and import', async ({ format, archived }) => {
    replaceResourceDatabase({
      modelPresets: [],
      modelPresetsId: -1,
      promptPresets: [{ name: 'Archive round-trip', mainPrompt: 'Portable prompt', archived }],
      promptPresetsId: 0,
    } as any)
    const exported = await downloadPreset(0, 'return')
    if (!exported?.buf) throw new Error('expected a standalone preset export')

    replaceResourceDatabase({
      modelPresets: [],
      modelPresetsId: -1,
      promptPresets: [],
      promptPresetsId: -1,
    } as any)
    const calls = stubCommandFetch()
    const file =
      format === 'json'
        ? { name: 'archive-roundtrip.json', data: new TextEncoder().encode(JSON.stringify(exported.data)) }
        : { name: 'archive-roundtrip.risup', data: exported.buf }

    await expect(importPreset(file)).resolves.toBe('applied')

    expect(getResourceDatabase().promptPresets).toHaveLength(1)
    expect(getResourceDatabase().promptPresets[0]).toMatchObject({
      name: 'Archive round-trip',
      mainPrompt: 'Portable prompt',
      archived,
    })
    const command = await waitForImportCommand(calls)
    expect(command.body.preset.archived).toBe(archived)
  })

  it('keeps the import pending until the server has accepted it', async () => {
    await prepareDurablePresetImport('pending')
    const response = deferred<Response>()
    const calls: CapturedFetch[] = []
    let revision = 30
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        calls.push({ url, method: init.method ?? 'GET', body })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision })
        if (url === '/api/v1/commands/mutation-receipts/ack') {
          return jsonResponse({ acknowledged: true })
        }
        if (url === '/api/v1/commands/prompt-presets') return response.promise
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    let settled = false
    const operation = importPreset({
      name: 'pending.json',
      data: new TextEncoder().encode(JSON.stringify({ name: 'Pending import', temperature: 48 })),
    }).then((outcome) => {
      settled = true
      return outcome
    })

    const command = await waitForImportCommand(calls)
    expect(settled).toBe(false)
    expect(getResourceDatabase().promptPresets).toEqual([
      expect.objectContaining({ id: command.body.preset.id, name: 'Pending import' }),
    ])
    expect(get(alertStore).type).toBe('none')

    revision += 1
    response.resolve(
      jsonResponse({
        revision,
        event: {
          type: 'promptPreset.created',
          revision,
          resource: 'prompt-preset',
          id: command.body.preset.id,
        },
        promptPresetId: command.body.preset.id,
      }),
    )

    await expect(operation).resolves.toBe('applied')
    expect(get(alertStore)).toMatchObject({ type: 'normal', msg: language.successImport })
    expect(await listPendingMutations()).toEqual([])
  })

  it('keeps a retryable prompt import visible and reports it as queued', async () => {
    await prepareDurablePresetImport('queued')
    const calls = stubFailedImportCommandFetch()
    const file = new TextEncoder().encode(JSON.stringify({ name: 'Queued prompt', temperature: 52 }))

    await expect(importPreset({ name: 'queued.json', data: file })).resolves.toBe('queued')

    const command = await waitForImportCommand(calls)
    expect(getResourceDatabase().promptPresets).toEqual([
      expect.objectContaining({ id: command.body.preset.id, name: 'Queued prompt' }),
    ])
    expect(get(alertStore)).toMatchObject({ type: 'normal', msg: language.presetImportQueued })
    const retained = await listPendingMutations()
    expect(retained).toHaveLength(1)
    expect(retained[0]).toMatchObject({
      handle: { key: `prompt-template-owner:${command.body.preset.id}` },
      intent: {
        requests: [
          {
            method: 'POST',
            path: '/prompt-presets',
            body: { preset: { id: command.body.preset.id, name: 'Queued prompt' } },
          },
        ],
      },
    })
  })

  it('retries only the unaccepted split-preset suffix without duplicating its accepted model row', async () => {
    await prepareDurablePresetImport('accepted-prefix')
    let revision = 50
    let recoverPrompt = false
    let modelAttempts = 0
    let promptAttempts = 0
    const calls: CapturedFetch[] = []
    const serverModels: Array<Record<string, unknown>> = []
    const serverPrompts: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        calls.push({ url, method: init.method ?? 'GET', body })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision })
        if (url === '/api/v1/commands/mutation-receipts/ack') {
          return jsonResponse({ acknowledged: true })
        }
        if (url === '/api/v1/commands/model-presets') {
          modelAttempts += 1
          serverModels.push(clonePlain(body.preset))
          revision += 1
          return jsonResponse({
            revision,
            event: {
              type: 'modelPreset.created',
              revision,
              resource: 'model-preset',
              id: body.preset.id,
            },
            modelPresetId: body.preset.id,
          })
        }
        if (url === '/api/v1/commands/prompt-presets') {
          promptAttempts += 1
          if (!recoverPrompt) return jsonResponse({ error: 'prompt temporarily unavailable' }, 503)
          serverPrompts.push(clonePlain(body.preset))
          revision += 1
          return jsonResponse({
            revision,
            event: {
              type: 'promptPreset.created',
              revision,
              resource: 'prompt-preset',
              id: body.preset.id,
            },
            promptPresetId: body.preset.id,
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setServerCommandSuccessReconciler((event) => {
      if (event.type !== 'modelPreset.created') return
      getResourceDatabase().modelPresets = clonePlain(serverModels) as any
      // Simulate the authoritative model collection reconciliation replacing
      // a sibling optimistic collection before the retained prompt settles.
      getResourceDatabase().promptPresets = []
    })
    const legacyPreset = {
      name: 'Durable legacy import',
      apiType: 'openai',
      aiModel: 'gpt-4o',
      mainPrompt: 'Keep the queued prompt visible',
      temperature: 57,
    } as any

    await expect(addImportedLegacyPreset(legacyPreset)).resolves.toBe('queued')

    expect(modelAttempts).toBe(1)
    expect(promptAttempts).toBe(1)
    expect(serverModels).toHaveLength(1)
    expect(serverPrompts).toHaveLength(0)
    expect(getResourceDatabase().modelPresets).toEqual([
      expect.objectContaining({ id: serverModels[0].id, name: 'Durable legacy import' }),
    ])
    expect(getResourceDatabase().promptPresets).toEqual([
      expect.objectContaining({ name: 'Durable legacy import', mainPrompt: 'Keep the queued prompt visible' }),
    ])
    const retained = await listPendingMutations()
    expect(retained).toHaveLength(1)
    expect(retained[0].handle.key).toBe(`prompt-template-owner:${getResourceDatabase().promptPresets[0].id}`)
    expect(retained[0].intent.dependencyKeys).toEqual(['preset-operations', `split-preset:model:${serverModels[0].id}`])

    recoverPrompt = true
    await expect(replayPendingMutations()).resolves.toMatchObject({ retained: 0, succeeded: 1 })

    expect(modelAttempts).toBe(1)
    expect(promptAttempts).toBe(2)
    expect(serverModels).toHaveLength(1)
    expect(serverPrompts).toHaveLength(1)
    expect(serverPrompts[0].id).toBe(getResourceDatabase().promptPresets[0].id)
    expect(await listPendingMutations()).toEqual([])
  })

  it('rolls back only the terminally rejected imported row', async () => {
    await prepareDurablePresetImport('terminal')
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
    }, 400)
    const file = new TextEncoder().encode(JSON.stringify({ name: 'Import Will Roll Back', temperature: 66 }))

    await expect(importPreset({ name: 'plain-preset.json', data: file })).resolves.toBe('failed')

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
    expect(await listPendingMutations()).toEqual([])
    expect(get(alertStore)).toMatchObject({ type: 'error', msg: language.presetImportFailed })
  })
})
