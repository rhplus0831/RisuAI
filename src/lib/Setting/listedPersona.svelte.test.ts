import { mount, tick, unmount } from 'svelte'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const pickerMocks = vi.hoisted(() => ({
  alertNormal: vi.fn(),
  changeUserPersonaWithOutcome: vi.fn(),
  close: vi.fn(),
  database: {
    personas: [
      { id: 'persona-a', name: 'Persona A', note: '' },
      { id: 'persona-b', name: 'Persona B', note: 'Second' },
    ],
    selectedPersona: 0,
  },
}))

vi.mock('src/ts/alert', () => ({
  alertNormal: pickerMocks.alertNormal,
}))

vi.mock('src/ts/persona', () => ({
  changeUserPersonaWithOutcome: pickerMocks.changeUserPersonaWithOutcome,
  validUniquePersonaIdAt: (index: number) => pickerMocks.database.personas[index]?.id ?? null,
}))

vi.mock('src/ts/personaDisplayName', () => ({
  getPersonaDisplayName: (persona: { name: string }) => persona.name,
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: () => pickerMocks.database,
}))

vi.mock('src/ts/activeChatGenerationSettings', () => ({
  resolveActiveChatGenerationSettings: () => ({ settings: null }),
  saveActiveChatGenerationSettingsSelection: vi.fn(() => true),
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
  pickerMocks.changeUserPersonaWithOutcome.mockReset()
  pickerMocks.close.mockReset()
  pickerMocks.database.selectedPersona = 0
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

    personaRow(1).click()
    personaRow(1).click()
    await tick()

    expect(pickerMocks.changeUserPersonaWithOutcome).toHaveBeenCalledOnce()
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
