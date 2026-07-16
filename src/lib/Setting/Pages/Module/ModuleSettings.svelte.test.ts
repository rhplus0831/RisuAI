import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const moduleProcessSpies = vi.hoisted(() => ({
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
  refreshModules: vi.fn(),
}))

const moduleCommandSpies = vi.hoisted(() => ({
  createGlobalModule: vi.fn(async (): Promise<any> => null),
  deleteGlobalModule: vi.fn(),
  setGlobalModuleEnabled: vi.fn(),
  updateGlobalModule: vi.fn(async (): Promise<any> => null),
}))

const alertSpies = vi.hoisted(() => ({
  alertConfirm: vi.fn(async () => false),
  alertError: vi.fn(),
  alertMd: vi.fn(),
  alertNormal: vi.fn(),
}))

const globalApiSpies = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  getFileSrc: vi.fn(async () => ''),
  openURL: vi.fn(),
  saveAsset: vi.fn(async () => ''),
}))

const mcpSpies = vi.hoisted(() => ({
  importMCPModule: vi.fn(async () => {}),
}))

vi.mock('src/ts/process/modules', () => moduleProcessSpies)
vi.mock('src/ts/moduleCommands', async (importActual) => ({
  ...(await importActual<typeof import('src/ts/moduleCommands')>()),
  ...moduleCommandSpies,
}))
vi.mock('src/ts/alert', () => alertSpies)
vi.mock('src/ts/globalApi.svelte', () => globalApiSpies)
vi.mock('src/ts/process/mcp/mcp', () => mcpSpies)
vi.mock('src/ts/gui/tooltip', () => ({
  tooltip: () => ({
    destroy: vi.fn(),
    update: vi.fn(),
  }),
}))
vi.mock('src/ts/server/commands', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/server/commands')>()
  return {
    ...actual,
    canUseServerCommands: vi.fn(() => false),
  }
})

import ModuleSettings from './ModuleSettings.svelte'
import { language } from 'src/lang'
import type { RisuModule } from 'src/ts/process/modules'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

interface NameReadCounter {
  count: number
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

interface ModuleFixtureOptions {
  id: string
  name: string
  description?: string
  namespace?: string
  mcp?: RisuModule['mcp']
  readCounter?: NameReadCounter
}

let target: HTMLElement
let component: MountedComponent | undefined

function makeModule(options: ModuleFixtureOptions): RisuModule {
  let currentName = options.name
  const module: Record<string, unknown> = {
    id: options.id,
    description: options.description ?? `${options.name} description`,
    namespace: options.namespace,
    mcp: options.mcp,
  }

  Object.defineProperty(module, 'name', {
    configurable: true,
    enumerable: true,
    get() {
      options.readCounter && (options.readCounter.count += 1)
      return currentName
    },
    set(value: string) {
      currentName = value
    },
  })

  return module as unknown as RisuModule
}

function seedModules(readCounter?: NameReadCounter) {
  const modules = [
    makeModule({
      id: 'zulu-id',
      name: 'zulu module',
      readCounter,
    }),
    makeModule({
      id: 'alpha-id',
      name: 'Alpha Module',
      readCounter,
    }),
    makeModule({
      id: 'beta-id',
      name: 'beta Module',
      namespace: 'shared',
      readCounter,
    }),
    makeModule({
      id: 'mcp-id',
      name: 'MCP Tools',
      mcp: { url: 'https://example.test/mcp' },
      readCounter,
    }),
  ]
  setDatabaseLite({
    characters: [],
    enabledModules: ['alpha-id'],
    language: 'en',
    loreBook: [],
    moduleIntergration: 'shared, trimmed',
    modules: [],
    showDeprecatedTriggerV1: false,
    useAdditionalAssetsPreview: false,
  } as any)
  getDatabase().modules = modules
}

function mountSettings() {
  component = mount(ModuleSettings, { target })
}

function moduleRows() {
  return Array.from(target.querySelectorAll<HTMLElement>('[data-risu-module-row]'))
}

function moduleRowNames() {
  return moduleRows().map((row) => row.querySelector('[data-risu-module-name]')?.textContent?.trim())
}

function rowForModuleId(moduleId: string) {
  const row = moduleRows().find((candidate) => candidate.getAttribute('data-risu-row-id') === moduleId)
  expect(row, `module row ${moduleId}`).toBeTruthy()
  return row!
}

function moduleAction(moduleId: string, actionKind: string) {
  const action = rowForModuleId(moduleId).querySelector<HTMLButtonElement>(
    `button[data-risu-module-action="${actionKind}"]`,
  )
  expect(action, `module ${moduleId} action ${actionKind}`).toBeTruthy()
  return action!
}

function moduleSurfaceAction(actionKind: string) {
  const actionRoot = target.querySelector<HTMLElement>(`[data-risu-module-action="${actionKind}"]`)
  expect(actionRoot, `module surface action ${actionKind}`).toBeTruthy()
  if (actionRoot instanceof HTMLButtonElement) return actionRoot

  const button = actionRoot!.querySelector<HTMLButtonElement>('button')
  expect(button, `module surface action ${actionKind} button`).toBeTruthy()
  return button!
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === text,
  )
  expect(button, `button ${text}`).toBeTruthy()
  return button!
}

