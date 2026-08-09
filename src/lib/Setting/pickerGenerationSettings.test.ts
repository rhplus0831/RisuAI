import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

const presetSpies = vi.hoisted(() => ({
  changeToPreset: vi.fn(),
  copyPreset: vi.fn(),
  createPreset: vi.fn(),
  deletePreset: vi.fn(),
  downloadPreset: vi.fn(),
  importPreset: vi.fn(),
  reorderModelPresets: vi.fn(),
  reorderPromptPresets: vi.fn(),
  reorderPresets: vi.fn(),
  updatePreset: vi.fn(),
}))

const personaSpies = vi.hoisted(() => ({
  changeUserPersonaWithOutcome: vi.fn(async (_index: number): Promise<'accepted' | 'queued' | 'failed'> => 'accepted'),
}))

const moduleSpies = vi.hoisted(() => ({
  exportModule: vi.fn(),
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleMcps: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModuleToggles: vi.fn(() => ''),
  getModuleTriggers: vi.fn(() => []),
  getModules: vi.fn(() => []),
  importModule: vi.fn(),
  moduleUpdate: vi.fn(),
  readModule: vi.fn(),
  refreshModules: vi.fn(),
}))

const alertSpies = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  alertError: vi.fn(),
  alertNormal: vi.fn(),
}))

const sortableSpies = vi.hoisted(() => ({
  create: vi.fn(),
  destroy: vi.fn(),
  option: vi.fn(),
}))

vi.mock('sortablejs', () => ({
  default: { create: sortableSpies.create },
}))

vi.mock('../../ts/storage/database.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../../ts/storage/database.svelte')>()
  return {
    ...actual,
    changeToPreset: presetSpies.changeToPreset,
    copyPreset: presetSpies.copyPreset,
    createPreset: presetSpies.createPreset,
    deletePreset: presetSpies.deletePreset,
    downloadPreset: presetSpies.downloadPreset,
    importPreset: presetSpies.importPreset,
    reorderModelPresets: presetSpies.reorderModelPresets,
    reorderPromptPresets: presetSpies.reorderPromptPresets,
    reorderPresets: presetSpies.reorderPresets,
    updatePreset: presetSpies.updatePreset,
  }
})

vi.mock('src/ts/persona', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/persona')>()
  return {
    ...actual,
    changeUserPersonaWithOutcome: personaSpies.changeUserPersonaWithOutcome,
  }
})

vi.mock('src/ts/storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'picker-generation-settings-token',
}))

vi.mock('src/ts/process/modules', () => moduleSpies)

vi.mock('../../ts/alert', async (importActual) => {
  const actual = await importActual<typeof import('../../ts/alert')>()
  return {
    ...actual,
    alertConfirm: alertSpies.alertConfirm,
    alertError: alertSpies.alertError,
    alertNormal: alertSpies.alertNormal,
  }
})

import Botpreset from './botpreset.svelte'
import ListedPersona from './listedPersona.svelte'
import { clearCachedServerCommandRevision, type ServerCommandResult } from 'src/ts/server/commands'
import { setResourceWriteGuardEnabled } from 'src/ts/server/resourceWriteGuard.svelte'
import { flushRegisteredPendingBridgePatches } from 'src/ts/server/pendingBridgeFlushRegistry'
import {
  clearPendingMutationOutbox,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
} from 'src/ts/server/pendingMutationOutbox'
import { selectedCharID, type GenerationSettingsPickerMode } from 'src/ts/stores.svelte'
import {
  getDatabase,
  reapplyPendingPresetProjections,
  resetPendingPresetMutationsForTests,
  setDatabaseLite,
} from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'
import { applyCollectionsResource, type ServerCollectionName } from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  body: unknown
  keepalive: boolean
}

interface StubCommandFetchOptions {
  generationSettingsResponse?: Promise<Response>
  modelPatchResponse?: Promise<Response>
  promptCreateResponse?: Promise<Response>
  promptPatchResponse?: Promise<Response>
  promptDeleteResponse?: Promise<Response>
  modelSelectResponse?: Promise<Response>
  promptSelectResponse?: Promise<Response>
  promptSelectConflictOnce?: boolean
}

