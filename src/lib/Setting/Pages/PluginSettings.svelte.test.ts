import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/process/modules', () => ({
  getModules: () => [],
  getModuleLorebooks: () => [],
  getModuleTriggers: () => [],
  moduleUpdate: () => {},
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: vi.fn(async () => false),
  alertMd: vi.fn(),
  alertSelect: vi.fn(),
}))

vi.mock('src/ts/plugins/plugins.svelte', () => ({
  checkPluginUpdate: vi.fn(async () => null),
  createBlankPlugin: vi.fn(),
  importPlugin: vi.fn(),
  loadPlugins: vi.fn(),
  updatePlugin: vi.fn(),
}))

vi.mock('src/ts/pluginCommands', () => ({
  currentPluginStateSnapshot: () => ({}),
  dispatchDeletePlugin: vi.fn(),
  dispatchEnablePlugin: vi.fn(),
  dispatchUpdatePlugin: vi.fn(),
}))

vi.mock('src/ts/server/projectionWriteGuard.svelte', () => ({
  withTrustedServerProjectionWrite: (fn: () => unknown) => fn(),
}))

import PluginSettings from './PluginSettings.svelte'
import { DBState } from 'src/ts/stores.svelte'

describe('PluginSettings', () => {
  let target: HTMLElement
  let component: Record<string, never> | undefined

  beforeEach(() => {
    target = document.createElement('div')
    document.body.appendChild(target)
    DBState.db = {
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
    } as any
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
})
