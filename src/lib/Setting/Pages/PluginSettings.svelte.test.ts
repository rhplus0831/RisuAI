import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pluginSettingsMocks = vi.hoisted(() => ({
  alertSelect: vi.fn(),
  setPluginArgument: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
  getModules: () => [],
  getModuleLorebooks: () => [],
  getModuleTriggers: () => [],
  moduleUpdate: () => {},
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: vi.fn(async () => false),
  alertMd: vi.fn(),
  alertSelect: pluginSettingsMocks.alertSelect,
}))

vi.mock('src/ts/plugins/plugins.svelte', () => ({
  checkPluginUpdate: vi.fn(async () => null),
  createBlankPlugin: vi.fn(),
  importPlugin: vi.fn(),
  loadPlugins: vi.fn(),
  updatePlugin: vi.fn(),
}))

vi.mock('src/ts/pluginCommands', () => ({
  deletePlugin: vi.fn(),
  mergePendingPluginStorageResource: vi.fn((value) => value),
  setPluginArgument: pluginSettingsMocks.setPluginArgument,
  togglePluginEnabled: vi.fn(),
}))

import PluginSettings from './PluginSettings.svelte'
import { replaceResourceDatabase as setDatabaseLite } from 'src/ts/server/resourceState.svelte'

describe('PluginSettings', () => {
  let target: HTMLElement
  let component: Record<string, never> | undefined

  beforeEach(() => {
    pluginSettingsMocks.alertSelect.mockReset()
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
})
