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
})