let target: HTMLElement
let component: MountedComponent | undefined

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(options: StubCommandFetchOptions = {}): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  let promptSelectAttempts = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(input)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        body,
        keepalive: init.keepalive === true,
      })

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 200 })
      if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
      if (init.method === 'PATCH' && url.startsWith('/api/v1/commands/model-presets/')) {
        if (options.modelPatchResponse) return options.modelPatchResponse
        const modelPresetId = decodeURIComponent(url.slice('/api/v1/commands/model-presets/'.length))
        return jsonResponse({
          status: 'ok',
          revision: 201,
          event: {
            type: 'modelPreset.updated',
            revision: 201,
            resource: 'preset',
            id: modelPresetId,
          },
          modelPresetId,
          acknowledgedKeys: Object.keys(body?.patch ?? {}),
          preset: body?.patch ?? {},
          settings: {},
          selectedProjectionApplied: false,
        })
      }
      if (init.method === 'PATCH' && url.startsWith('/api/v1/commands/prompt-presets/')) {
        if (options.promptPatchResponse) return options.promptPatchResponse
        const promptPresetId = decodeURIComponent(url.slice('/api/v1/commands/prompt-presets/'.length))
        return jsonResponse({
          status: 'ok',
          revision: 201,
          event: {
            type: 'promptPreset.updated',
            revision: 201,
            resource: 'preset',
            id: promptPresetId,
          },
          promptPresetId,
          acknowledgedKeys: Object.keys(body?.patch ?? {}),
          preset: body?.patch ?? {},
          settings: {},
          selectedProjectionApplied: false,
          ownerProjectionApplied: false,
        })
      }
      if (init.method === 'POST' && url === '/api/v1/commands/prompt-presets') {
        if (options.promptCreateResponse) return options.promptCreateResponse
        const promptPresetId = body?.preset?.id
        return jsonResponse({
          status: 'ok',
          revision: 201,
          event: {
            type: 'promptPreset.created',
            revision: 201,
            resource: 'promptPreset',
            id: promptPresetId,
          },
          promptPresetId,
        })
      }
      if (init.method === 'DELETE' && url.endsWith('/prompt-presets/preset-b') && options.promptDeleteResponse) {
        return options.promptDeleteResponse
      }
      if (url.endsWith('/model-presets/select')) {
        if (options.modelSelectResponse) return options.modelSelectResponse
        return jsonResponse({
          status: 'ok',
          revision: 201,
          event: {
            type: 'modelPreset.selected',
            revision: 201,
            resource: 'modelPreset',
            id: 'model-preset-b',
          },
          modelPresetId: 'model-preset-b',
        })
      }
      if (url.endsWith('/prompt-presets/select')) {
        promptSelectAttempts += 1
        if (options.promptSelectConflictOnce && promptSelectAttempts === 1) {
          return jsonResponse({ error: 'revision_conflict', currentRevision: 201 }, 409)
        }
        if (options.promptSelectResponse) return options.promptSelectResponse
        return jsonResponse({
          status: 'ok',
          revision: options.promptSelectConflictOnce ? 202 : 201,
          event: {
            type: 'promptPreset.selected',
            revision: options.promptSelectConflictOnce ? 202 : 201,
            resource: 'promptPreset',
            id: 'preset-b',
          },
          promptPresetId: 'preset-b',
        })
      }
      if (url.endsWith('/generation-settings')) {
        if (options.generationSettingsResponse) return options.generationSettingsResponse
        return jsonResponse({
          status: 'ok',
          revision: 201,
          event: {
            type: 'chat.updated',
            revision: 201,
            resource: 'characterRow',
            id: 'chat-a',
            parentId: 'char-a',
          },
          chatId: 'chat-a',
          characterId: 'char-a',
          certificate: 'chat-generation-settings-sparse-v1',
          patchedKeys: Object.keys(body?.patch ?? {}).sort(),
          deletedKeys: [...(body?.deleteKeys ?? [])].sort(),
          sidebarTogglePatchedKeys: Object.keys(body?.patch?.sidebarToggles ?? {}).sort(),
          sidebarToggleDeletedKeys: [...(body?.sidebarToggleDeleteKeys ?? [])].sort(),
          prunedSidebarToggleKeys: [],
        } satisfies ServerCommandResult<{ chatId: string }> & Record<string, unknown>)
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForFetchCount(calls: CapturedFetch[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(count)
}

async function waitForCommandFetches(calls: CapturedFetch[]): Promise<void> {
  await waitForFetchCount(calls, 2)
}

function seedDb(): void {
  selectedCharID.set(0)
  setDatabaseLite({
    modelPresetsId: 0,
    modelPresets: [
      {
        id: 'model-preset-a',
        name: 'Model Preset A',
      },
      {
        id: 'model-preset-b',
        name: 'Model Preset B',
      },
    ],
    promptPresetsId: 0,
    promptPresets: [
      {
        id: 'preset-a',
        name: 'Preset A',
        mainPrompt: '',
        jailbreak: '',
        globalNote: '',
        temperature: 0,
        maxContext: 0,
        maxResponse: 0,
        frequencyPenalty: 0,
        PresensePenalty: 0,
        formatingOrder: [],
        promptPreprocess: false,
        bias: [],
        ooba: {},
        ainconfig: {},
        customPromptTemplateToggle: '',
      },
      {
        id: 'preset-b',
        name: 'Preset B',
        mainPrompt: '',
        jailbreak: '',
        globalNote: '',
        temperature: 0,
        maxContext: 0,
        maxResponse: 0,
        frequencyPenalty: 0,
        PresensePenalty: 0,
        formatingOrder: [],
        promptPreprocess: false,
        bias: [],
        ooba: {},
        ainconfig: {},
        customPromptTemplateToggle: '',
      },
    ],
    selectedPersona: 0,
    personas: [
      {
        id: 'persona-a',
        name: 'Persona A',
        personaPrompt: 'Persona A prompt',
        icon: '',
        note: 'A note',
      },
      {
        id: 'persona-b',
        name: 'Persona B',
        personaPrompt: 'Persona B prompt',
        icon: '',
        note: 'B note',
      },
    ],
    modules: [],
    enabledModules: [],
    characters: [
      {
        chaId: 'char-a',
        name: 'Character A',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            note: '',
            message: [],
            localLore: [],
            generationSettings: {
              configured: true,
              personaId: 'persona-b',
              modelPresetId: 'model-preset-a',
              promptPresetId: 'preset-b',
              jailbreakToggle: false,
              sidebarToggles: {},
            },
          },
        ],
      },
    ],
  } as any)
}

function elementBySelector<T extends Element>(selector: string, label: string): T {
  const element = target.querySelector<T>(selector)
  expect(element, label).toBeTruthy()
  return element!
}

function pickerRoot(kind: 'model' | 'prompt' | 'persona', mode: GenerationSettingsPickerMode): HTMLElement {
  return elementBySelector<HTMLElement>(
    `[data-risu-generation-picker][data-risu-picker-kind="${kind}"][data-risu-picker-mode="${mode}"]`,
    `${kind} ${mode} picker root`,
  )
}

function pickerRow(kind: 'model' | 'prompt' | 'persona', id: string): HTMLElement {
  return elementBySelector<HTMLElement>(
    `[data-risu-generation-picker-row][data-risu-picker-kind="${kind}"][data-risu-row-id="${id}"]`,
    `${kind} row ${id}`,
  )
}

function pickerSelectionControl(kind: 'model' | 'prompt' | 'persona', id: string): HTMLElement {
  const row = pickerRow(kind, id)
  return row.querySelector<HTMLElement>('[data-risu-picker-select]') ?? row
}

function promptPresetSortableOptions(): Record<string, any> {
  const options = sortableSpies.create.mock.calls.at(-1)?.[1]
  if (!options) throw new Error('Prompt preset Sortable options not found')
  return options
}

function finishPromptPresetSort(presetId: string, oldIndex: number, newIndex: number): void {
  const list = elementBySelector<HTMLElement>('[data-risu-preset-sortable-list]', 'prompt preset sortable list')
  const item = pickerRow('prompt', presetId)
  list.append(item)
  promptPresetSortableOptions().onEnd({
    from: list,
    item,
    oldDraggableIndex: oldIndex,
    newDraggableIndex: newIndex,
  })
}

function expectPickerRowSelection(kind: 'model' | 'prompt' | 'persona', id: string, selected: boolean): void {
  const row = pickerRow(kind, id)
  const selectionControl = pickerSelectionControl(kind, id)
  expect(row.dataset.risuSelected).toBe(selected ? 'true' : 'false')
  expect(selectionControl.getAttribute('aria-pressed')).toBe(selected ? 'true' : 'false')
  expect(selectionControl.getAttribute('aria-current')).toBe(selected ? 'true' : null)
}

function mountPresetPicker(mode: GenerationSettingsPickerMode, close = vi.fn(), kind: 'model' | 'prompt' = 'prompt') {
  component = mount(Botpreset, {
    target,
    props: { mode, close, kind },
  })
  return close
}

function mountPersonaPicker(mode: GenerationSettingsPickerMode, close = vi.fn()) {
  component = mount(ListedPersona, {
    target,
    props: { mode, close },
  })
  return close
}

function globalPresetSelectionControl(kind: 'model' | 'prompt'): HTMLElement {
  if (kind === 'prompt') return pickerSelectionControl('prompt', 'preset-b')
  const rows = target.querySelectorAll<HTMLElement>('section [role="button"][tabindex="0"]')
  expect(rows).toHaveLength(2)
  return rows[1]
}

