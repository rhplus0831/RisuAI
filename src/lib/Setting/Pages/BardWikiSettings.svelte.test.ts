import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bardWikiMocks = vi.hoisted(() => ({
  draft: { value: {} as Record<string, unknown> },
}))

vi.mock('src/ts/server/settingsOwner.svelte', () => ({
  createServerBackedSettingDraft: () => bardWikiMocks.draft,
}))

import BardWikiSettings from './BardWikiSettings.svelte'
import { language } from 'src/lang'
import { DEFAULT_BARDWIKI_GLOBAL_SETTINGS } from '@risuai/protocol'
import { replaceResourceDatabase } from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  bardWikiMocks.draft.value = structuredClone(DEFAULT_BARDWIKI_GLOBAL_SETTINGS)
  replaceResourceDatabase({
    modelProfiles: [{ id: 'profile-a', name: 'Profile A' }],
    promptPresets: [{ id: 'prompt-a', name: 'Prompt A' }],
  } as any)
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  target.remove()
})

describe('BardWiki settings', () => {
  it('renders the locked defaults, bounded controls, and selectable references', async () => {
    component = mount(BardWikiSettings, { target })
    await tick()

    expect(target.querySelector('[data-risu-bardwiki-settings]')).toBeTruthy()
    expect(
      target.querySelector<HTMLInputElement>(`input[aria-label="${language.bardWiki.totalTokenBudget}"]`)?.value,
    ).toBe('2048')
    expect(target.querySelector<HTMLSelectElement>('#bardwiki-model-profile')?.options).toHaveLength(2)
    expect(target.querySelector<HTMLSelectElement>('#bardwiki-prompt-preset')?.options).toHaveLength(2)
    expect(
      target.querySelector<HTMLInputElement>(`input[aria-label="${language.bardWiki.automaticConfirmation}"]`)
        ?.disabled,
    ).toBe(false)
    expect(
      target.querySelector<HTMLInputElement>(`input[aria-label="${language.bardWiki.canonicalUpdates}"]`)?.disabled,
    ).toBe(false)
  })

  it('projects user-controlled settings into the server-backed object draft', async () => {
    component = mount(BardWikiSettings, { target })
    await tick()

    target.querySelector<HTMLInputElement>(`input[aria-label="${language.bardWiki.enabledByDefault}"]`)?.click()
    target.querySelector<HTMLInputElement>(`input[aria-label="${language.bardWiki.automaticConfirmation}"]`)?.click()
    target.querySelector<HTMLInputElement>(`input[aria-label="${language.bardWiki.canonicalUpdates}"]`)?.click()
    const mode = target.querySelector<HTMLSelectElement>('#bardwiki-memory-mode')!
    mode.value = 'hybrid'
    mode.dispatchEvent(new Event('change', { bubbles: true }))
    const profile = target.querySelector<HTMLSelectElement>('#bardwiki-model-profile')!
    profile.value = 'profile-a'
    profile.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    expect(bardWikiMocks.draft.value).toMatchObject({
      enabledByDefault: true,
      memoryMode: 'hybrid',
      modelProfileId: 'profile-a',
      confirmationPolicy: 'automatic',
      canonicalUpdates: true,
    })
  })
})
