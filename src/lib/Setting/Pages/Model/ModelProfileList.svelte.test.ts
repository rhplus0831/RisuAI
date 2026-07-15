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
  subscribeServerCommandLocalEffectApplied: vi.fn(() => () => {}),
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
  vi.restoreAllMocks()
})

describe('ModelProfileList', () => {
  it('does not dispatch an unchanged profile save', async () => {
    component = mount(ModelProfileList, { target })
    await tick()

    const profileEditButton = buttonsByText(language.modelProfiles.edit).at(-1)
    if (!profileEditButton) throw new Error('Profile edit button not found')
    profileEditButton.click()
    await tick()

    const save = buttonByText(language.modelProfiles.save)
    expect(save.disabled).toBe(true)
    save.click()
    await flushAsync()

    expect(commandSpies.updateModelProfileCommand).not.toHaveBeenCalled()
    expect(commandSpies.runServerCommand).not.toHaveBeenCalled()
  })

  it('does not create a replacement when an edited profile disappears before save', async () => {
    component = mount(ModelProfileList, { target })
    await tick()

    const profileEditButton = buttonsByText(language.modelProfiles.edit).at(-1)
    if (!profileEditButton) throw new Error('Profile edit button not found')
    profileEditButton.click()
    await tick()

    const nameInput = target.querySelector<HTMLInputElement>('input')
    if (!nameInput) throw new Error('Profile name input not found')
    nameInput.value = 'Edited profile'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
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

  it('keeps a dirty profile draft when Escape dismissal is rejected', async () => {
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    component = mount(ModelProfileList, { target })
    await tick()

    const profileEditButton = buttonsByText(language.modelProfiles.edit).at(-1)
    if (!profileEditButton) throw new Error('Profile edit button not found')
    profileEditButton.click()
    await tick()

    const nameInput = target.querySelector<HTMLInputElement>('input')
    const providerSelect = target.querySelector<HTMLSelectElement>('select')
    if (!nameInput || !providerSelect) throw new Error('Profile editor fields not found')
    nameInput.value = 'Unsaved profile name'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    providerSelect.focus()
    const rejectedEscape = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    })
    providerSelect.dispatchEvent(rejectedEscape)
    await tick()

    expect(rejectedEscape.defaultPrevented).toBe(true)
    expect(confirm).toHaveBeenCalledWith(language.modelProfiles.discardProfileChangesConfirm)
    expect(target.querySelector('[role="dialog"]')).not.toBeNull()
    expect(nameInput.value).toBe('Unsaved profile name')

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    if (!dialog) throw new Error('Profile editor dialog not found')
    const dialogEscape = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    })
    dialog.dispatchEvent(dialogEscape)
    await tick()

    expect(dialogEscape.defaultPrevented).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(target.querySelector('[role="dialog"]')).not.toBeNull()

    confirm.mockReturnValue(true)
    providerSelect.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape',
      }),
    )
    await tick()

    expect(target.querySelector('[role="dialog"]')).toBeNull()
  })

  it('contains focus in the drawer and restores the edit trigger after Escape', async () => {
    component = mount(ModelProfileList, { target })
    await tick()

    const editTrigger = buttonsByText(language.modelProfiles.edit).at(-1)
    if (!editTrigger) throw new Error('Profile edit button not found')
    editTrigger.focus()
    editTrigger.click()
    await flushAsync()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const backdrop = dialog?.parentElement
    const initialFocus = dialog?.querySelector<HTMLElement>('[data-modal-initial-focus]')
    if (!dialog || !backdrop || !initialFocus) throw new Error('Profile editor modal not found')
    expect(backdrop.hasAttribute('data-modal-root')).toBe(true)
    expect(backdrop.hasAttribute('role')).toBe(false)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(initialFocus)

    let backgroundBranch: HTMLElement = editTrigger
    while (backgroundBranch.parentElement && backgroundBranch.parentElement !== backdrop.parentElement) {
      backgroundBranch = backgroundBranch.parentElement
    }
    expect(backgroundBranch.inert).toBe(true)

    editTrigger.focus()
    expect(document.activeElement).toBe(initialFocus)

    const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    initialFocus.dispatchEvent(escape)
    await flushAsync()

    expect(escape.defaultPrevented).toBe(true)
    expect(target.querySelector('[role="dialog"]')).toBeNull()
    expect(backgroundBranch.inert).toBe(false)
    expect(document.activeElement).toBe(editTrigger)
  })
})
