import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockPluginUpdateCheckResult =
  | { status: 'available'; update: { version: string; updateURL: string } }
  | { status: 'up-to-date' | 'denied' | 'failed' }
type MockPluginUpdateInstallResult = 'installed' | 'denied' | 'failed' | 'stale'

const pluginSettingsMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(async () => false),
  alertSelect: vi.fn(),
  checkPluginUpdate: vi.fn<() => Promise<MockPluginUpdateCheckResult>>(async () => ({ status: 'up-to-date' })),
  installPluginUpdate: vi.fn<() => Promise<MockPluginUpdateInstallResult>>(async () => 'installed'),
  setPluginArgument: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
  getModules: () => [],
  getModuleLorebooks: () => [],
  getModuleTriggers: () => [],
  moduleUpdate: () => {},
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: pluginSettingsMocks.alertConfirm,
  alertMd: vi.fn(),
  alertSelect: pluginSettingsMocks.alertSelect,
}))

vi.mock('src/ts/plugins/plugins.svelte', () => ({
  checkPluginUpdate: pluginSettingsMocks.checkPluginUpdate,
  createBlankPlugin: vi.fn(),
  importPlugin: vi.fn(),
  installPluginUpdate: pluginSettingsMocks.installPluginUpdate,
  loadPlugins: vi.fn(),
}))

vi.mock('src/ts/pluginCommands', () => ({
  deletePlugin: vi.fn(),
  mergePendingPluginStorageResource: vi.fn((value) => value),
  setPluginArgument: pluginSettingsMocks.setPluginArgument,
  togglePluginEnabled: vi.fn(),
}))

import PluginSettings from './PluginSettings.svelte'
import { language } from 'src/lang'
import { replaceResourceDatabase as setDatabaseLite } from 'src/ts/server/resourceState.svelte'

