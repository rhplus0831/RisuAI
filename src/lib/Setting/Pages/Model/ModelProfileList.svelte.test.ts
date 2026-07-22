import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandSpies = vi.hoisted(() => ({
  createModelProfileDurably: vi.fn(),
  updateModelProfileDurably: vi.fn(),
  duplicateModelProfileDurably: vi.fn(),
  deleteModelProfileDurably: vi.fn(),
  updateModelRuntimeDefaultsDurably: vi.fn(),
}))

vi.mock('src/ts/server/commands', () => ({
  subscribeServerCommandLocalEffectApplied: vi.fn(() => () => {}),
}))
vi.mock('src/ts/model/modelProfileMutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/ts/model/modelProfileMutations')>()),
  createModelProfileDurably: commandSpies.createModelProfileDurably,
  updateModelProfileDurably: commandSpies.updateModelProfileDurably,
  duplicateModelProfileDurably: commandSpies.duplicateModelProfileDurably,
  deleteModelProfileDurably: commandSpies.deleteModelProfileDurably,
  updateModelRuntimeDefaultsDurably: commandSpies.updateModelRuntimeDefaultsDurably,
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
import { finishPendingModelMutation, getPendingModelMutations } from 'src/ts/model/modelProfileMutations'
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

function clearPendingModelMutations(): void {
  for (const lane of ['model-profiles', 'model-runtime-defaults'] as const) {
    for (const pending of getPendingModelMutations(lane)) finishPendingModelMutation(pending.token)
  }
}

beforeEach(() => {
  clearPendingModelMutations()
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
    spy.mockResolvedValue({ status: 'accepted', result: { status: 'ok' } })
  }
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  clearPendingModelMutations()
  setDatabaseLite({} as any)
  vi.restoreAllMocks()
})