function presetSelectionSuccess(kind: 'model' | 'prompt'): Response {
  const presetId = kind === 'model' ? 'model-preset-b' : 'preset-b'
  return jsonResponse({
    status: 'ok',
    revision: 201,
    event: {
      type: `${kind}Preset.selected`,
      revision: 201,
      resource: `${kind}Preset`,
      id: presetId,
    },
    [`${kind}PresetId`]: presetId,
  })
}

async function settleModalFocus(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
}

function createModalOpener(label: string): HTMLButtonElement {
  const opener = document.createElement('button')
  opener.textContent = label
  document.body.insertBefore(opener, target)
  opener.focus()
  return opener
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  vi.clearAllMocks()
  alertSpies.alertConfirm.mockReset()
  presetSpies.reorderModelPresets.mockResolvedValue({ status: 'accepted' })
  presetSpies.reorderPromptPresets.mockResolvedValue({ status: 'accepted' })
  sortableSpies.create.mockReturnValue({
    destroy: sortableSpies.destroy,
    option: sortableSpies.option,
  })
  clearCachedServerCommandRevision()
  setResourceWriteGuardEnabled(false)
  seedDb()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('generation settings picker mode', () => {
  it('gives the preset picker a blocking focus contract and owned close interactions', async () => {
    const opener = createModalOpener('Open presets')
    const close = mountPresetPicker('global')
    await settleModalFocus()

    const dialog = pickerRoot('prompt', 'global')
    const backdrop = dialog.closest<HTMLElement>('[data-modal-root]')
    const initialFocus = dialog.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
    expect(backdrop).toBeTruthy()
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('risu-preset-picker-title')
    expect(opener.inert).toBe(true)
    expect(document.activeElement).toBe(initialFocus)

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    )
    const last = focusable.at(-1)
    expect(last).toBeTruthy()
    last!.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    last!.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(focusable[0])

    dialog.click()
    expect(close).not.toHaveBeenCalled()
    backdrop!.click()
    expect(close).toHaveBeenCalledOnce()
    close.mockClear()

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    initialFocus!.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(close).toHaveBeenCalledOnce()

    unmount(component!)
    component = undefined
    await settleModalFocus()
    expect(opener.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('gives the persona picker a blocking focus contract and owned close interactions', async () => {
    const opener = createModalOpener('Open personas')
    const close = mountPersonaPicker('global')
    await settleModalFocus()

    const dialog = pickerRoot('persona', 'global')
    const backdrop = dialog.closest<HTMLElement>('[data-modal-root]')
    const initialFocus = dialog.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
    expect(backdrop).toBeTruthy()
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('risu-persona-picker-title')
    expect(opener.inert).toBe(true)
    expect(document.activeElement).toBe(initialFocus)

    const rows = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-risu-generation-picker-row]'))
    const last = rows.at(-1)
    expect(last).toBeTruthy()
    last!.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    last!.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(initialFocus)

    dialog.click()
    expect(close).not.toHaveBeenCalled()
    backdrop!.click()
    expect(close).toHaveBeenCalledOnce()
    close.mockClear()

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    initialFocus!.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(close).toHaveBeenCalledOnce()

    unmount(component!)
    component = undefined
    await settleModalFocus()
    expect(opener.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('allows Space in the prompt preset rename input', async () => {
    const close = mountPresetPicker('global')

    elementBySelector<HTMLButtonElement>('[data-risu-preset-edit]', 'prompt preset edit button').click()
    await tick()

    const input = pickerRow('prompt', 'preset-a').querySelector<HTMLInputElement>('input')
    expect(input).toBeTruthy()

    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    input!.dispatchEvent(event)
    await tick()

    expect(event.defaultPrevented).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it('keeps archived prompt presets out of the active view and shows only them in the archive view', async () => {
    getDatabase().promptPresets[1].archived = true
    mountPresetPicker('global')

    expect(pickerRow('prompt', 'preset-a')).toBeTruthy()
    expect(target.querySelector('[data-risu-row-id="preset-b"]')).toBeNull()

    const archiveView = elementBySelector<HTMLButtonElement>(
      '[data-risu-preset-archive-view]',
      'prompt preset archive view button',
    )
    expect(archiveView.getAttribute('aria-label')).toBe(language.showArchivedPromptPresets)
    expect(archiveView.getAttribute('aria-pressed')).toBe('false')
    archiveView.click()
    await tick()

    expect(target.querySelector('[data-risu-row-id="preset-a"]')).toBeNull()
    expect(pickerRow('prompt', 'preset-b').dataset.risuRowIndex).toBe('1')
    expect(archiveView.getAttribute('aria-label')).toBe(language.showActivePromptPresets)
    expect(archiveView.getAttribute('aria-pressed')).toBe('true')
    expect(target.querySelector(`[aria-label="${language.add}: ${language.promptPresets}"]`)).toBeNull()
    expect(target.querySelector(`[aria-label="${language.import}: ${language.promptPresets}"]`)).toBeNull()
  })

  it('archives a prompt preset without selecting it and persists the archive field', async () => {
    const calls = stubCommandFetch()
    const close = mountPresetPicker('global')

    const archiveAction = pickerRow('prompt', 'preset-a').querySelector<HTMLButtonElement>(
      '[data-risu-preset-archive-action]',
    )
    expect(archiveAction?.getAttribute('aria-label')).toBe(`${language.archivePromptPreset}: Preset A`)
    archiveAction!.click()
    await tick()

    expect(getDatabase().promptPresets[0].archived).toBe(true)
    expect(getDatabase().promptPresetsId).toBe(0)
    expect(target.querySelector('[data-risu-row-id="preset-a"]')).toBeNull()
    expect(close).not.toHaveBeenCalled()

    flushRegisteredPendingBridgePatches({})
    await waitForCommandFetches(calls)
    expect(calls).toContainEqual(
      expect.objectContaining({
        url: '/api/v1/commands/prompt-presets/preset-a',
        method: 'PATCH',
        body: expect.objectContaining({ patch: { archived: true } }),
      }),
    )
  })

  it('restores an archived prompt preset to the active view', async () => {
    getDatabase().promptPresets[1].archived = true
    const calls = stubCommandFetch()
    mountPresetPicker('global')

    elementBySelector<HTMLButtonElement>('[data-risu-preset-archive-view]', 'prompt preset archive view button').click()
    await tick()
    const restoreAction = pickerRow('prompt', 'preset-b').querySelector<HTMLButtonElement>(
      '[data-risu-preset-archive-action]',
    )
    expect(restoreAction?.getAttribute('aria-label')).toBe(`${language.restorePromptPreset}: Preset B`)
    restoreAction!.click()
    await tick()

    expect(getDatabase().promptPresets[1].archived).toBe(false)
    expect(target.querySelector('[data-risu-row-id="preset-b"]')).toBeNull()

    flushRegisteredPendingBridgePatches({})
    await waitForCommandFetches(calls)
    expect(calls).toContainEqual(
      expect.objectContaining({
        url: '/api/v1/commands/prompt-presets/preset-b',
        method: 'PATCH',
        body: expect.objectContaining({ patch: { archived: false } }),
      }),
    )

    elementBySelector<HTMLButtonElement>('[data-risu-preset-archive-view]', 'prompt preset active view button').click()
    await tick()
    expect(pickerRow('prompt', 'preset-b')).toBeTruthy()
  })

  it('allows an archived prompt preset to be selected from the archive view', async () => {
    getDatabase().promptPresets[1].archived = true
    const calls = stubCommandFetch()
    const close = mountPresetPicker('global')

    elementBySelector<HTMLButtonElement>('[data-risu-preset-archive-view]', 'prompt preset archive view button').click()
    await tick()
    pickerSelectionControl('prompt', 'preset-b').click()
    await waitForCommandFetches(calls)

    expect(getDatabase().promptPresetsId).toBe(1)
    expect(getDatabase().promptPresets[1].archived).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })

  it('projects and exports a quick prompt preset rename before lifecycle keepalive flushes it', async () => {
    const calls = stubCommandFetch()
    let exportedName: string | undefined
    presetSpies.downloadPreset.mockImplementation(async (index: number) => {
      exportedName = getDatabase().promptPresets[index]?.name
    })
    mountPresetPicker('global')

    elementBySelector<HTMLButtonElement>('[data-risu-preset-edit]', 'prompt preset edit button').click()
    await tick()

    const row = pickerRow('prompt', 'preset-a')
    const input = row.querySelector<HTMLInputElement>('input')
    const exportButton = row.querySelector<SVGElement>('svg.lucide-share-2')?.closest('button')
    expect(input).toBeTruthy()
    expect(exportButton).toBeTruthy()
    input!.value = 'Renamed before pagehide'
    input!.dispatchEvent(new Event('input', { bubbles: true }))

    expect(getDatabase().promptPresets[0].name).toBe('Renamed before pagehide')
    exportButton!.click()
    await tick()
    expect(exportedName).toBe('Renamed before pagehide')

    flushRegisteredPendingBridgePatches({ keepalive: true })

    await waitForFetchCount(calls, 2)
    const patchCalls = calls.filter(
      (call) => call.method === 'PATCH' && call.url === '/api/v1/commands/prompt-presets/preset-a',
    )
    expect(patchCalls).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({ patch: { name: 'Renamed before pagehide' } }),
        keepalive: true,
      }),
    ])

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
  })

  it('projects a quick model preset rename immediately through shared state', async () => {
    const calls = stubCommandFetch()
    mountPresetPicker('active-chat-generation-settings', vi.fn(), 'model')

    elementBySelector<HTMLButtonElement>('[data-risu-preset-edit]', 'model preset edit button').click()
    await tick()

    const input = pickerRow('model', 'model-preset-a').querySelector<HTMLInputElement>('input')
    expect(input).toBeTruthy()
    input!.value = 'Renamed Model Preset'
    input!.dispatchEvent(new Event('input', { bubbles: true }))

    expect(getDatabase().modelPresets[0].name).toBe('Renamed Model Preset')
    await tick()
    expect(input!.value).toBe('Renamed Model Preset')

    flushRegisteredPendingBridgePatches({})
    await waitForFetchCount(calls, 2)
    expect(calls).toContainEqual(
      expect.objectContaining({
        url: '/api/v1/commands/model-presets/model-preset-a',
        method: 'PATCH',
        body: expect.objectContaining({ patch: { name: 'Renamed Model Preset' } }),
      }),
    )
  })

  describe.each(['model', 'prompt'] as const)('%s preset rename reconciliation', (kind) => {
    it('keeps every visible consumer on the resource-backed name after terminal rollback', async () => {
      const response = createDeferred<Response>()
      const calls = stubCommandFetch(
        kind === 'model' ? { modelPatchResponse: response.promise } : { promptPatchResponse: response.promise },
      )
      const mode: GenerationSettingsPickerMode = kind === 'model' ? 'active-chat-generation-settings' : 'global'
      mountPresetPicker(mode, vi.fn(), kind)
      elementBySelector<HTMLButtonElement>('[data-risu-preset-edit]', `${kind} preset edit button`).click()
      await tick()

      const presetId = kind === 'model' ? 'model-preset-a' : 'preset-a'
      const originalName = kind === 'model' ? 'Model Preset A' : 'Preset A'
      const rejectedName = `${originalName} rejected`
      const authoritativeName = `${originalName} from server`
      const collectionName: ServerCollectionName = kind === 'model' ? 'modelPresets' : 'promptPresets'
      const currentPresets = () => (kind === 'model' ? getDatabase().modelPresets : getDatabase().promptPresets)
      const input = pickerRow(kind, presetId).querySelector<HTMLInputElement>('input')
      expect(input).toBeTruthy()

      const consumerTarget = document.createElement('div')
      document.body.appendChild(consumerTarget)
      const consumer = mount(Botpreset, {
        target: consumerTarget,
        props: { mode, close: vi.fn(), kind },
      })

      try {
        input!.value = rejectedName
        input!.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()

        expect(currentPresets()[0].name).toBe(rejectedName)
        expect(input!.value).toBe(rejectedName)
        expect(consumerTarget.querySelector(`[data-risu-row-id="${presetId}"]`)?.textContent).toContain(rejectedName)

        const authoritativePresets = safeStructuredClone(currentPresets())
        authoritativePresets[0].name = authoritativeName
        applyCollectionsResource(
          {
            revision: 201,
            collections: { [collectionName]: authoritativePresets },
          } as any,
          collectionName,
        )
        reapplyPendingPresetProjections()
        await tick()
        expect(input!.value).toBe(rejectedName)

        flushRegisteredPendingBridgePatches({})
        await waitForFetchCount(calls, 2)
        response.resolve(jsonResponse({ error: 'preset no longer exists' }, 404))

        await vi.waitFor(() => expect(input!.value).toBe(authoritativeName))
        expect(currentPresets()[0].name).toBe(authoritativeName)
        expect(consumerTarget.querySelector(`[data-risu-row-id="${presetId}"]`)?.textContent).toContain(
          authoritativeName,
        )
        expect(target.querySelector('[data-risu-preset-rename-status]')?.textContent).toContain(
          language.presetRenameFailed,
        )
        expect(alertSpies.alertError).toHaveBeenCalledWith(language.presetRenameFailed)
      } finally {
        unmount(consumer)
        consumerTarget.remove()
      }
    })
  })

  it('keeps a durably queued rename visible and marks it pending', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-prompt-rename',
      writerEpoch: 4,
      databaseLineage: 'lineage-prompt-rename',
      requestedWriterWasActive: true,
    })
    stubCommandFetch({
      promptPatchResponse: Promise.resolve(jsonResponse({ error: 'temporarily unavailable' }, 503)),
    })

    try {
      mountPresetPicker('global')
      elementBySelector<HTMLButtonElement>('[data-risu-preset-edit]', 'prompt preset edit button').click()
      await tick()

      const input = pickerRow('prompt', 'preset-a').querySelector<HTMLInputElement>('input')
      expect(input).toBeTruthy()
      input!.value = 'Queued prompt name'
      input!.dispatchEvent(new Event('input', { bubbles: true }))
      flushRegisteredPendingBridgePatches({})

      await vi.waitFor(() => expect(alertSpies.alertNormal).toHaveBeenCalledWith(language.presetRenameQueued))
      expect(target.querySelector('[data-risu-preset-rename-status]')).toBeNull()
      expect(input!.value).toBe('Queued prompt name')
      expect(getDatabase().promptPresets[0].name).toBe('Queued prompt name')
      expect(alertSpies.alertNormal).toHaveBeenCalledWith(language.presetRenameQueued)
      expect(await listPendingMutations()).toHaveLength(1)
    } finally {
      resetPendingPresetMutationsForTests()
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('stages the encrypted quick prompt rename intent before the network debounce', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-quick-preset-rename',
      writerEpoch: 3,
      databaseLineage: 'lineage-quick-preset-rename',
      requestedWriterWasActive: true,
    })
    const calls = stubCommandFetch()

    try {
      mountPresetPicker('global')
      elementBySelector<HTMLButtonElement>('[data-risu-preset-edit]', 'prompt preset edit button').click()
      await tick()

      const input = pickerRow('prompt', 'preset-a').querySelector<HTMLInputElement>('input')
      expect(input).toBeTruthy()
      input!.value = 'Crash-safe quick rename'
      input!.dispatchEvent(new Event('input', { bubbles: true }))

      expect(getDatabase().promptPresets[0].name).toBe('Crash-safe quick rename')
      expect(calls).toHaveLength(0)
      await vi.waitFor(async () => {
        expect((await listPendingMutations()).map((entry) => entry.intent)).toEqual([
          {
            version: 1,
            requests: [
              {
                method: 'PATCH',
                path: '/prompt-presets/preset-a',
                body: { patch: { name: 'Crash-safe quick rename' } },
              },
            ],
          },
        ])
      })

      flushRegisteredPendingBridgePatches({})
      await vi.waitFor(async () => {
        expect(await listPendingMutations()).toEqual([])
      })
    } finally {
      flushRegisteredPendingBridgePatches({})
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('names preset icon actions by target and exposes edit mode state', async () => {
    mountPresetPicker('global')

    const presetRow = pickerRow('prompt', 'preset-a')
    const select = pickerSelectionControl('prompt', 'preset-a')
    expect(presetRow.getAttribute('role')).toBeNull()
    expect(presetRow.getAttribute('tabindex')).toBeNull()
    expect(select).toBeInstanceOf(HTMLButtonElement)
    expect(presetRow.querySelector('button button, button input, button [role="button"]')).toBeNull()
    expect(presetRow.querySelector(`[aria-label="${language.duplicate}: Preset A"]`)).toBeTruthy()
    expect(presetRow.querySelector(`[aria-label="${language.export}: Preset A"]`)).toBeTruthy()
    expect(presetRow.querySelector(`[aria-label="${language.archivePromptPreset}: Preset A"]`)).toBeTruthy()
    expect(presetRow.querySelector(`[aria-label="${language.remove}: Preset A"]`)).toBeTruthy()
    expect(target.querySelector(`[aria-label="${language.add}: ${language.promptPresets}"]`)).toBeTruthy()
    expect(target.querySelector(`[aria-label="${language.import}: ${language.promptPresets}"]`)).toBeTruthy()

    const edit = elementBySelector<HTMLButtonElement>('[data-risu-preset-edit]', 'prompt preset edit button')
    expect(edit.getAttribute('aria-label')).toBe(`${language.edit}: ${language.promptPresets}`)
    expect(edit.getAttribute('aria-pressed')).toBe('false')
    edit.click()
    await tick()
    expect(edit.getAttribute('aria-pressed')).toBe('true')
  })

  it('duplicates a prompt preset with a fresh id and its hydrated prompt template', async () => {
    const source = getDatabase().promptPresets[0]
    source.promptTemplate = [
      {
        id: 'prompt-row-a',
        type: 'plain',
        type2: 'normal',
        name: 'Source row',
        text: 'Keep this prompt body',
        role: 'system',
      },
    ]
    const sourceSnapshot = safeStructuredClone(source)
    const calls = stubCommandFetch()
    const close = mountPresetPicker('global')

    const duplicateAction = pickerRow('prompt', 'preset-a').querySelector<HTMLButtonElement>(
      '[data-risu-preset-duplicate-action]',
    )
    expect(duplicateAction?.getAttribute('aria-label')).toBe(`${language.duplicate}: Preset A`)
    duplicateAction!.click()
    await tick()
    await waitForCommandFetches(calls)

    expect(getDatabase().promptPresets).toHaveLength(3)
    const duplicate = getDatabase().promptPresets[2]
    expect(duplicate.id).toEqual(expect.any(String))
    expect(duplicate.id).not.toBe(sourceSnapshot.id)
    expect(duplicate.name).toBe(language.presetCopyName('Preset A'))
    expect({ ...duplicate, id: sourceSnapshot.id, name: sourceSnapshot.name }).toEqual(sourceSnapshot)
    expect(duplicate.promptTemplate).not.toBe(source.promptTemplate)
    expect(getDatabase().promptPresetsId).toBe(0)
    expect(close).not.toHaveBeenCalled()
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/prompt-presets',
      method: 'POST',
      body: {
        baseRevision: 200,
        preset: duplicate,
      },
    })
  })

  it('does not expose prompt archive controls in the model preset picker', () => {
    mountPresetPicker('active-chat-generation-settings', vi.fn(), 'model')

    expect(target.querySelector('[data-risu-preset-archive-view]')).toBeNull()
    expect(target.querySelector('[data-risu-preset-archive-action]')).toBeNull()
  })

  it('uses immediate fallback sorting on every pointer type and moves by stable id', async () => {
    const presetC = {
      ...getDatabase().promptPresets[0],
      id: 'preset-c',
      name: 'Preset C',
    }
    getDatabase().promptPresets.push(presetC)
    mountPresetPicker('global')
    await tick()

    const options = promptPresetSortableOptions()
    expect(options).toMatchObject({
      delay: 0,
      delayOnTouchOnly: false,
      forceFallback: true,
      draggable: '[data-risu-preset-sortable-item]',
      handle: '[data-risu-preset-drag-handle]',
    })
    expect(pickerRow('prompt', 'preset-b').hasAttribute('draggable')).toBe(false)
    expect(pickerRow('prompt', 'preset-b').querySelector('[data-risu-preset-drag-handle]')).toBeTruthy()

    const [presetA, presetB] = getDatabase().promptPresets
    getDatabase().promptPresets = [presetB, presetC, presetA]
    await tick()

    finishPromptPresetSort('preset-b', 0, 2)

    expect(presetSpies.reorderPromptPresets).toHaveBeenCalledOnce()
    expect(presetSpies.reorderPromptPresets).toHaveBeenCalledWith(0, 3)
    expect(pickerRow('prompt', 'preset-b').previousElementSibling?.getAttribute('data-risu-preset-sort-anchor')).toBe(
      'preset-b',
    )
  })

  it('leaves external file drops for the app-level importer', () => {
    mountPresetPicker('global')
    const targetRow = pickerRow('prompt', 'preset-a')
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    targetRow.dispatchEvent(dragOver)
    targetRow.dispatchEvent(drop)

    expect(dragOver.defaultPrevented).toBe(false)
    expect(drop.defaultPrevented).toBe(false)
    expect(presetSpies.reorderPromptPresets).not.toHaveBeenCalled()
  })

  it('sorts a preset to the start of the list', async () => {
    const presetC = {
      ...getDatabase().promptPresets[0],
      id: 'preset-c',
      name: 'Preset C',
    }
    getDatabase().promptPresets.push(presetC)
    mountPresetPicker('global')
    await tick()

    finishPromptPresetSort('preset-c', 2, 0)

    expect(presetSpies.reorderPromptPresets).toHaveBeenCalledOnce()
    expect(presetSpies.reorderPromptPresets).toHaveBeenCalledWith(2, 0)
  })

  it('sorts a preset to the end of the list', async () => {
    const presetC = {
      ...getDatabase().promptPresets[0],
      id: 'preset-c',
      name: 'Preset C',
    }
    getDatabase().promptPresets.push(presetC)
    mountPresetPicker('global')
    await tick()

    finishPromptPresetSort('preset-a', 0, 2)

    expect(presetSpies.reorderPromptPresets).toHaveBeenCalledOnce()
    expect(presetSpies.reorderPromptPresets).toHaveBeenCalledWith(0, 3)
  })

  it('does not reorder another preset when the dragged preset vanishes', async () => {
    const presetC = {
      ...getDatabase().promptPresets[0],
      id: 'preset-c',
      name: 'Preset C',
    }
    getDatabase().promptPresets.push(presetC)
    mountPresetPicker('global')

    const vanishedRow = pickerRow('prompt', 'preset-b')
    const list = elementBySelector<HTMLElement>('[data-risu-preset-sortable-list]', 'prompt preset sortable list')

    getDatabase().promptPresets = getDatabase().promptPresets.filter((preset) => preset.id !== 'preset-b')
    await tick()

    promptPresetSortableOptions().onEnd({
      from: list,
      item: vanishedRow,
      oldDraggableIndex: 1,
      newDraggableIndex: 2,
    })

    expect(presetSpies.reorderPromptPresets).not.toHaveBeenCalled()
  })

  it('surfaces a rejected prompt-preset reorder', async () => {
    const presetC = {
      ...getDatabase().promptPresets[0],
      id: 'preset-c',
      name: 'Preset C',
    }
    getDatabase().promptPresets.push(presetC)
    presetSpies.reorderPromptPresets.mockResolvedValueOnce({ status: 'failed' })
    mountPresetPicker('global')
    await tick()

    finishPromptPresetSort('preset-a', 0, 2)
    await settleModalFocus()

    expect(target.querySelector('[data-risu-preset-mutation-status]')?.textContent).toContain(
      language.presetMutationFailed,
    )
    expect(alertSpies.alertError).toHaveBeenCalledWith(language.presetMutationFailed)
  })

  it('saves preset rows to the active chat without calling global preset selection', async () => {
    const calls = stubCommandFetch()
    const close = mountPresetPicker('active-chat-generation-settings')

    expect(pickerRoot('prompt', 'active-chat-generation-settings')).toBeTruthy()
    expect(pickerRow('prompt', 'preset-a').dataset.risuRowIndex).toBe('0')
    expect(pickerRow('prompt', 'preset-b').dataset.risuRowIndex).toBe('1')
    expectPickerRowSelection('prompt', 'preset-a', false)
    expectPickerRowSelection('prompt', 'preset-b', true)

    pickerSelectionControl('prompt', 'preset-a').click()
    await tick()
    await waitForCommandFetches(calls)

    expect(presetSpies.changeToPreset).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual({
      configured: true,
      personaId: 'persona-b',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {},
    })
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      authHeader: 'picker-generation-settings-token',
    })
    expect(calls[1].body).toEqual({
      baseRevision: 200,
      baseGenerationSettingsDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      patch: { promptPresetId: 'preset-a' },
    })
  })

  it('auto-applies a prompt recommended model preset when the chat has no manual model selection', async () => {
    getDatabase().promptPresets[0].recommendedModelPresetId = 'model-preset-b'
    const calls = stubCommandFetch()
    const close = mountPresetPicker('active-chat-generation-settings')

    pickerSelectionControl('prompt', 'preset-a').click()
    await tick()
    await waitForCommandFetches(calls)

    expect(close).toHaveBeenCalledOnce()
    expect(getDatabase().characters[0].chats[0].generationSettings).toMatchObject({
      promptPresetId: 'preset-a',
      modelPresetId: 'model-preset-b',
      modelPresetSelectionSource: 'prompt-recommendation',
    })
    expect(calls[1].body).toEqual({
      baseRevision: 200,
      baseGenerationSettingsDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      patch: {
        modelPresetId: 'model-preset-b',
        modelPresetSelectionSource: 'prompt-recommendation',
        promptPresetId: 'preset-a',
      },
    })
  })

  it('marks a model preset chosen from the active-chat picker as manual', async () => {
    const calls = stubCommandFetch()
    const close = mountPresetPicker('active-chat-generation-settings', vi.fn(), 'model')

    pickerSelectionControl('model', 'model-preset-b').click()
    await tick()
    await waitForCommandFetches(calls)

    expect(close).toHaveBeenCalledOnce()
    expect(getDatabase().characters[0].chats[0].generationSettings).toMatchObject({
      modelPresetId: 'model-preset-b',
      modelPresetSelectionSource: 'manual',
    })
    expect(calls[1].body).toEqual({
      baseRevision: 200,
      baseGenerationSettingsDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      patch: {
        modelPresetId: 'model-preset-b',
        modelPresetSelectionSource: 'manual',
      },
    })
  })

  it('keeps the preset picker open and reports a rejected active-chat save', async () => {
    stubCommandFetch({
      generationSettingsResponse: Promise.resolve(jsonResponse({ error: 'preset selection rejected' }, 400)),
    })
    const close = mountPresetPicker('active-chat-generation-settings')

    pickerSelectionControl('prompt', 'preset-a').click()

    await vi.waitFor(() =>
      expect(target.querySelector('[data-risu-preset-selection-status]')?.textContent).toContain(
        'preset selection rejected',
      ),
    )
    expect(alertSpies.alertError).toHaveBeenCalledWith(
      language.chatGenerationSettingsSaveFailed('preset selection rejected'),
    )
    expect(close).not.toHaveBeenCalled()
    expect(getDatabase().characters[0].chats[0].generationSettings?.promptPresetId).toBe('preset-b')
    expectPickerRowSelection('prompt', 'preset-a', false)
    expectPickerRowSelection('prompt', 'preset-b', true)
  })

  it('keeps global preset rows on changeToPreset in global mode', async () => {
    const calls = stubCommandFetch()
    const close = mountPresetPicker('global')

    expect(pickerRoot('prompt', 'global')).toBeTruthy()
    expectPickerRowSelection('prompt', 'preset-a', true)
    expectPickerRowSelection('prompt', 'preset-b', false)

    pickerSelectionControl('prompt', 'preset-b').click()
    await tick()
    await waitForCommandFetches(calls)

    expect(close).toHaveBeenCalledOnce()
    expect(getDatabase().promptPresetsId).toBe(1)
    expect(getDatabase().characters[0].chats[0].generationSettings?.promptPresetId).toBe('preset-b')
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/prompt-presets/select',
      method: 'POST',
      authHeader: 'picker-generation-settings-token',
      body: {
        baseRevision: 200,
        promptPresetId: 'preset-b',
      },
    })
  })

  describe.each(['model', 'prompt'] as const)('global %s preset selection persistence', (kind) => {
    it('keeps the picker open and busy until the exact selection is accepted', async () => {
      const response = createDeferred<Response>()
      const calls = stubCommandFetch(
        kind === 'model' ? { modelSelectResponse: response.promise } : { promptSelectResponse: response.promise },
      )
      const close = mountPresetPicker('global', vi.fn(), kind)

      globalPresetSelectionControl(kind).click()
      await tick()
      await waitForFetchCount(calls, 2)

      expect(close).not.toHaveBeenCalled()
      expect(target.querySelector('[data-risu-preset-selection-status]')).toBeNull()

      response.resolve(presetSelectionSuccess(kind))
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
      expect(kind === 'model' ? getDatabase().modelPresetsId : getDatabase().promptPresetsId).toBe(1)
    })

    it('acknowledges a durably queued selection before closing', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory())
      resetPendingMutationOutboxForTests()
      await preparePendingMutationOutbox({
        writerSessionId: `writer-${kind}-selection`,
        writerEpoch: 3,
        databaseLineage: `lineage-${kind}-selection`,
        requestedWriterWasActive: true,
      })
      stubCommandFetch(
        kind === 'model'
          ? { modelSelectResponse: Promise.resolve(jsonResponse({ error: 'temporarily_unavailable' }, 503)) }
          : { promptSelectResponse: Promise.resolve(jsonResponse({ error: 'temporarily_unavailable' }, 503)) },
      )

      try {
        const close = mountPresetPicker('global', vi.fn(), kind)
        globalPresetSelectionControl(kind).click()

        await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
        expect(alertSpies.alertNormal).toHaveBeenCalledWith(language.presetSelectionQueued)
        expect(kind === 'model' ? getDatabase().modelPresetsId : getDatabase().promptPresetsId).toBe(1)
        expect(await listPendingMutations()).toHaveLength(1)
      } finally {
        resetPendingPresetMutationsForTests()
        await clearPendingMutationOutbox()
        resetPendingMutationOutboxForTests()
      }
    })

    it('keeps the picker open and shows the restored selection after terminal rejection', async () => {
      stubCommandFetch(
        kind === 'model'
          ? { modelSelectResponse: Promise.resolve(jsonResponse({ error: 'invalid_selection' }, 400)) }
          : { promptSelectResponse: Promise.resolve(jsonResponse({ error: 'invalid_selection' }, 400)) },
      )
      const close = mountPresetPicker('global', vi.fn(), kind)

      globalPresetSelectionControl(kind).click()
      await vi.waitFor(() => {
        expect(target.querySelector('[data-risu-preset-selection-status]')?.textContent).toContain(
          language.presetSelectionFailed,
        )
      })

      expect(close).not.toHaveBeenCalled()
      expect(alertSpies.alertError).toHaveBeenCalledWith(language.presetSelectionFailed)
      expect(kind === 'model' ? getDatabase().modelPresetsId : getDatabase().promptPresetsId).toBe(0)
      if (kind === 'prompt') {
        expectPickerRowSelection('prompt', 'preset-a', true)
        expectPickerRowSelection('prompt', 'preset-b', false)
      } else {
        const rows = target.querySelectorAll<HTMLElement>('section [role="button"][tabindex="0"]')
        expect(rows[0].classList.contains('bg-selected')).toBe(true)
        expect(rows[1].classList.contains('bg-selected')).toBe(false)
      }
    })
  })

  it('retries global prompt preset selection once after a revision conflict', async () => {
    const calls = stubCommandFetch({ promptSelectConflictOnce: true })
    const close = mountPresetPicker('global')

    pickerSelectionControl('prompt', 'preset-b').click()
    await tick()
    await waitForFetchCount(calls, 3)

    expect(close).toHaveBeenCalledOnce()
    expect(getDatabase().promptPresetsId).toBe(1)
    const selectCalls = calls.filter((call) => call.url.endsWith('/prompt-presets/select'))
    expect(selectCalls).toHaveLength(2)
    expect(selectCalls[0].body).toMatchObject({
      baseRevision: 200,
      promptPresetId: 'preset-b',
    })
    expect(selectCalls[1].body).toMatchObject({
      baseRevision: 201,
      promptPresetId: 'preset-b',
    })
  })

  it('suppresses a duplicate prompt selection while the exact command is pending', async () => {
    getDatabase().promptPresets.push({
      id: 'preset-c',
      name: 'Preset C',
      mainPrompt: '',
      jailbreak: '',
      globalNote: '',
      temperature: 0,
      maxContext: 0,
      maxResponse: 0,
      frequencyPenalty: 0,
      PresensePenalty: 0,
      formatingOrder: [],
      promptPreprocess: false,
      bias: [],
      ooba: {},
      ainconfig: {},
      customPromptTemplateToggle: '',
    } as any)

    const calls: CapturedFetch[] = []
    const presetBResponse = createDeferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const headers = init.headers as Record<string, string> | undefined
        const url = String(input)
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: headers?.['risu-auth'] ?? null,
          body,
          keepalive: init.keepalive === true,
        })

        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 200 })
        if (url.endsWith('/prompt-presets/select') && body?.promptPresetId === 'preset-b') {
          return presetBResponse.promise
        }
        if (url.endsWith('/prompt-presets/select') && body?.promptPresetId === 'preset-c') {
          return jsonResponse({
            status: 'ok',
            revision: 201,
            event: {
              type: 'promptPreset.selected',
              revision: 201,
              resource: 'promptPreset',
              id: 'preset-c',
            },
            promptPresetId: 'preset-c',
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    const close = mountPresetPicker('global')
    pickerSelectionControl('prompt', 'preset-b').click()
    await tick()
    await waitForFetchCount(calls, 2)

    pickerSelectionControl('prompt', 'preset-c').click()
    await tick()
    expect(calls).toHaveLength(2)
    expect(getDatabase().promptPresetsId).toBe(1)
    expect(close).not.toHaveBeenCalled()

    presetBResponse.resolve(presetSelectionSuccess('prompt'))
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())

    const selectCalls = calls.filter((call) => call.url.endsWith('/prompt-presets/select'))
    expect(selectCalls.map((call) => (call.body as { promptPresetId?: string }).promptPresetId)).toEqual(['preset-b'])
    expect(getDatabase().promptPresetsId).toBe(1)
  })

  it('deletes the confirmed preset by stable id after the list reorders', async () => {
    const confirmation = createDeferred<boolean>()
    const deleteResponse = createDeferred<Response>()
    alertSpies.alertConfirm.mockReturnValue(confirmation.promise)
    stubCommandFetch({ promptDeleteResponse: deleteResponse.promise })
    mountPresetPicker('global')

    const deleteButton = pickerRow('prompt', 'preset-b')
      .querySelector<SVGElement>('svg.lucide-trash')
      ?.closest('button')
    expect(deleteButton).toBeTruthy()
    deleteButton!.click()
    await tick()
    expect(alertSpies.alertConfirm).toHaveBeenCalledOnce()

    const [presetA, presetB] = getDatabase().promptPresets
    getDatabase().promptPresets = [presetB, presetA]
    getDatabase().promptPresetsId = 1
    await tick()

    confirmation.resolve(true)
    await tick()
    await Promise.resolve()

    expect(getDatabase().promptPresets.map((preset) => preset.id)).toEqual(['preset-a'])
    expect(target.querySelector('[data-risu-row-id="preset-b"]')).toBeNull()
    expect(pickerRow('prompt', 'preset-a')).toBeTruthy()

    deleteResponse.resolve(jsonResponse({ error: 'test cleanup' }, 500))
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })

  it('restores the synchronous quick rename when a slow prompt preset delete fails', async () => {
    const deleteResponse = createDeferred<Response>()
    alertSpies.alertConfirm.mockResolvedValue(true)
    const calls = stubCommandFetch({ promptDeleteResponse: deleteResponse.promise })
    mountPresetPicker('global')

    elementBySelector<HTMLButtonElement>('[data-risu-preset-edit]', 'prompt preset edit button').click()
    await tick()

    const row = pickerRow('prompt', 'preset-b')
    const input = row.querySelector<HTMLInputElement>('input')
    const deleteButton = row.querySelector<SVGElement>('svg.lucide-trash')?.closest('button')
    expect(input).toBeTruthy()
    expect(deleteButton).toBeTruthy()
    input!.value = 'Preset B renamed before delete'
    input!.dispatchEvent(new Event('input', { bubbles: true }))

    expect(getDatabase().promptPresets[1].name).toBe('Preset B renamed before delete')
    deleteButton!.click()
    await waitForFetchCount(calls, 3)
    await tick()
    expect(getDatabase().promptPresets.map((preset) => preset.id)).toEqual(['preset-a'])

    deleteResponse.resolve(jsonResponse({ error: 'slow delete failed' }, 500))
    await vi.waitFor(() => {
      expect(getDatabase().promptPresets.find((preset) => preset.id === 'preset-b')).toMatchObject({
        name: 'Preset B renamed before delete',
      })
    })
  })

  it('saves persona rows to the active chat without calling global persona selection', async () => {
    const calls = stubCommandFetch()
    const close = mountPersonaPicker('active-chat-generation-settings')

    expect(pickerRoot('persona', 'active-chat-generation-settings')).toBeTruthy()
    expect(pickerRow('persona', 'persona-a').dataset.risuRowIndex).toBe('0')
    expect(pickerRow('persona', 'persona-b').dataset.risuRowIndex).toBe('1')
    expectPickerRowSelection('persona', 'persona-a', false)
    expectPickerRowSelection('persona', 'persona-b', true)

    pickerRow('persona', 'persona-a').click()
    await tick()
    await waitForCommandFetches(calls)

    expect(personaSpies.changeUserPersonaWithOutcome).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual({
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-b',
      jailbreakToggle: false,
      sidebarToggles: {},
    })
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      authHeader: 'picker-generation-settings-token',
    })
    expect(calls[1].body).toEqual({
      baseRevision: 200,
      baseGenerationSettingsDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      patch: { personaId: 'persona-a' },
    })
  })

  it('keeps the persona picker open and reports a rejected active-chat save', async () => {
    stubCommandFetch({
      generationSettingsResponse: Promise.resolve(jsonResponse({ error: 'persona selection rejected' }, 400)),
    })
    const close = mountPersonaPicker('active-chat-generation-settings')

    pickerRow('persona', 'persona-a').click()

    await vi.waitFor(() =>
      expect(target.querySelector('[role="alert"]')?.textContent).toContain('persona selection rejected'),
    )
    expect(alertSpies.alertError).toHaveBeenCalledWith(
      language.chatGenerationSettingsSaveFailed('persona selection rejected'),
    )
    expect(close).not.toHaveBeenCalled()
    expect(getDatabase().characters[0].chats[0].generationSettings?.personaId).toBe('persona-b')
    expectPickerRowSelection('persona', 'persona-a', false)
    expectPickerRowSelection('persona', 'persona-b', true)
  })

  it('keeps global persona rows on changeUserPersona in global mode', async () => {
    const calls = stubCommandFetch()
    const close = mountPersonaPicker('global')

    expect(pickerRoot('persona', 'global')).toBeTruthy()
    expectPickerRowSelection('persona', 'persona-a', true)
    expectPickerRowSelection('persona', 'persona-b', false)

    pickerRow('persona', 'persona-b').click()
    await tick()

    expect(personaSpies.changeUserPersonaWithOutcome).toHaveBeenCalledWith(1)
    expect(close).toHaveBeenCalledOnce()
    expect(getDatabase().characters[0].chats[0].generationSettings?.personaId).toBe('persona-b')
    expect(calls).toEqual([])
  })
})
