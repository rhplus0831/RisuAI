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
  createGlobalModule: vi.fn(),
  deleteGlobalModule: vi.fn(),
  setGlobalModuleEnabled: vi.fn(),
  updateGlobalModule: vi.fn(),
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
  importMCPModule: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => moduleProcessSpies)
vi.mock('src/ts/moduleCommands', () => moduleCommandSpies)
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
import { DBState } from 'src/ts/stores.svelte'
import type { RisuModule } from 'src/ts/process/modules'

type MountedComponent = Parameters<typeof unmount>[0]

interface NameReadCounter {
  count: number
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
  DBState.db = {
    characters: [],
    enabledModules: ['alpha-id'],
    language: 'en',
    loreBook: [],
    moduleIntergration: 'shared, trimmed',
    modules: [
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
    ],
    showDeprecatedTriggerV1: false,
    useAdditionalAssetsPreview: false,
  } as any
}

function mountSettings() {
  component = mount(ModuleSettings, { target })
}

function moduleRows() {
  return Array.from(target.querySelectorAll<HTMLElement>('[data-risu-module-row]'))
}

function moduleRowNames() {
  return moduleRows().map((row) =>
    row.querySelector('[data-risu-module-name]')?.textContent?.trim(),
  )
}

function rowForModuleId(moduleId: string) {
  const row = moduleRows().find(
    (candidate) => candidate.getAttribute('data-risu-row-id') === moduleId,
  )
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

async function updateSearch(value: string) {
  const input = target.querySelector(
    `input[placeholder="${language.search}"]`,
  ) as HTMLInputElement | null
  expect(input).toBeTruthy()
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
    expect(moduleProcessSpies.exportModule).toHaveBeenCalledWith(DBState.db.modules[2])

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

  it('L43: ModuleSettings search recomputes sorted rows once per search edit and reuses them across view switches', async () => {
    const readCounter = { count: 0 }
    seedModules(readCounter)
    mountSettings()

    readCounter.count = 0
    await updateSearch('ALPHA')
    expect(readCounter.count).toBe(DBState.db.modules.length + moduleRows().length)

    readCounter.count = 0
    await clickModuleSurfaceAction('create')
    await clickModuleSurfaceAction('submit-create')
    expect(readCounter.count).toBe(moduleRows().length)
  })
})
