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

function moduleRowNames() {
  return Array.from(target.querySelectorAll('span.text-lg')).map((span) =>
    span.textContent?.trim(),
  )
}

function rowForModuleName(name: string) {
  const label = Array.from(target.querySelectorAll('span.text-lg')).find(
    (candidate) => candidate.textContent?.trim() === name,
  )
  expect(label, `module row ${name}`).toBeTruthy()
  return label!.closest('div.pl-3') as HTMLElement
}

async function updateSearch(value: string) {
  const input = target.querySelector(`input[placeholder="${language.search}"]`) as
    | HTMLInputElement
    | null
  expect(input).toBeTruthy()
  input!.value = value
  input!.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}

async function clickFooterCreate() {
  const buttons = Array.from(target.querySelectorAll('button'))
  const createButton = buttons[buttons.length - 3]
  expect(createButton).toBeTruthy()
  createButton.click()
  await tick()
}

async function clickButtonText(text: string) {
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === text,
  )
  expect(button, `button ${text}`).toBeTruthy()
  button!.click()
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

    expect(moduleRowNames()).toEqual([
      'Alpha Module',
      'beta Module',
      'MCP Tools',
      'zulu module',
    ])
  })

  it('L43: ModuleSettings filtered rows keep action targets by module id', async () => {
    alertSpies.alertConfirm.mockResolvedValueOnce(true)
    mountSettings()
    await updateSearch('BETA')

    expect(moduleRowNames()).toEqual(['beta Module'])

    const betaRow = rowForModuleName('beta Module')
    const [enableBeta, exportBeta, , deleteBeta] = Array.from(betaRow.querySelectorAll('button'))
    expect(enableBeta.className).toContain('text-amber-500')

    enableBeta.click()
    await tick()
    expect(moduleCommandSpies.setGlobalModuleEnabled).toHaveBeenCalledWith('beta-id', true)

    exportBeta.click()
    await tick()
    expect(moduleProcessSpies.exportModule).toHaveBeenCalledWith(DBState.db.modules[2])

    deleteBeta.click()
    await tick()
    await Promise.resolve()
    expect(moduleCommandSpies.deleteGlobalModule).toHaveBeenCalledWith('beta-id')
  })

  it('L43: ModuleSettings edit after filtering saves the original module id', async () => {
    mountSettings()
    await updateSearch('beta')

    const betaRow = rowForModuleName('beta Module')
    const [, , editBeta] = Array.from(betaRow.querySelectorAll('button'))
    editBeta.click()
    await tick()

    await clickButtonText(language.editModule)

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
    expect(readCounter.count).toBe(DBState.db.modules.length)

    readCounter.count = 0
    await clickFooterCreate()
    await clickButtonText(language.createModule)
    expect(readCounter.count).toBe(1)
  })
})
