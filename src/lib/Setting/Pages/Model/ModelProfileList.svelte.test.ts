import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandSpies = vi.hoisted(() => ({
  runServerCommand: vi.fn(),
  createModelProfileCommand: vi.fn(),
  updateModelProfileCommand: vi.fn(),
  duplicateModelProfileCommand: vi.fn(),
  deleteModelProfileCommand: vi.fn(),
  updateModelRuntimeDefaultsCommand: vi.fn(),
}))

vi.mock('src/ts/server/commands', () => ({
  runServerCommand: commandSpies.runServerCommand,
  createModelProfileCommand: commandSpies.createModelProfileCommand,
  updateModelProfileCommand: commandSpies.updateModelProfileCommand,
  duplicateModelProfileCommand: commandSpies.duplicateModelProfileCommand,
  deleteModelProfileCommand: commandSpies.deleteModelProfileCommand,
  updateModelRuntimeDefaultsCommand: commandSpies.updateModelRuntimeDefaultsCommand,
}))
vi.mock('src/ts/process/modules', () => ({
  applyModule: vi.fn(),
  exportModule: vi.fn(),
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  importModule: vi.fn(),
  moduleUpdate: vi.fn(),
  readModule: vi.fn(),
  refreshModules: vi.fn(),
}))

import ModelProfileList from './ModelProfileList.svelte'
import { language } from 'src/lang'
import { getDatabase, setDatabaseLite } from 'src/ts/storage/database.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function buttonByText(label: string): HTMLButtonElement {
  const button = buttonsByText(label)[0]
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`)
  return button
}

function buttonsByText(label: string): HTMLButtonElement[] {
  return Array.from(target.querySelectorAll('button')).filter(
    (candidate): candidate is HTMLButtonElement =>
      candidate instanceof HTMLButtonElement && !!candidate.textContent?.includes(label),
  )
}

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
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
        modelId: 'debug-echo',
        providerOptions: {
          apiKey: 'secret-key',
          vertex: {
            privateKey: 'vertex-secret',
          },
        },
      },
    ],
    modelRoleProfiles: {},
    modelRuntimeDefaults: {},
  } as any)
  for (const spy of Object.values(commandSpies)) {
    spy.mockReset()
  }
  commandSpies.runServerCommand.mockImplementation(async (input: { command: (baseRevision: number) => unknown }) => {
    return input.command(123)
  })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  setDatabaseLite({} as any)
})

describe('ModelProfileList', () => {
  it('does not create a replacement when an edited profile disappears before save', async () => {
    component = mount(ModelProfileList, { target })
    await tick()

    const profileEditButton = buttonsByText(language.modelProfiles.edit).at(-1)
    if (!profileEditButton) throw new Error('Profile edit button not found')
    profileEditButton.click()
    await tick()

    getDatabase().modelProfiles = []
    await tick()

    buttonByText(language.modelProfiles.save).click()
    await flushAsync()

    expect(commandSpies.createModelProfileCommand).not.toHaveBeenCalled()
    expect(commandSpies.updateModelProfileCommand).not.toHaveBeenCalled()
    expect(commandSpies.runServerCommand).not.toHaveBeenCalled()
    expect(target.textContent).toContain(language.modelProfiles.editTargetMissing)
    expect(target.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('duplicates profiles with secrets for internal settings copies', async () => {
    commandSpies.duplicateModelProfileCommand.mockResolvedValue({ status: 'ok' })

    component = mount(ModelProfileList, { target })
    await tick()

    buttonByText(language.modelProfiles.duplicate).click()
    await flushAsync()

    expect(commandSpies.duplicateModelProfileCommand).toHaveBeenCalledWith({
      baseRevision: 123,
      profileId: 'profile-1',
      name: language.modelProfiles.copyName('Profile 1'),
      includeSecrets: true,
    })
  })
})
