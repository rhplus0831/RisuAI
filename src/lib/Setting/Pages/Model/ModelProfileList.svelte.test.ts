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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
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
  it('keeps every custom API capability label readable in the drawer column', async () => {
    getDatabase().modelProfiles[0] = {
      id: 'profile-1',
      name: 'Custom API profile',
      providerId: 'custom-api',
      modelId: 'custom-api',
      providerOptions: { customApi: { flags: [] } },
    } as any
    component = mount(ModelProfileList, { target })
    await tick()

    const editTrigger = buttonsByText(language.modelProfiles.edit).at(-1)
    if (!editTrigger) throw new Error('Profile edit button not found')
    editTrigger.click()
    await tick()

    const flags = target.querySelector<HTMLElement>('[data-model-custom-api-flags]')
    const labels = Array.from(flags?.querySelectorAll('label span') ?? [])
    expect(flags).toBeTruthy()
    expect(flags?.classList.contains('grid-cols-1')).toBe(true)
    expect(flags?.classList.contains('sm:grid-cols-2')).toBe(false)
    expect(labels.length).toBeGreaterThan(10)
    expect(labels.every((label) => label.classList.contains('break-all'))).toBe(true)
  })

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

  it('sends the frozen profile baseline and keeps a conflicting draft after an authoritative refresh', async () => {
    getDatabase().modelProfiles = [
      {
        id: 'profile-1',
        name: 'Profile 1',
        providerId: 'openai',
        modelId: 'gpt-5',
        providerOptions: { requestModel: 'wire-v1' },
        runtimeOptions: { temperature: 50 },
      },
    ]
    commandSpies.updateModelProfileCommand.mockResolvedValue({ status: 'conflict', currentRevision: 124 })

    component = mount(ModelProfileList, { target })
    await tick()

    const profileEditButton = buttonsByText(language.modelProfiles.edit).at(-1)
    if (!profileEditButton) throw new Error('Profile edit button not found')
    profileEditButton.click()
    await tick()

    const nameInput = target.querySelector<HTMLInputElement>('input')
    if (!nameInput) throw new Error('Profile name input not found')
    nameInput.value = 'Locally renamed'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    getDatabase().modelProfiles = [
      {
        id: 'profile-1',
        name: 'Profile 1',
        providerId: 'openai',
        modelId: 'gpt-5',
        providerOptions: { requestModel: 'wire-v2' },
        runtimeOptions: { temperature: 70 },
      },
    ]
    await tick()

    buttonByText(language.modelProfiles.save).click()
    await flushAsync()

    expect(commandSpies.updateModelProfileCommand).toHaveBeenCalledWith({
      baseRevision: 123,
      profileId: 'profile-1',
      profile: {
        id: 'profile-1',
        name: 'Locally renamed',
        providerId: 'openai',
        modelId: 'gpt-5',
        providerOptions: { requestModel: 'wire-v1' },
        runtimeOptions: { temperature: 50 },
      },
      expectedProfile: {
        id: 'profile-1',
        name: 'Profile 1',
        providerId: 'openai',
        modelId: 'gpt-5',
        providerOptions: { requestModel: 'wire-v1' },
        runtimeOptions: { temperature: 50 },
      },
    })
    expect(target.querySelector('[role="dialog"]')).not.toBeNull()
    expect(nameInput.value).toBe('Locally renamed')
    expect(target.textContent).toContain(language.modelProfiles.commandConflict)
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

  it('locks profile fields and dismissal paths until a deferred save failure settles', async () => {
    const pending = deferred<{ status: 'error'; error: string }>()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    commandSpies.runServerCommand.mockImplementationOnce((input: { command: (baseRevision: number) => unknown }) => {
      input.command(123)
      return pending.promise
    })

    component = mount(ModelProfileList, { target })
    await tick()

    const profileEditButton = buttonsByText(language.modelProfiles.edit).at(-1)
    if (!profileEditButton) throw new Error('Profile edit button not found')
    profileEditButton.click()
    await tick()

    const nameInput = target.querySelector<HTMLInputElement>('input')
    if (!nameInput) throw new Error('Profile name input not found')
    nameInput.value = 'Pending profile name'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    buttonByText(language.modelProfiles.save).click()
    await flushAsync()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const backdrop = dialog?.parentElement
    const form = dialog?.querySelector<HTMLFieldSetElement>('[data-model-profile-editable-form]')
    const close = dialog?.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
    const providerSelect = dialog?.querySelector<HTMLSelectElement>('select')
    const cancel = buttonByText(language.modelProfiles.cancel)
    if (!dialog || !backdrop || !form || !close || !providerSelect) throw new Error('Busy profile editor not found')

    expect(dialog.getAttribute('aria-busy')).toBe('true')
    expect(form.getAttribute('aria-busy')).toBe('true')
    expect(form.disabled).toBe(true)
    expect(nameInput.closest('fieldset[disabled]')).toBe(form)
    expect(providerSelect.closest('fieldset[disabled]')).toBe(form)
    expect(close.disabled).toBe(true)
    expect(cancel.disabled).toBe(true)

    backdrop.click()
    close.click()
    cancel.click()
    const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    dialog.dispatchEvent(escape)
    await tick()

    expect(escape.defaultPrevented).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(target.querySelector('[role="dialog"]')).toBe(dialog)

    pending.resolve({ status: 'error', error: 'Profile save failed' })
    await flushAsync()

    expect(dialog.getAttribute('aria-busy')).toBe('false')
    expect(form.getAttribute('aria-busy')).toBe('false')
    expect(form.disabled).toBe(false)
    expect(nameInput.closest('fieldset[disabled]')).toBeNull()
    expect(providerSelect.closest('fieldset[disabled]')).toBeNull()
    expect(close.disabled).toBe(false)
    expect(cancel.disabled).toBe(false)
    expect(target.textContent).toContain('Profile save failed')

    nameInput.value = 'Editable after failure'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    expect(nameInput.value).toBe('Editable after failure')

    close.click()
    await tick()
    expect(confirm).toHaveBeenCalledWith(language.modelProfiles.discardProfileChangesConfirm)
    expect(target.querySelector('[role="dialog"]')).toBeNull()
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