describe('PluginSettings', () => {
  let target: HTMLElement
  let component: Record<string, never> | undefined

  beforeEach(() => {
    pluginSettingsMocks.alertConfirm.mockReset()
    pluginSettingsMocks.alertConfirm.mockResolvedValue(false)
    pluginSettingsMocks.alertSelect.mockReset()
    pluginSettingsMocks.checkPluginUpdate.mockReset()
    pluginSettingsMocks.checkPluginUpdate.mockResolvedValue({ status: 'up-to-date' })
    pluginSettingsMocks.installPluginUpdate.mockReset()
    pluginSettingsMocks.installPluginUpdate.mockResolvedValue('installed')
    pluginSettingsMocks.setPluginArgument.mockReset()
    target = document.createElement('div')
    document.body.appendChild(target)
    setDatabaseLite({
      characters: [],
      currentPluginProvider: '',
      enabledModules: [],
      modules: [],
      plugins: [
        {
          name: 'plugin-c',
          displayName: 'Plugin C',
          script: 'Risuai.log("C")',
          arguments: { mode: ['fast', 'slow'] },
          realArg: { mode: 'fast' },
          customLink: [],
          argMeta: { mode: { name: 'Mode' } },
          version: '3.0',
          enabled: true,
        },
      ],
    } as any)
  })

  afterEach(() => {
    if (component) {
      unmount(component)
      component = undefined
    }
    target.remove()
    document.body.innerHTML = ''
  })

  it('renders select argument labels from plugin option values', async () => {
    component = mount(PluginSettings, { target })

    const pluginRow = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Plugin C'),
    )
    expect(pluginRow).toBeTruthy()
    pluginRow?.click()
    await tick()

    const labels = Array.from(target.querySelectorAll('option')).map((option) => option.textContent?.trim())
    expect(labels).toEqual(['fast', 'slow'])
  })

  it('names plugin icon actions and exposes enabled state', () => {
    setDatabaseLite({
      characters: [],
      currentPluginProvider: '',
      enabledModules: [],
      modules: [],
      plugins: [
        {
          name: 'plugin-accessible',
          displayName: 'Accessible Plugin',
          script: 'Risuai.log("accessible")',
          arguments: {},
          realArg: {},
          customLink: [{ link: 'https://example.test/docs', hoverText: 'Plugin documentation' }],
          argMeta: {},
          version: 2,
          enabled: true,
        },
      ],
    } as any)
    component = mount(PluginSettings, { target })

    const warningButton = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.pluginV2Warning}"]`)
    const link = target.querySelector<HTMLAnchorElement>('a[aria-label="Plugin documentation"]')
    const enableButton = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.enable}: Accessible Plugin"]`,
    )
    const removeButton = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.remove}: Accessible Plugin"]`,
    )
    const importButton = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.import}: ${language.plugin}"]`,
    )
    const developButton = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.pluginDevelopMode}"]`)

    expect(warningButton?.type).toBe('button')
    expect(link?.href).toBe('https://example.test/docs')
    expect(enableButton?.type).toBe('button')
    expect(enableButton?.getAttribute('aria-pressed')).toBe('true')
    expect(removeButton?.type).toBe('button')
    expect(importButton?.type).toBe('button')
    expect(developButton?.type).toBe('button')
  })

  it('renders numeric integer checkboxes and persists numeric toggle values', async () => {
    setDatabaseLite({
      characters: [],
      currentPluginProvider: '',
      enabledModules: [],
      modules: [],
      plugins: [
        {
          name: 'plugin-int-checkbox',
          displayName: 'Integer checkbox plugin',
          script: 'Risuai.log("checkbox")',
          arguments: { enabledFlag: 'int' },
          realArg: { enabledFlag: 1 },
          customLink: [],
          argMeta: { enabledFlag: { checkbox: 'Enabled flag' } },
          version: '3.0',
          enabled: true,
        },
      ],
    } as any)
    component = mount(PluginSettings, { target })

    const pluginRow = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Integer checkbox plugin'),
    )
    pluginRow?.click()
    await tick()

    const checkbox = target.querySelector<HTMLInputElement>('input[aria-label="Enabled flag"]')
    expect(checkbox?.checked).toBe(true)

    checkbox?.click()
    expect(pluginSettingsMocks.setPluginArgument).toHaveBeenCalledWith('plugin-int-checkbox', 'enabledFlag', 0)
  })

  it('keeps a selected string radio checked and switches to an alternate choice', async () => {
    setDatabaseLite({
      characters: [],
      currentPluginProvider: '',
      enabledModules: [],
      modules: [],
      plugins: [
        {
          name: 'plugin-string-radio',
          displayName: 'String radio plugin',
          script: 'Risuai.log("string radio")',
          arguments: { mode: 'string' },
          realArg: { mode: 'fast' },
          customLink: [],
          argMeta: { mode: { radio: 'Fast|fast,Slow|slow' } },
          version: '3.0',
          enabled: true,
        },
      ],
    } as any)
    component = mount(PluginSettings, { target })

    const pluginRow = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('String radio plugin'),
    )
    pluginRow?.click()
    await tick()

    const radios = target.querySelectorAll<HTMLInputElement>(
      'input[type="radio"][name="plugin-arg:plugin-string-radio:mode"]',
    )
    expect(radios).toHaveLength(2)
    const fast = radios.item(0)
    const slow = radios.item(1)
    expect(fast.checked).toBe(true)
    expect(slow.checked).toBe(false)

    fast.click()
    expect(fast.checked).toBe(true)
    expect(slow.checked).toBe(false)
    expect(pluginSettingsMocks.setPluginArgument).not.toHaveBeenCalled()

    slow.click()
    expect(fast.checked).toBe(false)
    expect(slow.checked).toBe(true)
    expect(pluginSettingsMocks.setPluginArgument).toHaveBeenCalledOnce()
    expect(pluginSettingsMocks.setPluginArgument).toHaveBeenCalledWith('plugin-string-radio', 'mode', 'slow')
  })

  it('keeps a selected numeric radio checked and switches to an alternate choice', async () => {
    setDatabaseLite({
      characters: [],
      currentPluginProvider: '',
      enabledModules: [],
      modules: [],
      plugins: [
        {
          name: 'plugin-number-radio',
          displayName: 'Numeric radio plugin',
          script: 'Risuai.log("numeric radio")',
          arguments: { effort: 'int' },
          realArg: { effort: 1 },
          customLink: [],
          argMeta: { effort: { radio: 'Low|1,High|2' } },
          version: '3.0',
          enabled: true,
        },
      ],
    } as any)
    component = mount(PluginSettings, { target })

    const pluginRow = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Numeric radio plugin'),
    )
    pluginRow?.click()
    await tick()

    const radios = target.querySelectorAll<HTMLInputElement>(
      'input[type="radio"][name="plugin-arg:plugin-number-radio:effort"]',
    )
    expect(radios).toHaveLength(2)
    const low = radios.item(0)
    const high = radios.item(1)
    expect(low.checked).toBe(true)
    expect(high.checked).toBe(false)

    low.click()
    expect(low.checked).toBe(true)
    expect(high.checked).toBe(false)
    expect(pluginSettingsMocks.setPluginArgument).not.toHaveBeenCalled()

    high.click()
    expect(low.checked).toBe(false)
    expect(high.checked).toBe(true)
    expect(pluginSettingsMocks.setPluginArgument).toHaveBeenCalledOnce()
    expect(pluginSettingsMocks.setPluginArgument).toHaveBeenCalledWith('plugin-number-radio', 'effort', 2)
  })

  it('starts and cleans up the plugin starter download', async () => {
    pluginSettingsMocks.alertSelect.mockResolvedValue('1')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    component = mount(PluginSettings, { target })

    const developerButton = target.querySelectorAll('button').item(target.querySelectorAll('button').length - 1)
    developerButton.click()

    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(document.querySelector('a[download="plugin_starter.7z"]')).toBeNull()
    click.mockRestore()
  })

  it('does not check plugin-authored update URLs until the user requests it', async () => {
    const updater = {
      name: 'plugin-updater',
      displayName: 'Plugin Updater',
      script: 'Risuai.log("updater")',
      updateURL: 'https://plugins.example/updater.js',
      versionOfPlugin: '1.0.0',
      arguments: {},
      realArg: {},
      customLink: [],
      argMeta: {},
      version: '3.0' as const,
      enabled: true,
    }
    setDatabaseLite({
      characters: [],
      currentPluginProvider: '',
      enabledModules: [],
      modules: [],
      plugins: [updater],
    } as any)

    component = mount(PluginSettings, { target })
    await tick()

    expect(pluginSettingsMocks.checkPluginUpdate).not.toHaveBeenCalled()
    const checkButton = target.querySelector<HTMLButtonElement>('[aria-label="Check for plugin updates"]')
    expect(checkButton).toBeTruthy()
    expect(checkButton?.title).toBe('Check for plugin updates')

    checkButton?.click()
    await vi.waitFor(() => expect(pluginSettingsMocks.checkPluginUpdate).toHaveBeenCalledWith(updater))
    await vi.waitFor(() =>
      expect(target.querySelector('[role="status"]')?.textContent).toContain('Plugin is up to date.'),
    )
  })

  it.each([
    ['denied', 'Plugin update permission was denied.'],
    ['failed', 'Could not check for plugin updates. Try again.'],
  ] as const)('shows the %s update-check outcome', async (status, message) => {
    pluginSettingsMocks.checkPluginUpdate.mockResolvedValue({ status })
    setDatabaseLite({
      characters: [],
      currentPluginProvider: '',
      enabledModules: [],
      modules: [],
      plugins: [
        {
          name: `plugin-${status}`,
          displayName: `Plugin ${status}`,
          script: `Risuai.log("${status}")`,
          updateURL: `https://plugins.example/${status}.js`,
          versionOfPlugin: '1.0.0',
          arguments: {},
          realArg: {},
          customLink: [],
          argMeta: {},
          version: '3.0',
          enabled: true,
        },
      ],
    } as any)

    component = mount(PluginSettings, { target })
    target.querySelector<HTMLButtonElement>('[aria-label="Check for plugin updates"]')?.click()

    await vi.waitFor(() => expect(target.querySelector('[role="status"]')?.textContent).toContain(message))
    expect(pluginSettingsMocks.installPluginUpdate).not.toHaveBeenCalled()
  })

  it('requires a second confirmed action to install an available update', async () => {
    pluginSettingsMocks.checkPluginUpdate.mockResolvedValue({
      status: 'available',
      update: { version: '1.1.0', updateURL: 'https://plugins.example/available.js' },
    })
    pluginSettingsMocks.alertConfirm.mockResolvedValue(true)
    const updater = {
      name: 'plugin-available',
      displayName: 'Plugin Available',
      script: 'Risuai.log("available")',
      updateURL: 'https://plugins.example/available.js',
      versionOfPlugin: '1.0.0',
      arguments: {},
      realArg: {},
      customLink: [],
      argMeta: {},
      version: '3.0' as const,
      enabled: true,
    }
    setDatabaseLite({
      characters: [],
      currentPluginProvider: '',
      enabledModules: [],
      modules: [],
      plugins: [updater],
    } as any)

    component = mount(PluginSettings, { target })
    target.querySelector<HTMLButtonElement>('[aria-label="Check for plugin updates"]')?.click()
    const installButton = await vi.waitFor(() => {
      const button = target.querySelector<HTMLButtonElement>('[aria-label="Install plugin update 1.1.0"]')
      expect(button).toBeTruthy()
      return button
    })
    expect(pluginSettingsMocks.installPluginUpdate).not.toHaveBeenCalled()

    installButton?.click()
    await vi.waitFor(() => expect(pluginSettingsMocks.installPluginUpdate).toHaveBeenCalledWith(updater))
    expect(pluginSettingsMocks.alertConfirm).toHaveBeenCalledOnce()
    expect(target.querySelector('[role="status"]')?.textContent).toContain('Plugin update installed.')
  })
})
