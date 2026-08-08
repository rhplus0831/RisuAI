import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const inputHookSettingsMocks = vi.hoisted(() => ({
  readInputHooks: () => [] as Array<Record<string, unknown>>,
  setInputHooks: (_hooks: Array<Record<string, unknown>>) => {},
}))

vi.mock('src/ts/server/settingsBridge.svelte', async () => {
  const { fromStore, writable } = await import('svelte/store')
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const hooks = writable<Array<Record<string, unknown>>>([])
  const reactiveHooks = fromStore(hooks)

  inputHookSettingsMocks.readInputHooks = () => reactiveHooks.current
  inputHookSettingsMocks.setInputHooks = (value) => hooks.set(clone(value))

  return {
    createServerBackedSettingDraft: () => ({
      get value() {
        return reactiveHooks.current
      },
      set value(value: Array<Record<string, unknown>>) {
        hooks.set(clone(value))
      },
    }),
  }
})

vi.mock('src/ts/storage/database.svelte', async () => {
  const { fromStore, writable } = await import('svelte/store')
  const database = writable<Record<string, unknown>>({})
  const reactiveDatabase = fromStore(database)

  return {
    getDatabase: () => reactiveDatabase.current,
    setDatabaseLite: (value: Record<string, unknown>) => database.set(value),
  }
})

vi.mock('src/ts/process/templates/templates', () => ({
  prebuiltPresets: { OAI: { mainPrompt: '', jailbreak: '' } },
}))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', async () => ({
  default: (await import('src/lib/UI/GUI/TextInput.svelte')).default,
}))

import { language } from 'src/lang'
import { setDatabaseLite } from 'src/ts/storage/database.svelte'
import InputHookSettings from './InputHookSettings.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function modelSelect(name: string): HTMLSelectElement {
  const select = target.querySelector<HTMLSelectElement>(`select[aria-label="${language.inputHookModel}: ${name}"]`)
  expect(select).toBeTruthy()
  return select!
}

function translationCheckbox(): HTMLInputElement | null {
  return target.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${language.inputHookTranslation}"]`)
}

beforeEach(() => {
  inputHookSettingsMocks.setInputHooks([
    {
      id: 'legacy-hook',
      name: 'Legacy Hook',
      type: 'draft',
      prompt: 'Rewrite this.',
    },
  ])
  setDatabaseLite({
    modelProfiles: [
      { id: 'profile-a', name: 'Profile A', modelId: 'echo_model' },
      { id: 'profile-b', name: 'Profile B', modelId: 'echo_model' },
    ],
    modelProfileOrder: [
      { kind: 'profile', profileId: 'profile-a' },
      { kind: 'divider', id: 'divider-a' },
      { kind: 'profile', profileId: 'profile-b' },
    ],
  } as any)

  target = document.createElement('div')
  document.body.appendChild(target)
  component = mount(InputHookSettings, { target })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  setDatabaseLite({} as any)
  target.remove()
  document.body.innerHTML = ''
})

describe('InputHookSettings model profiles', () => {
  it('inherits for legacy hooks and persists a per-hook profile selection', async () => {
    const select = modelSelect('Legacy Hook')
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      language.inputHookInheritOtherAxModel,
      'Profile A',
      '---',
      'Profile B',
    ])
    expect(select.value).toBe('')

    const divider = select.querySelector<HTMLOptionElement>('[data-model-profile-divider="true"]')!
    select.value = divider.value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(modelSelect('Legacy Hook').value).toBe('')
    expect(inputHookSettingsMocks.readInputHooks()[0].model).toBeUndefined()

    const refreshedSelect = modelSelect('Legacy Hook')
    refreshedSelect.value = 'profile-b'
    refreshedSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(inputHookSettingsMocks.readInputHooks()[0].model).toEqual({
      mode: 'modelProfile',
      profileId: 'profile-b',
    })

    modelSelect('Legacy Hook').value = ''
    modelSelect('Legacy Hook').dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(inputHookSettingsMocks.readInputHooks()[0].model).toEqual({ mode: 'inheritOtherAx' })
  })

  it('creates new hooks that inherit the Other Auxiliary model', async () => {
    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.inputHookAdd}"]`)!.click()
    await tick()

    expect(inputHookSettingsMocks.readInputHooks().at(-1)).toMatchObject({
      model: { mode: 'inheritOtherAx' },
      translation: false,
    })
  })

  it('shows and persists Translation only for Draft hooks', async () => {
    const checkbox = translationCheckbox()
    expect(checkbox).toBeTruthy()
    expect(checkbox!.checked).toBe(false)

    checkbox!.click()
    await tick()
    expect(inputHookSettingsMocks.readInputHooks()[0].translation).toBe(true)

    inputHookSettingsMocks.setInputHooks([
      {
        id: 'btw-hook',
        name: 'BTW Hook',
        type: 'btw',
        prompt: 'Answer this.',
        translation: true,
      },
    ])
    await tick()
    expect(translationCheckbox()).toBeNull()
  })
})
