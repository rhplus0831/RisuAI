import { mount, tick, unmount } from 'svelte'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const pickerMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  changeUserPersonaWithOutcome: vi.fn(),
  close: vi.fn(),
  saveActiveChatGenerationSettingsSelectionWithOutcome: vi.fn(),
  ownerState: {
    collections: {
      values: {
        personas: [
          { id: 'persona-a', name: 'Persona A', note: '' },
          { id: 'persona-b', name: 'Persona B', note: 'Second' },
        ],
      },
      statuses: { personas: 'ready' },
    },
    settings: {
      value: {
        selectedPersonaId: 'persona-a',
        selectedPersona: 0,
        username: 'Persona A',
        userIcon: '',
        personaPrompt: '',
        userNote: '',
      },
      standaloneStatuses: { selectedPersonaId: 'ready', selectedPersona: 'ready' },
    },
  },
}))

vi.mock('src/ts/alert', () => ({
  alertError: pickerMocks.alertError,
  alertNormal: pickerMocks.alertNormal,
}))

vi.mock('src/ts/persona', () => ({
  changeUserPersonaWithOutcome: pickerMocks.changeUserPersonaWithOutcome,
}))

vi.mock('src/ts/personaDisplayName', () => ({
  getPersonaDisplayName: (persona: { name: string }) => persona.name,
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  collectionsResourceState: pickerMocks.ownerState.collections,
  getPersonaOwnerStateSnapshot: () => {
    const personas = pickerMocks.ownerState.collections.values.personas
    const settings = pickerMocks.ownerState.settings.value
    if (pickerMocks.ownerState.collections.statuses.personas === 'error' || !Array.isArray(personas)) return null
    const ids = personas.map((persona) => persona.id)
    if (ids.some((id) => typeof id !== 'string' || id.trim().length === 0) || new Set(ids).size !== ids.length) {
      return null
    }
    const selectedPersona = personas.findIndex((persona) => persona.id === settings.selectedPersonaId)
    if (selectedPersona < 0 || selectedPersona !== settings.selectedPersona) return null
    return { personas, ...settings }
  },
}))

vi.mock('src/ts/activeChatGenerationSettings', () => ({
  resolveActiveChatGenerationSettings: () => ({ settings: null }),
  saveActiveChatGenerationSettingsSelectionWithOutcome:
    pickerMocks.saveActiveChatGenerationSettingsSelectionWithOutcome,
}))

vi.mock('src/ts/stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return { selectedCharID: writable(0) }
})

vi.mock('src/ts/gui/modalFocusTrap', () => ({
  modalFocusTrap: () => ({ destroy: vi.fn() }),
}))

import { language } from 'src/lang'
import ListedPersona from './listedPersona.svelte'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

let target: HTMLElement
let component: Parameters<typeof unmount>[0] | undefined

function personaRow(index: number): HTMLButtonElement {
  const row = target.querySelector<HTMLButtonElement>(`[data-risu-row-index="${index}"]`)
  expect(row).toBeTruthy()
  return row!
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  pickerMocks.alertNormal.mockReset()
  pickerMocks.alertError.mockReset()
  pickerMocks.changeUserPersonaWithOutcome.mockReset()
  pickerMocks.close.mockReset()
  pickerMocks.saveActiveChatGenerationSettingsSelectionWithOutcome.mockReset().mockReturnValue({
    settlement: Promise.resolve({ status: 'accepted' }),
  })
  pickerMocks.ownerState.collections.values.personas = [
    { id: 'persona-a', name: 'Persona A', note: '' },
    { id: 'persona-b', name: 'Persona B', note: 'Second' },
  ]
  pickerMocks.ownerState.collections.statuses.personas = 'ready'
  pickerMocks.ownerState.settings.value.selectedPersonaId = 'persona-a'
  pickerMocks.ownerState.settings.value.selectedPersona = 0
  pickerMocks.ownerState.settings.standaloneStatuses.selectedPersonaId = 'ready'
  pickerMocks.ownerState.settings.standaloneStatuses.selectedPersona = 'ready'
})

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  target.remove()
})

describe('global persona picker persistence', () => {
  it('stays open and blocks duplicate selection while the exact command is pending', async () => {
    const persistence = deferred<'accepted' | 'queued' | 'failed'>()
    pickerMocks.changeUserPersonaWithOutcome.mockReturnValue(persistence.promise)
    component = mount(ListedPersona, { target, props: { close: pickerMocks.close } })

    expect(personaRow(0).dataset.risuSelected).toBe('true')
    expect(personaRow(1).dataset.risuSelected).toBe('false')
    personaRow(1).click()
    personaRow(1).click()
    await tick()

    expect(pickerMocks.changeUserPersonaWithOutcome).toHaveBeenCalledOnce()
    expect(pickerMocks.changeUserPersonaWithOutcome).toHaveBeenCalledWith(1)
    expect(pickerMocks.close).not.toHaveBeenCalled()
    expect(personaRow(1).disabled).toBe(true)
    expect(target.querySelector('[role="dialog"]')?.getAttribute('aria-busy')).toBe('true')

    persistence.resolve('accepted')
    await vi.waitFor(() => expect(pickerMocks.close).toHaveBeenCalledOnce())
  })

  it('keeps the picker open and shows a terminal selection failure', async () => {
    pickerMocks.changeUserPersonaWithOutcome.mockResolvedValue('failed')
    component = mount(ListedPersona, { target, props: { close: pickerMocks.close } })

    personaRow(1).click()

    await vi.waitFor(() =>
      expect(target.querySelector('[role="alert"]')?.textContent).toContain(language.personaMutationFailed),
    )
    expect(pickerMocks.close).not.toHaveBeenCalled()
  })

  it('announces a durably queued selection before closing', async () => {
    pickerMocks.changeUserPersonaWithOutcome.mockResolvedValue('queued')
    component = mount(ListedPersona, { target, props: { close: pickerMocks.close } })

    personaRow(1).click()

    await vi.waitFor(() => expect(pickerMocks.alertNormal).toHaveBeenCalledWith(language.personaMutationQueued))
    expect(pickerMocks.close).toHaveBeenCalledOnce()
  })
})

