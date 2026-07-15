import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const customModelMocks = vi.hoisted(() => ({
  draft: { value: [] as Array<Record<string, any>> },
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  createServerBackedSettingDraft: () => customModelMocks.draft,
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/alert', () => ({
  alertMd: vi.fn(),
}))

import CustomModelsSettings from './CustomModelsSettings.svelte'
import { LLMFlags } from 'src/ts/model/types'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === text,
  )
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

beforeEach(() => {
  customModelMocks.draft.value = [
    {
      id: 'xcustom:::all-flags',
      name: 'All Flags',
      internalId: 'all-flags',
      url: 'https://example.test/v1',
      tokenizer: 0,
      format: 0,
      key: '',
      params: '',
      flags: Object.values(LLMFlags),
    },
  ]
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

describe('CustomModelsSettings flags', () => {
  it('renders and edits every persisted model capability flag', async () => {
    component = mount(CustomModelsSettings, {
      target,
      props: { noAccordion: true },
    })

    buttonByText('All Flags').click()
    await tick()
    buttonByText(language.flags).click()
    await tick()

    for (const [name, flag] of Object.entries(LLMFlags)) {
      const button = buttonByText(name)
      expect(button.classList).not.toContain('bg-transparent')
      expect(customModelMocks.draft.value[0].flags).toContain(flag)
    }

    const xHighEffort = buttonByText('claudeXHighEffort')
    xHighEffort.click()
    expect(customModelMocks.draft.value[0].flags).not.toContain(LLMFlags.claudeXHighEffort)

    xHighEffort.click()
    expect(customModelMocks.draft.value[0].flags).toContain(LLMFlags.claudeXHighEffort)
  })
})
