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

  it('patches the model preset selected when Apply was clicked after role bindings save', async () => {
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
    })

    getDatabase().modelPresetsId = 1
    roleCommand.resolve({ status: 'ok' })
    await flushAsync()

    expect(commandSpies.updateModelPresetCommand).toHaveBeenCalledTimes(1)
    expect(commandSpies.updateModelPresetCommand).toHaveBeenCalledWith({
      baseRevision: 123,
      modelPresetId: 'model-a',
      patch: {
        modelRoleProfiles: normalizeModelRoleProfiles({
          chatMain: { mode: 'profile', profileId: 'profile-1' },
        }),
      },
    })
    expect(commandSpies.runServerCommandSequence).toHaveBeenCalledTimes(1)
  })
})