describe('active-chat persona picker persistence', () => {
  const targetIdentity = {
    selectedCharID: 0,
    chatPage: 0,
    characterId: 'char-a',
    chatId: 'chat-a',
  }

  it('stays busy and surfaces a rejected chat-generation selection', async () => {
    const persistence = deferred<{ status: 'accepted' | 'queued' } | { status: 'failed'; error: string }>()
    pickerMocks.saveActiveChatGenerationSettingsSelectionWithOutcome.mockReturnValue({
      settlement: persistence.promise,
    })
    component = mount(ListedPersona, {
      target,
      props: {
        close: pickerMocks.close,
        mode: 'active-chat-generation-settings',
        target: targetIdentity,
      },
    })

    personaRow(1).click()
    await tick()

    expect(pickerMocks.saveActiveChatGenerationSettingsSelectionWithOutcome).toHaveBeenCalledWith(
      { personaId: 'persona-b' },
      { expectedTarget: targetIdentity },
    )
    expect(personaRow(1).disabled).toBe(true)
    expect(target.querySelector('[role="status"]')).toBeNull()
    expect(pickerMocks.close).not.toHaveBeenCalled()

    persistence.resolve({ status: 'failed', error: 'selection rejected' })
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')?.textContent).toContain('selection rejected'))
    expect(pickerMocks.alertError).toHaveBeenCalledWith(language.chatGenerationSettingsSaveFailed('selection rejected'))
    expect(pickerMocks.close).not.toHaveBeenCalled()
  })

  it('surfaces a stale active-chat target without closing', async () => {
    pickerMocks.saveActiveChatGenerationSettingsSelectionWithOutcome.mockReturnValue(null)
    component = mount(ListedPersona, {
      target,
      props: {
        close: pickerMocks.close,
        mode: 'active-chat-generation-settings',
        target: targetIdentity,
      },
    })

    personaRow(1).click()

    await vi.waitFor(() =>
      expect(target.querySelector('[role="alert"]')?.textContent).toContain(
        language.chatGenerationSettingsTargetChanged,
      ),
    )
    expect(pickerMocks.alertError).toHaveBeenCalledWith(
      language.chatGenerationSettingsSaveFailed(language.chatGenerationSettingsTargetChanged),
    )
    expect(pickerMocks.close).not.toHaveBeenCalled()
  })

  it('announces a queued active-chat selection before closing', async () => {
    pickerMocks.saveActiveChatGenerationSettingsSelectionWithOutcome.mockReturnValue({
      settlement: Promise.resolve({ status: 'queued' }),
    })
    component = mount(ListedPersona, {
      target,
      props: {
        close: pickerMocks.close,
        mode: 'active-chat-generation-settings',
        target: targetIdentity,
      },
    })

    personaRow(1).click()

    await vi.waitFor(() => expect(pickerMocks.alertNormal).toHaveBeenCalledWith(language.settingsSaveQueued))
    expect(pickerMocks.close).toHaveBeenCalledOnce()
  })
})

describe('persona owner readiness', () => {
  it('renders valid resident owners while the persona collection is pre-ready', async () => {
    pickerMocks.ownerState.collections.statuses.personas = 'loading'
    component = mount(ListedPersona, { target, props: { close: pickerMocks.close } })
    await tick()

    expect(target.querySelectorAll('[data-risu-generation-picker-row]')).toHaveLength(2)
  })

  it('fails closed when the ready persona collection owner is missing', async () => {
    pickerMocks.ownerState.collections.values.personas = undefined
    component = mount(ListedPersona, { target, props: { close: pickerMocks.close } })
    await tick()

    expect(target.querySelectorAll('[data-risu-generation-picker-row]')).toHaveLength(0)
  })

  it('fails closed when the ready persona collection has duplicate stable IDs', async () => {
    pickerMocks.ownerState.collections.values.personas = [
      { id: 'persona-a', name: 'Persona A', note: '' },
      { id: 'persona-a', name: 'Ambiguous Persona', note: '' },
    ]
    component = mount(ListedPersona, { target, props: { close: pickerMocks.close } })
    await tick()

    expect(target.querySelectorAll('[data-risu-generation-picker-row]')).toHaveLength(0)
  })

  it('fails closed on an errored persona collection even with resident owners', async () => {
    pickerMocks.ownerState.collections.statuses.personas = 'error'
    component = mount(ListedPersona, { target, props: { close: pickerMocks.close } })
    await tick()

    expect(target.querySelectorAll('[data-risu-generation-picker-row]')).toHaveLength(0)
  })
})
