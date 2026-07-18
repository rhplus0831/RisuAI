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
  setPluginArgument: vi.fn(async () => ({ status: 'accepted', result: { status: 'ok' } })),
  togglePluginEnabled: vi.fn(async () => ({ status: 'accepted', result: { status: 'ok' } })),
  deletePlugin: vi.fn(async () => ({ status: 'accepted', result: { status: 'ok' } })),
  hotReloadPluginFiles: vi.fn(),
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
  acceptedPluginRuntimeProjection: vi.fn((value) => value),
  deletePlugin: pluginSettingsMocks.deletePlugin,
  mergePendingPluginCollectionResource: vi.fn((value) => value),
  mergePendingPluginProviderResource: vi.fn((value) => value),
  mergePendingPluginStorageResource: vi.fn((value) => value),
  setPluginArgument: pluginSettingsMocks.setPluginArgument,
  togglePluginEnabled: pluginSettingsMocks.togglePluginEnabled,
}))

vi.mock('src/ts/plugins/apiV3/developMode', () => ({
  hotReloadPluginFiles: pluginSettingsMocks.hotReloadPluginFiles,
}))

import PluginSettings from './PluginSettings.svelte'
import { language } from 'src/lang'
import { replaceResourceDatabase as setDatabaseLite } from 'src/ts/server/resourceState.svelte'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

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
    pluginSettingsMocks.setPluginArgument.mockResolvedValue({ status: 'accepted', result: { status: 'ok' } })
    pluginSettingsMocks.togglePluginEnabled.mockReset()
    pluginSettingsMocks.togglePluginEnabled.mockResolvedValue({ status: 'accepted', result: { status: 'ok' } })
    pluginSettingsMocks.deletePlugin.mockReset()
    pluginSettingsMocks.deletePlugin.mockResolvedValue({ status: 'accepted', result: { status: 'ok' } })
    pluginSettingsMocks.hotReloadPluginFiles.mockReset()
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

  it('keeps a plugin action busy until its durable outcome and reports a queued retry', async () => {
    const mutation = deferred<any>()
    const settlement = deferred<any>()
    pluginSettingsMocks.togglePluginEnabled.mockReturnValueOnce(mutation.promise)
    component = mount(PluginSettings, { target })

    const enableButton = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.enable}: Plugin C"]`)
    enableButton?.click()
    await tick()

    expect(enableButton?.disabled).toBe(true)
    expect(target.querySelector('[role="status"]')?.textContent).toContain(language.pluginMutation.saving)

    mutation.resolve({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationId: 'plugin-mutation-a',
      settlement: settlement.promise,
    })
    await vi.waitFor(() =>
      expect(target.querySelector('[role="status"]')?.textContent).toContain(language.pluginMutation.queued),
    )
    expect(enableButton?.disabled).toBe(false)

    settlement.resolve({ status: 'accepted' })
    await vi.waitFor(() => expect(target.querySelector('[role="status"]')).toBeNull())
  })

  it('turns a queued plugin action into a visible failure when replay discards it', async () => {
    const mutation = deferred<any>()
    const settlement = deferred<any>()
    pluginSettingsMocks.togglePluginEnabled.mockReturnValueOnce(mutation.promise)
    component = mount(PluginSettings, { target })

    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.enable}: Plugin C"]`)?.click()
    mutation.resolve({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationId: 'plugin-mutation-a',
      settlement: settlement.promise,
    })
    await vi.waitFor(() =>
      expect(target.querySelector('[role="status"]')?.textContent).toContain(language.pluginMutation.queued),
    )

    settlement.resolve({ status: 'failed' })
    await vi.waitFor(() =>
      expect(target.querySelector('[role="status"]')?.textContent).toContain(language.pluginMutation.failed),
    )
  })

  it('does not let an older failed argument save replace a newer accepted status', async () => {
    const older = deferred<any>()
    const newer = deferred<any>()
    pluginSettingsMocks.setPluginArgument.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    component = mount(PluginSettings, { target })

    const pluginRow = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Plugin C'),
    )
    pluginRow?.click()
    await tick()
    const select = target.querySelector<HTMLSelectElement>('select')
    if (!select) throw new Error('Expected plugin argument select')
    select.value = 'slow'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    select.value = 'fast'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    older.resolve({ status: 'failed', result: { status: 'error', error: 'rejected' } })
    await tick()
    expect(target.querySelector('[role="status"]')?.textContent).toContain(language.pluginMutation.saving)

    newer.resolve({ status: 'accepted', result: { status: 'ok' } })
    await vi.waitFor(() => expect(target.textContent).not.toContain(language.pluginMutation.saving))
    expect(target.textContent).not.toContain(language.pluginMutation.failed)
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

  it('treats a dismissed developer-mode selection as cancellation', async () => {
    pluginSettingsMocks.alertSelect.mockResolvedValue(null)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    component = mount(PluginSettings, { target })

    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.pluginDevelopMode}"]`)?.click()

    await vi.waitFor(() => expect(pluginSettingsMocks.alertSelect).toHaveBeenCalledOnce())
    await tick()
    expect(pluginSettingsMocks.hotReloadPluginFiles).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
    click.mockRestore()
  })

  it('stops only the currently owned hot-reload session when it is replaced or destroyed', async () => {
    pluginSettingsMocks.alertSelect.mockResolvedValue('0')
    const olderDone = deferred<void>()
    const newerDone = deferred<void>()
    const olderSession = { done: olderDone.promise, stop: vi.fn() }
    const newerSession = { done: newerDone.promise, stop: vi.fn() }
    pluginSettingsMocks.hotReloadPluginFiles.mockReturnValueOnce(olderSession).mockReturnValueOnce(newerSession)
    component = mount(PluginSettings, { target })
    const developButton = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.pluginDevelopMode}"]`)

    developButton?.click()
    await vi.waitFor(() => expect(pluginSettingsMocks.hotReloadPluginFiles).toHaveBeenCalledTimes(1))
    developButton?.click()
    await vi.waitFor(() => expect(pluginSettingsMocks.hotReloadPluginFiles).toHaveBeenCalledTimes(2))

    expect(olderSession.stop).toHaveBeenCalledOnce()
    expect(newerSession.stop).not.toHaveBeenCalled()

    olderDone.resolve()
    await tick()
    unmount(component)
    component = undefined

    expect(newerSession.stop).toHaveBeenCalledOnce()
  })

  it('does not start hot reload after its settings owner is destroyed during selection', async () => {
    const selection = deferred<string | null>()
    pluginSettingsMocks.alertSelect.mockReturnValueOnce(selection.promise)
    component = mount(PluginSettings, { target })

    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.pluginDevelopMode}"]`)?.click()
    await vi.waitFor(() => expect(pluginSettingsMocks.alertSelect).toHaveBeenCalledOnce())
    unmount(component)
    component = undefined
    selection.resolve('0')
    await tick()

    expect(pluginSettingsMocks.hotReloadPluginFiles).not.toHaveBeenCalled()
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
