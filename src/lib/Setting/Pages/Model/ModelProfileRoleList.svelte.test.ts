import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandSpies = vi.hoisted(() => ({
  canUseServerCommands: vi.fn(),
  runServerCommandSequence: vi.fn(),
  updateModelPresetCommand: vi.fn(),
  updateModelRoleProfilesCommand: vi.fn(),
}))
const storeMocks = vi.hoisted(() => ({
  selIdState: {
    selId: -1,
  },
}))

vi.mock('src/ts/server/commands', () => ({
  canUseServerCommands: commandSpies.canUseServerCommands,
  runServerCommandSequence: commandSpies.runServerCommandSequence,
  subscribeServerCommandLocalEffectApplied: vi.fn(),
  updateModelPresetCommand: commandSpies.updateModelPresetCommand,
  updateModelRoleProfilesCommand: commandSpies.updateModelRoleProfilesCommand,
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
  commandSpies.runServerCommandSequence.mockReset()
  commandSpies.canUseServerCommands.mockReset()
  commandSpies.canUseServerCommands.mockReturnValue(true)
  commandSpies.updateModelPresetCommand.mockReset()
  commandSpies.updateModelRoleProfilesCommand.mockReset()
  commandSpies.runServerCommandSequence.mockImplementation(
    async (commands: Array<(baseRevision: number) => Promise<{ status: string }>>) => {
      for (const command of commands) {
        const result = await command(123)
        if (result.status !== 'ok') return result
      }
      return null
    },
  )
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
    commandSpies.canUseServerCommands.mockReturnValue(false)
    component = mount(ModelProfileRoleList, { target })
    await tick()

    const [chatMainModeSelect] = Array.from(target.querySelectorAll('select'))
    if (!(chatMainModeSelect instanceof HTMLSelectElement)) throw new Error('Chat main binding mode select not found')
    setSelectValue(chatMainModeSelect, 'profile')
    await tick()

    buttonByText(language.modelProfiles.apply).click()
    await tick()

    expect(target.textContent).toContain(language.modelProfiles.commandUnavailable)
    expect(commandSpies.runServerCommandSequence).not.toHaveBeenCalled()
  })

  it('atomically mirrors roles into the model preset selected when Apply was clicked', async () => {
    const roleCommand = createDeferred<{ status: 'ok' }>()
    commandSpies.updateModelRoleProfilesCommand.mockReturnValue(roleCommand.promise)
    component = mount(ModelProfileRoleList, { target })
    await tick()

    const [chatMainModeSelect] = Array.from(target.querySelectorAll('select'))
    if (!(chatMainModeSelect instanceof HTMLSelectElement)) throw new Error('Chat main binding mode select not found')

    setSelectValue(chatMainModeSelect, 'profile')
    await tick()

    buttonByText(language.modelProfiles.apply).click()
    await tick()

    expect(commandSpies.updateModelRoleProfilesCommand).toHaveBeenCalledWith({
      baseRevision: 123,
      bindings: {
        chatMain: { mode: 'profile', profileId: 'profile-1' },
      },
      modelPresetId: 'model-a',
    })

    getDatabase().modelPresetsId = 1
    roleCommand.resolve({ status: 'ok' })
    await flushAsync()

    expect(commandSpies.updateModelPresetCommand).not.toHaveBeenCalled()
    expect(commandSpies.runServerCommandSequence).toHaveBeenCalledTimes(1)
  })

  it('keeps Apply retryable when the atomic role update fails', async () => {
    commandSpies.updateModelRoleProfilesCommand.mockResolvedValue({ status: 'error', error: 'save failed' })
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
    const roleCommand = createDeferred<{ status: 'ok' }>()
    commandSpies.updateModelRoleProfilesCommand.mockReturnValue(roleCommand.promise)
    component = mount(ModelProfileRoleList, { target })
    await tick()

    const [chatMainModeSelect] = Array.from(target.querySelectorAll('select'))
    if (!(chatMainModeSelect instanceof HTMLSelectElement)) throw new Error('Chat main binding mode select not found')

    setSelectValue(chatMainModeSelect, 'profile')
    await tick()
    buttonByText(language.modelProfiles.apply).click()
    await tick()

    expect(Array.from(target.querySelectorAll('select')).every((select) => select.disabled)).toBe(true)

    roleCommand.resolve({ status: 'ok' })
    await flushAsync()

    expect(Array.from(target.querySelectorAll('select')).every((select) => !select.disabled)).toBe(true)
  })

  it('rebases authoritative changes for untouched roles without discarding a dirty role', async () => {
    commandSpies.updateModelRoleProfilesCommand.mockResolvedValue({ status: 'ok' })
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

    expect(commandSpies.updateModelRoleProfilesCommand).toHaveBeenCalledWith({
      baseRevision: 123,
      bindings: {
        chatMain: { mode: 'profile', profileId: 'profile-1' },
      },
      modelPresetId: 'model-a',
    })
  })

  it('preserves a dirty role when that authoritative binding changes to a different value', async () => {
    commandSpies.updateModelRoleProfilesCommand.mockResolvedValue({ status: 'ok' })
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

    expect(commandSpies.updateModelRoleProfilesCommand).toHaveBeenCalledWith({
      baseRevision: 123,
      bindings: {
        chatMain: { mode: 'profile', profileId: 'profile-1' },
      },
      modelPresetId: 'model-a',
    })
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
