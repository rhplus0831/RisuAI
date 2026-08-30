import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/storage/database.svelte', async () => {
  const { fromStore, writable } = await import('svelte/store')
  const database = writable<Record<string, unknown>>({})
  const reactiveDatabase = fromStore(database)
  return {
    getDatabase: () => reactiveDatabase.current,
    setDatabaseLite: (value: Record<string, unknown>) => database.set(value),
  }
})

import { language } from 'src/lang'
import type { ScriptModelOverrides } from '@risuai/shared-core/script-model-overrides'
import { setDatabaseLite } from 'src/ts/storage/database.svelte'
import TestHost from './ScriptModelOverrideSelectors.test-host.svelte'

type MountedHost = Parameters<typeof unmount>[0] & { currentValue(): ScriptModelOverrides }

let component: MountedHost | undefined
let target: HTMLElement

function select(label: string): HTMLSelectElement {
  const element = target.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
  expect(element).toBeTruthy()
  return element!
}

beforeEach(() => {
  setDatabaseLite({
    modelProfiles: [
      { id: 'profile-a', name: 'Profile A' },
      { id: 'profile-b', name: 'Profile B' },
    ],
    modelProfileOrder: [
      { kind: 'profile', profileId: 'profile-a' },
      { kind: 'divider', id: 'divider-a' },
      { kind: 'profile', profileId: 'profile-b' },
    ],
  } as any)
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  target.remove()
  document.body.innerHTML = ''
})

describe('ScriptModelOverrideSelectors', () => {
  it('preserves missing ids, restores divider selections, and updates each role independently', async () => {
    component = mount(TestHost, {
      target,
      props: { value: { llmProfileId: 'missing-main' } },
    })

    const main = select(language.scriptModelOverrides.llm)
    expect(Array.from(main.options).map((option) => option.textContent)).toContain(
      language.modelProfiles.missingProfile('missing-main'),
    )
    expect(main.value).toBe('missing-main')

    const divider = Array.from(main.options).find((option) => option.textContent === '---')!
    main.value = divider.value
    main.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(select(language.scriptModelOverrides.llm).value).toBe('missing-main')

    select(language.scriptModelOverrides.llm).value = 'profile-b'
    select(language.scriptModelOverrides.llm).dispatchEvent(new Event('change', { bubbles: true }))
    select(language.scriptModelOverrides.axLlm).value = 'profile-a'
    select(language.scriptModelOverrides.axLlm).dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    expect(component.currentValue()).toEqual({
      llmProfileId: 'profile-b',
      axLlmProfileId: 'profile-a',
    })
  })
})
