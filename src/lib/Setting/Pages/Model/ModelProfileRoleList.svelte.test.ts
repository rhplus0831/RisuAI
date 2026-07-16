import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandSpies = vi.hoisted(() => ({
  updateModelRoleProfilesDurably: vi.fn(),
  updateModelPresetCommand: vi.fn(),
}))
const storeMocks = vi.hoisted(() => ({
  selIdState: {
    selId: -1,
  },
}))

vi.mock('src/ts/server/commands', () => ({
  subscribeServerCommandLocalEffectApplied: vi.fn(),
  updateModelPresetCommand: commandSpies.updateModelPresetCommand,
}))
vi.mock('src/ts/model/modelProfileMutations', () => ({
  updateModelRoleProfilesDurably: commandSpies.updateModelRoleProfilesDurably,
}))
vi.mock('src/ts/stores.svelte', () => ({
  selIdState: storeMocks.selIdState,
}))
import ModelProfileRoleList from './ModelProfileRoleList.svelte'
import { language } from 'src/lang'
import { normalizeModelRoleProfiles } from 'src/ts/model/modelProfileRecords'
import { getDatabase, setDatabaseLite } from 'src/ts/storage/database.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

let target: HTMLElement
let component: MountedComponent | undefined

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function buttonByText(label: string): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(label),
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`)
  return button
}

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function roleModeSelect(roleIndex: number): HTMLSelectElement {
  const row = target.querySelectorAll('tbody tr')[roleIndex]
  const select = row?.querySelector('select')
  if (!(select instanceof HTMLSelectElement)) throw new Error(`Role mode select not found at index ${roleIndex}`)
  return select
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  setDatabaseLite({
    modelProfiles: [
      {
        id: 'profile-1',
        name: 'Profile 1',
        providerId: 'debug-echo',
        modelId: 'echo_model',
      },
    ],
    modelRoleProfiles: normalizeModelRoleProfiles(undefined),
    modelPresets: [
      {
        id: 'model-a',
        name: 'Model A',
      },
      {
        id: 'model-b',
        name: 'Model B',
      },
    ],
    modelPresetsId: 0,
  } as any)
  commandSpies.updateModelRoleProfilesDurably.mockReset()
  commandSpies.updateModelRoleProfilesDurably.mockResolvedValue({ status: 'accepted', result: { status: 'ok' } })
  commandSpies.updateModelPresetCommand.mockReset()
  commandSpies.updateModelPresetCommand.mockResolvedValue({ status: 'ok' })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  setDatabaseLite({} as any)
})

describe('ModelProfileRoleList', () => {
  it('gives each role binding and profile select a unique accessible name', async () => {
    component = mount(ModelProfileRoleList, { target })
    await tick()

    const modeSelects = Array.from(target.querySelectorAll<HTMLSelectElement>('select'))
    const modeNames = modeSelects.map((select) => select.getAttribute('aria-label'))

    expect(modeNames[0]).toBe(`${language.modelRoles.roles.chatMain}: ${language.modelProfiles.bindingModeColumn}`)
    expect(modeNames.every(Boolean)).toBe(true)
    expect(new Set(modeNames).size).toBe(modeNames.length)

    setSelectValue(modeSelects[0], 'profile')
    await tick()

    const chatMainSelects = Array.from(target.querySelectorAll<HTMLSelectElement>('tbody tr:first-child select'))
    expect(chatMainSelects.map((select) => select.getAttribute('aria-label'))).toEqual([
      `${language.modelRoles.roles.chatMain}: ${language.modelProfiles.bindingModeColumn}`,
      `${language.modelRoles.roles.chatMain}: ${language.modelProfiles.effectiveProfileColumn}`,
    ])
  })

  it('reports an unavailable command transport without treating it as success', async () => {
    commandSpies.updateModelRoleProfilesDurably.mockResolvedValue({
      status: 'failed',
      result: { status: 'unavailable' },
    })
    component = mount(ModelProfileRoleList, { target })
    await tick()

    const [chatMainModeSelect] = Array.from(target.querySelectorAll('select'))
    if (!(chatMainModeSelect instanceof HTMLSelectElement)) throw new Error('Chat main binding mode select not found')
    setSelectValue(chatMainModeSelect, 'profile')
    await tick()

    buttonByText(language.modelProfiles.apply).click()
    await tick()

    expect(target.textContent).toContain(language.modelProfiles.commandUnavailable)
    expect(commandSpies.updateModelRoleProfilesDurably).toHaveBeenCalledTimes(1)
  })

  it('atomically mirrors roles into the model preset selected when Apply was clicked', async () => {
    const roleCommand = createDeferred<{ status: 'accepted'; result: { status: 'ok' } }>()
    commandSpies.updateModelRoleProfilesDurably.mockReturnValue(roleCommand.promise)
    component = mount(ModelProfileRoleList, { target })
    await tick()

    const [chatMainModeSelect] = Array.from(target.querySelectorAll('select'))
    if (!(chatMainModeSelect instanceof HTMLSelectElement)) throw new Error('Chat main binding mode select not found')

    setSelectValue(chatMainModeSelect, 'profile')
    await tick()

    buttonByText(language.modelProfiles.apply).click()
    await tick()

    expect(commandSpies.updateModelRoleProfilesDurably).toHaveBeenCalledWith(
      {
        chatMain: { mode: 'profile', profileId: 'profile-1' },
      },
      'model-a',
    )

    getDatabase().modelPresetsId = 1
    roleCommand.resolve({ status: 'accepted', result: { status: 'ok' } })
    await flushAsync()

    expect(commandSpies.updateModelPresetCommand).not.toHaveBeenCalled()
    expect(commandSpies.updateModelRoleProfilesDurably).toHaveBeenCalledTimes(1)
  })

  it('keeps Apply retryable when the atomic role update fails', async () => {
    commandSpies.updateModelRoleProfilesDurably.mockResolvedValue({
      status: 'failed',
      result: { status: 'error', error: 'save failed' },
    })
    component = mount(ModelProfileRoleList, { target })
    await tick()

    setSelectValue(roleModeSelect(0), 'profile')
    await tick()
    buttonByText(language.modelProfiles.apply).click()
    await flushAsync()

    expect(target.textContent).toContain('save failed')
    expect(target.textContent).toContain(language.modelProfiles.unsavedRoleChanges)
    expect(buttonByText(language.modelProfiles.apply).disabled).toBe(false)
    expect(commandSpies.updateModelPresetCommand).not.toHaveBeenCalled()
  })

  it('prevents role edits while Apply is pending', async () => {
    const roleCommand = createDeferred<{ status: 'accepted'; result: { status: 'ok' } }>()
    commandSpies.updateModelRoleProfilesDurably.mockReturnValue(roleCommand.promise)
    component = mount(ModelProfileRoleList, { target })
    await tick()

    const [chatMainModeSelect] = Array.from(target.querySelectorAll('select'))
    if (!(chatMainModeSelect instanceof HTMLSelectElement)) throw new Error('Chat main binding mode select not found')

    setSelectValue(chatMainModeSelect, 'profile')
    await tick()
    buttonByText(language.modelProfiles.apply).click()
    await tick()

    expect(Array.from(target.querySelectorAll('select')).every((select) => select.disabled)).toBe(true)

    roleCommand.resolve({ status: 'accepted', result: { status: 'ok' } })
    await flushAsync()

    expect(Array.from(target.querySelectorAll('select')).every((select) => !select.disabled)).toBe(true)
  })

  it('latches a durably queued role update until its projection converges', async () => {
    commandSpies.updateModelRoleProfilesDurably.mockResolvedValue({
      status: 'queued',
      result: { status: 'unavailable' },
    })
    component = mount(ModelProfileRoleList, { target })
    await tick()

    setSelectValue(roleModeSelect(0), 'profile')
    await tick()
    buttonByText(language.modelProfiles.apply).click()
    await flushAsync()

    expect(target.querySelector('[data-model-role-command-notice]')?.textContent).toContain(
      language.modelProfiles.commandQueued,
    )
    expect(buttonByText(language.modelProfiles.apply).disabled).toBe(true)
    expect(buttonByText(language.modelProfiles.cancel).disabled).toBe(true)
    expect(Array.from(target.querySelectorAll('select')).every((select) => select.disabled)).toBe(true)

    buttonByText(language.modelProfiles.apply).click()
    await flushAsync()
    expect(commandSpies.updateModelRoleProfilesDurably).toHaveBeenCalledTimes(1)

    getDatabase().modelRoleProfiles = normalizeModelRoleProfiles({
      chatAux: { mode: 'profile', profileId: 'profile-1' },
    })
    await flushAsync()
    expect(target.querySelector('[data-model-role-command-notice]')).not.toBeNull()
    expect(Array.from(target.querySelectorAll('select')).every((select) => select.disabled)).toBe(true)

    getDatabase().modelRoleProfiles = normalizeModelRoleProfiles({
      chatMain: { mode: 'profile', profileId: 'profile-1' },
      chatAux: { mode: 'profile', profileId: 'profile-1' },
    })
    await flushAsync()
    expect(target.querySelector('[data-model-role-command-notice]')).toBeNull()
    expect(Array.from(target.querySelectorAll('select')).every((select) => !select.disabled)).toBe(true)
  })

  it('rebases authoritative changes for untouched roles without discarding a dirty role', async () => {
    component = mount(ModelProfileRoleList, { target })
    await tick()

    setSelectValue(roleModeSelect(0), 'profile')
    await tick()

    getDatabase().modelRoleProfiles = normalizeModelRoleProfiles({
      chatAux: { mode: 'profile', profileId: 'profile-1' },
    })
    await flushAsync()

    expect(roleModeSelect(0).value).toBe('profile')
    expect(roleModeSelect(1).value).toBe('profile')
    expect(target.textContent).toContain(language.modelProfiles.unsavedRoleChanges)

    buttonByText(language.modelProfiles.apply).click()
    await flushAsync()

    expect(commandSpies.updateModelRoleProfilesDurably).toHaveBeenCalledWith(
      {
        chatMain: { mode: 'profile', profileId: 'profile-1' },
      },
      'model-a',
    )
  })

  it('preserves a dirty role when that authoritative binding changes to a different value', async () => {
    getDatabase().modelProfiles = [
      ...(getDatabase().modelProfiles ?? []),
      {
        id: 'profile-2',
        name: 'Profile 2',
        providerId: 'debug-echo',
        modelId: 'echo_model',
      },
    ]
    component = mount(ModelProfileRoleList, { target })
    await tick()

    setSelectValue(roleModeSelect(0), 'profile')
    await tick()

    getDatabase().modelRoleProfiles = normalizeModelRoleProfiles({
      chatMain: { mode: 'profile', profileId: 'profile-2' },
    })
    await flushAsync()

    const profileSelect = target.querySelector('tbody tr:first-child select:nth-of-type(2)')
    expect(profileSelect).toBeInstanceOf(HTMLSelectElement)
    expect((profileSelect as HTMLSelectElement).value).toBe('profile-1')

    buttonByText(language.modelProfiles.apply).click()
    await flushAsync()

    expect(commandSpies.updateModelRoleProfilesDurably).toHaveBeenCalledWith(
      {
        chatMain: { mode: 'profile', profileId: 'profile-1' },
      },
      'model-a',
    )
  })

  it('clears a dirty role when the authoritative binding converges on the draft', async () => {
    component = mount(ModelProfileRoleList, { target })
    await tick()

    setSelectValue(roleModeSelect(0), 'profile')
    await tick()
    expect(target.textContent).toContain(language.modelProfiles.unsavedRoleChanges)

    getDatabase().modelRoleProfiles = normalizeModelRoleProfiles({
      chatMain: { mode: 'profile', profileId: 'profile-1' },
    })
    await flushAsync()

    expect(target.textContent).toContain(language.modelProfiles.noUnsavedRoleChanges)
    expect(buttonByText(language.modelProfiles.apply).disabled).toBe(true)
  })
})