describe('ModelProfileList', () => {
  it('keeps custom API capability labels readable in the responsive drawer grid', async () => {
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
    expect(flags?.classList.contains('sm:grid-cols-2')).toBe(true)
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

    expect(commandSpies.updateModelProfileDurably).not.toHaveBeenCalled()
  })

  it.each(['custom-api', 'anthropic'] as const)(
    'does not carry an OpenAI credential when the provider changes to %s',
    async (nextProviderId) => {
      getDatabase().modelProfiles[0] = {
        id: 'profile-1',
        name: 'OpenAI profile',
        providerId: 'openai',
        modelId: 'gpt-5',
        providerOptions: { apiKey: 'openai-secret' },
      }
      component = mount(ModelProfileList, { target })
      await tick()

      const profileEditButton = buttonsByText(language.modelProfiles.edit).at(-1)
      if (!profileEditButton) throw new Error('Profile edit button not found')
      profileEditButton.click()
      await tick()

      const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
      const providerSelect = dialog?.querySelector<HTMLSelectElement>('select')
      expect(providerSelect).toBeTruthy()
      expect(dialog?.querySelector('[data-secret-saved-state]')).not.toBeNull()

      providerSelect!.value = nextProviderId
      providerSelect!.dispatchEvent(new Event('change', { bubbles: true }))
      await tick()

      expect(dialog?.querySelector('[data-secret-saved-state]')).toBeNull()
      expect(dialog?.querySelector('[data-model-profile-provider-secret-reset]')?.textContent).toContain(
        language.modelProfiles.providerChangeClearedCredential,
      )

      buttonByText(language.modelProfiles.save).click()
      await flushAsync()

      expect(commandSpies.updateModelProfileDurably).toHaveBeenCalledOnce()
      const submitted = commandSpies.updateModelProfileDurably.mock.calls[0][1]
      expect(submitted.providerId).toBe(nextProviderId)
      expect(submitted.providerOptions?.apiKey).toBeUndefined()
      expect(JSON.stringify(submitted)).not.toContain('__RISU_SECRET_MASKED__')
    },
  )

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
    commandSpies.updateModelProfileDurably.mockResolvedValue({
      status: 'failed',
      result: { status: 'conflict', currentRevision: 124 },
    })

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

    expect(commandSpies.updateModelProfileDurably).toHaveBeenCalledWith(
      'profile-1',
      {
        id: 'profile-1',
        name: 'Locally renamed',
        providerId: 'openai',
        modelId: 'gpt-5',
        providerOptions: { requestModel: 'wire-v1' },
        runtimeOptions: { temperature: 50 },
      },
      {
        id: 'profile-1',
        name: 'Profile 1',
        providerId: 'openai',
        modelId: 'gpt-5',
        providerOptions: { requestModel: 'wire-v1' },
        runtimeOptions: { temperature: 50 },
      },
    )
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

    expect(commandSpies.createModelProfileDurably).not.toHaveBeenCalled()
    expect(commandSpies.updateModelProfileDurably).not.toHaveBeenCalled()
    expect(target.textContent).toContain(language.modelProfiles.editTargetMissing)
    expect(target.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('locks profile fields and dismissal paths until a deferred save failure settles', async () => {
    const pending = deferred<{ status: 'failed'; result: { status: 'error'; error: string } }>()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    commandSpies.updateModelProfileDurably.mockReturnValueOnce(pending.promise)

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

    pending.resolve({ status: 'failed', result: { status: 'error', error: 'Profile save failed' } })
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
    component = mount(ModelProfileList, { target })
    await tick()

    buttonByText(language.modelProfiles.duplicate).click()
    await flushAsync()

    expect(commandSpies.duplicateModelProfileDurably).toHaveBeenCalledWith(
      'profile-1',
      language.modelProfiles.copyName('Profile 1'),
      true,
    )
  })

  it('releases profile controls when the mutation helper rejects unexpectedly', async () => {
    commandSpies.duplicateModelProfileDurably.mockRejectedValueOnce(new Error('staging rejected'))
    component = mount(ModelProfileList, { target })
    await tick()

    buttonByText(language.modelProfiles.duplicate).click()
    await flushAsync()

    expect(target.textContent).toContain(language.modelProfiles.commandUnavailable)
    expect(buttonByText(language.modelProfiles.duplicate).disabled).toBe(false)
    expect(buttonByText(language.modelProfiles.createProfile).disabled).toBe(false)
    expect(getPendingModelMutations('model-profiles')).toEqual([])
  })

  it('latches a queued profile mutation and prevents duplicate submits', async () => {
    commandSpies.duplicateModelProfileDurably.mockResolvedValue({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationId: 'queued-duplicate',
    })
    component = mount(ModelProfileList, { target })
    await tick()

    const duplicate = buttonByText(language.modelProfiles.duplicate)
    duplicate.click()
    await flushAsync()

    expect(target.querySelector('[data-model-profile-command-notice]')).toBeNull()
    expect(duplicate.disabled).toBe(true)
    expect(buttonByText(language.modelProfiles.createProfile).disabled).toBe(true)
    duplicate.click()
    await flushAsync()
    expect(commandSpies.duplicateModelProfileDurably).toHaveBeenCalledTimes(1)

    getDatabase().modelProfiles = [
      ...getDatabase().modelProfiles,
      {
        id: 'unrelated-copy',
        name: language.modelProfiles.copyName('Profile 1'),
        providerId: 'debug-echo',
        modelId: 'different-model',
      },
    ]
    await flushAsync()
    expect(duplicate.disabled).toBe(true)
    expect(target.querySelector('[data-model-profile-command-notice]')).toBeNull()

    getDatabase().modelProfiles = [
      ...getDatabase().modelProfiles,
      {
        ...JSON.parse(JSON.stringify(getDatabase().modelProfiles[0])),
        id: 'profile-copy',
        name: language.modelProfiles.copyName('Profile 1'),
        providerOptions: {
          apiKey: '__RISU_SECRET_MASKED__',
          vertex: { privateKey: '__RISU_SECRET_MASKED__' },
        },
      },
    ]
    await flushAsync()
    expect(target.querySelector('[data-model-profile-command-notice]')).toBeNull()
    expect(duplicate.disabled).toBe(false)
  })

  it('keeps a queued generated-ID duplicate fenced across a component remount', async () => {
    commandSpies.duplicateModelProfileDurably.mockResolvedValue({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationId: 'queued-duplicate-remount',
    })
    component = mount(ModelProfileList, { target })
    await tick()

    buttonByText(language.modelProfiles.duplicate).click()
    await flushAsync()
    unmount(component)
    component = undefined
    target.replaceChildren()

    component = mount(ModelProfileList, { target })
    await tick()
    const duplicate = buttonByText(language.modelProfiles.duplicate)
    expect(duplicate.disabled).toBe(true)
    duplicate.click()
    await flushAsync()
    expect(commandSpies.duplicateModelProfileDurably).toHaveBeenCalledTimes(1)

    getDatabase().modelProfiles = [
      ...getDatabase().modelProfiles,
      {
        ...JSON.parse(JSON.stringify(getDatabase().modelProfiles[0])),
        id: 'profile-copy-after-remount',
        name: language.modelProfiles.copyName('Profile 1'),
        providerOptions: {
          apiKey: '__RISU_SECRET_MASKED__',
          vertex: { privateKey: '__RISU_SECRET_MASKED__' },
        },
      },
    ]
    await flushAsync()
    expect(buttonByText(language.modelProfiles.duplicate).disabled).toBe(false)
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
