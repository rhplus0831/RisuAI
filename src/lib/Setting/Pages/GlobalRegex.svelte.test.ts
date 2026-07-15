import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/lib/Others/Help.svelte', async () => ({
  default: (await import('./GlobalRegex.testStub.svelte')).default,
}))
vi.mock('src/lib/SideBars/Scripts/RegexList.svelte', async () => ({
  default: (await import('./GlobalRegex.testStub.svelte')).default,
}))
vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => ({ globalscript: [] }),
}))
vi.mock('src/ts/process/scripts', () => ({
  exportRegex: vi.fn(),
  importRegex: vi.fn(async (scripts: unknown) => scripts),
}))
vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  createServerBackedSettingDraft: (_key: string, fallback: unknown) => ({ value: fallback }),
}))
vi.mock('src/ts/server/scriptDefinitionBridge.svelte', () => ({
  ensureClientScriptDefinitionIds: (scripts: unknown) => scripts,
  watchServerBackedScriptDefinitions: () => vi.fn(),
}))

import GlobalRegex from './GlobalRegex.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('GlobalRegex toolbar', () => {
  it('names each icon action for the global regex collection', () => {
    component = mount(GlobalRegex, { target })

    const labels = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).map((button) =>
      button.getAttribute('aria-label'),
    )
    expect(labels).toEqual([
      `${language.add}: ${language.globalRegexScript}`,
      `${language.export}: ${language.globalRegexScript}`,
      `${language.import}: ${language.globalRegexScript}`,
    ])
    expect(
      Array.from(target.querySelectorAll<HTMLButtonElement>('button')).every((button) => button.type === 'button'),
    ).toBe(true)
  })
})