async function updateSearch(value: string) {
  const input = target.querySelector(`input[placeholder="${language.search}"]`) as HTMLInputElement | null
  expect(input).toBeTruthy()
  input!.value = value
  input!.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}

async function updateModuleName(value: string) {
  const input = target.querySelector<HTMLInputElement>('input[type="text"]')
  expect(input, 'module name input').toBeTruthy()
  input!.value = value
  input!.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}

async function clickModuleSurfaceAction(actionKind: string) {
  moduleSurfaceAction(actionKind).click()
  await tick()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  vi.clearAllMocks()
  alertSpies.alertConfirm.mockResolvedValue(false)
  seedModules()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
})

describe('ModuleSettings derived module rows', () => {
  it('names module actions and exposes their enabled state', () => {
    mountSettings()

    expect(moduleAction('alpha-id', 'toggle-enabled').getAttribute('aria-label')).toBe(
      `${language.enableGlobal}: Alpha Module`,
    )
    expect(moduleAction('alpha-id', 'toggle-enabled').getAttribute('aria-pressed')).toBe('true')
    expect(moduleAction('beta-id', 'toggle-enabled').getAttribute('aria-pressed')).toBe('false')
    expect(moduleAction('beta-id', 'export').getAttribute('aria-label')).toBe(`${language.download}: beta Module`)
    expect(moduleAction('beta-id', 'edit').getAttribute('aria-label')).toBe(`${language.edit}: beta Module`)
    expect(moduleAction('beta-id', 'delete').getAttribute('aria-label')).toBe(`${language.remove}: beta Module`)
    expect(moduleAction('mcp-id', 'export').disabled).toBe(true)
    expect(moduleAction('mcp-id', 'edit').disabled).toBe(true)
    expect(moduleSurfaceAction('create').getAttribute('aria-label')).toBe(language.createModule)
    expect(moduleSurfaceAction('import-mcp').getAttribute('aria-label')).toBe(`${language.import}: MCP`)
    expect(moduleSurfaceAction('import').getAttribute('aria-label')).toBe(`${language.import}: ${language.module}`)
  })

  it('disables MCP import while its persistence outcome is pending', async () => {
    const importing = createDeferred<void>()
    mcpSpies.importMCPModule.mockReturnValue(importing.promise)
    mountSettings()
    const action = moduleSurfaceAction('import-mcp')

    action.click()
    action.click()
    await tick()

    expect(mcpSpies.importMCPModule).toHaveBeenCalledOnce()
    expect(action.disabled).toBe(true)
    expect(action.getAttribute('aria-busy')).toBe('true')

    importing.resolve()
    await tick()
    expect(action.disabled).toBe(false)
    expect(action.getAttribute('aria-busy')).toBe('false')
  })

  it('uses the localized fallback for a module without a description', () => {
    getDatabase().modules[2].description = ''
    mountSettings()

    expect(target.textContent).toContain(language.noModuleDescription)
  })

  it('names module lorebook actions', async () => {
    mountSettings()
    moduleAction('alpha-id', 'edit').click()
    await tick()
    buttonByText(language.loreBook).click()
    await tick()

    const labels = Array.from(target.querySelectorAll<HTMLButtonElement>('button'), (button) =>
      button.getAttribute('aria-label'),
    )
    expect(labels).toContain(`${language.add}: ${language.loreBook}`)
    expect(labels).toContain(`${language.export}: ${language.loreBook}`)
    expect(labels).toContain(`${language.add}: ${language.folderName}`)
    expect(labels).toContain(`${language.import}: ${language.loreBook}`)
  })

  it('L43: ModuleSettings empty search shows every module in lowercase sorted order', () => {
    mountSettings()

    expect(moduleRowNames()).toEqual(['Alpha Module', 'beta Module', 'MCP Tools', 'zulu module'])
  })

  it('L43: ModuleSettings filtered rows keep action targets by module id', async () => {
    alertSpies.alertConfirm.mockResolvedValueOnce(true)
    mountSettings()
    await updateSearch('BETA')

    expect(moduleRowNames()).toEqual(['beta Module'])

    const betaRow = rowForModuleId('beta-id')
    expect(betaRow.getAttribute('data-risu-enabled')).toBe('false')
    expect(betaRow.getAttribute('data-risu-integration-state')).toBe('integrated')

    moduleAction('beta-id', 'toggle-enabled').click()
    await tick()
    expect(moduleCommandSpies.setGlobalModuleEnabled).toHaveBeenCalledWith('beta-id', true)

    moduleAction('beta-id', 'export').click()
    await tick()
    expect(moduleProcessSpies.exportModule).toHaveBeenCalledWith(getDatabase().modules[2])

    moduleAction('beta-id', 'delete').click()
    await tick()
    await Promise.resolve()
    expect(moduleCommandSpies.deleteGlobalModule).toHaveBeenCalledWith('beta-id')
  })

  it('L43: ModuleSettings edit after filtering saves the original module id', async () => {
    mountSettings()
    await updateSearch('beta')

    moduleAction('beta-id', 'edit').click()
    await tick()

    await clickModuleSurfaceAction('submit-edit')

    expect(moduleCommandSpies.updateGlobalModule).toHaveBeenCalledOnce()
    expect(moduleCommandSpies.updateGlobalModule).toHaveBeenCalledWith(
      'beta-id',
      expect.objectContaining({
        id: 'beta-id',
        name: 'beta Module',
      }),
    )
  })

  it('rebases an edit onto the latest module without overwriting untouched remote fields', async () => {
    mountSettings()
    moduleAction('alpha-id', 'edit').click()
    await tick()
    await updateModuleName('Locally renamed module')

    getDatabase().modules = getDatabase().modules.map((candidate) =>
      candidate.id === 'alpha-id'
        ? {
            ...candidate,
            description: 'Description changed remotely',
            cjs: 'remote module code',
          }
        : candidate,
    )
    await tick()

    await clickModuleSurfaceAction('submit-edit')

    expect(moduleCommandSpies.updateGlobalModule).toHaveBeenCalledOnce()
    expect(moduleCommandSpies.updateGlobalModule).toHaveBeenCalledWith(
      'alpha-id',
      expect.objectContaining({
        id: 'alpha-id',
        name: 'Locally renamed module',
        description: 'Description changed remotely',
        cjs: 'remote module code',
      }),
    )
  })

  it('saves Background Embedding textarea edits with the module draft', async () => {
    mountSettings()

    moduleAction('alpha-id', 'edit').click()
    await tick()

    buttonByText(language.regexScript).click()
    await tick()

    const textarea = target.querySelector<HTMLTextAreaElement>(`textarea[placeholder="${language.backgroundHTML}"]`)
    expect(textarea).toBeTruthy()
    textarea!.value = '<style>.chattext .name { color: red; }</style>'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    await clickModuleSurfaceAction('submit-edit')

    expect(moduleCommandSpies.updateGlobalModule).toHaveBeenCalledOnce()
    expect(moduleCommandSpies.updateGlobalModule).toHaveBeenCalledWith(
      'alpha-id',
      expect.objectContaining({
        id: 'alpha-id',
        backgroundEmbedding: '<style>.chattext .name { color: red; }</style>',
      }),
    )
  })

  it('L43: ModuleSettings search recomputes sorted rows once per search edit and reuses them across view switches', async () => {
    const readCounter = { count: 0 }
    seedModules(readCounter)
    mountSettings()

    readCounter.count = 0
    await updateSearch('ALPHA')
    expect(readCounter.count).toBe(getDatabase().modules.length)

    readCounter.count = 0
    await clickModuleSurfaceAction('create')
    await updateModuleName('New Module')
    await clickModuleSurfaceAction('submit-create')
    expect(readCounter.count).toBe(moduleRows().length)
  })

  it.each([
    ['empty', ''],
    ['whitespace-only', '  \t  '],
  ])('rejects a %s module name during creation', async (_case, name) => {
    mountSettings()
    await clickModuleSurfaceAction('create')
    await updateModuleName(name)

    await clickModuleSurfaceAction('submit-create')

    expect(moduleCommandSpies.createGlobalModule).not.toHaveBeenCalled()
    expect(alertSpies.alertError).toHaveBeenCalledOnce()
    expect(alertSpies.alertError).toHaveBeenCalledWith(language.errors.emptyText)
    expect(target.textContent).toContain(language.createModule)
  })

  it('keeps and unlocks a create draft when the server rejects the save', async () => {
    const save = createDeferred<any>()
    moduleCommandSpies.createGlobalModule.mockReturnValueOnce(save.promise)
    mountSettings()
    await clickModuleSurfaceAction('create')
    await updateModuleName('Unsaved module')

    moduleSurfaceAction('submit-create').click()
    await tick()

    const fieldset = target.querySelector<HTMLFieldSetElement>('fieldset')
    const nameInput = target.querySelector<HTMLInputElement>('input[type="text"]')
    expect(fieldset?.disabled).toBe(true)
    expect(nameInput?.closest<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true)
    expect(moduleSurfaceAction('submit-create').disabled).toBe(true)
    expect(target.textContent).toContain(language.moduleSave.saving)

    save.resolve({ status: 'error', error: 'disk full' })
    await save.promise
    await tick()

    expect(target.textContent).toContain(language.createModule)
    expect(target.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('Unsaved module')
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('disk full')
    expect(target.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(false)
    expect(moduleSurfaceAction('submit-create').disabled).toBe(false)
  })

  it('keeps an edit draft open when the server reports a revision conflict', async () => {
    const save = createDeferred<any>()
    moduleCommandSpies.updateGlobalModule.mockReturnValueOnce(save.promise)
    mountSettings()
    moduleAction('alpha-id', 'edit').click()
    await tick()
    await updateModuleName('Draft rename')

    moduleSurfaceAction('submit-edit').click()
    await tick()
    expect(target.textContent).toContain(language.editModule)
    expect(moduleSurfaceAction('submit-edit').disabled).toBe(true)

    save.resolve({ status: 'conflict', currentRevision: 42 })
    await save.promise
    await tick()

    expect(target.textContent).toContain(language.editModule)
    expect(target.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('Draft rename')
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(language.moduleSave.commandConflict)
    expect(moduleSurfaceAction('submit-edit').disabled).toBe(false)
  })

  it('keeps an edit draft when its source module disappeared before save', async () => {
    mountSettings()
    moduleAction('alpha-id', 'edit').click()
    await tick()
    await updateModuleName('Recovered draft')
    getDatabase().modules = getDatabase().modules.filter((candidate) => candidate.id !== 'alpha-id')

    await clickModuleSurfaceAction('submit-edit')

    expect(moduleCommandSpies.updateGlobalModule).not.toHaveBeenCalled()
    expect(target.textContent).toContain(language.editModule)
    expect(target.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('Recovered draft')
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(language.moduleSave.editTargetMissing)
  })

  it('keeps a create draft when module commands are unavailable', async () => {
    moduleCommandSpies.createGlobalModule.mockResolvedValueOnce({ status: 'unavailable' })
    mountSettings()
    await clickModuleSurfaceAction('create')
    await updateModuleName('Offline draft')

    await clickModuleSurfaceAction('submit-create')

    expect(target.textContent).toContain(language.createModule)
    expect(target.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('Offline draft')
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(language.moduleSave.commandUnavailable)
  })

  it('closes the editor only after a module save succeeds', async () => {
    const save = createDeferred<any>()
    moduleCommandSpies.createGlobalModule.mockReturnValueOnce(save.promise)
    mountSettings()
    await clickModuleSurfaceAction('create')
    await updateModuleName('Saved module')

    moduleSurfaceAction('submit-create').click()
    await tick()
    expect(target.textContent).toContain(language.createModule)

    save.resolve({
      status: 'ok',
      revision: 11,
      event: { type: 'module.created', revision: 11, resource: 'module' },
    })
    await save.promise
    await tick()

    expect(target.textContent).toContain(language.modules)
    expect(target.textContent).not.toContain(language.moduleSave.saving)
    expect(target.querySelector('[data-risu-module-action="submit-create"]')).toBeNull()
  })
})
