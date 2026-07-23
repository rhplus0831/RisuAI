import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandSpies = vi.hoisted(() => ({
  updateModelRuntimeDefaultsDurably: vi.fn(),
}))

vi.mock('src/ts/server/commands', () => ({
  subscribeServerCommandLocalEffectApplied: vi.fn(() => () => {}),
}))
vi.mock('src/ts/model/modelProfileMutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/ts/model/modelProfileMutations')>()),
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

import ModelRuntimeDefaultsEditor from './ModelRuntimeDefaultsEditor.svelte'
import { language } from 'src/lang'
import { resolveModelProfile } from 'src/ts/model/modelProfileResolver'
import { finishPendingModelMutation, getPendingModelMutations } from 'src/ts/model/modelProfileMutations'
import { getDatabase, setDatabaseLite, type Database } from 'src/ts/storage/database.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function buttonByText(label: string): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(label),
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`)
  return button
}

function runtimeNumberInput(label: string): HTMLInputElement {
  const input = Array.from(target.querySelectorAll<HTMLLabelElement>('label'))
    .find((candidate) => candidate.querySelector('span')?.textContent === label)
    ?.querySelector<HTMLInputElement>('input[type="number"]')
  if (!input) throw new Error(`Runtime number input not found: ${label}`)
  return input
}

async function flushAsync(): Promise<void> {
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
    modelRuntimeDefaults: {
      maxContext: 4096,
      temperature: 70,
    },
  } as any)
  commandSpies.updateModelRuntimeDefaultsDurably.mockReset()
  commandSpies.updateModelRuntimeDefaultsDurably.mockResolvedValue({ status: 'accepted', result: { status: 'ok' } })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  clearPendingModelMutations()
  setDatabaseLite({} as any)
})

describe('ModelRuntimeDefaultsEditor', () => {
  it('resets the edit draft and saves empty runtime defaults through the command path', async () => {
    component = mount(ModelRuntimeDefaultsEditor, { target })

    buttonByText(language.modelProfiles.edit).click()
    await tick()

    buttonByText(language.modelProfiles.reset).click()
    await tick()

    const resetButton = buttonByText(language.modelProfiles.reset)
    expect(resetButton.disabled).toBe(true)

    buttonByText(language.modelProfiles.save).click()
    await flushAsync()

    expect(commandSpies.updateModelRuntimeDefaultsDurably).toHaveBeenCalledWith({})
  })

  it('stores decimal temperature entry on the x100 scale and resolves it back to the effective decimal', async () => {
    getDatabase().modelRuntimeDefaults = {}
    component = mount(ModelRuntimeDefaultsEditor, { target })

    buttonByText(language.modelProfiles.edit).click()
    await tick()

    const temperature = runtimeNumberInput(language.modelProfiles.runtimeFields.temperature)
    expect(temperature.value).toBe('')
    expect(temperature.min).toBe('0')
    expect(temperature.max).toBe('2')
    expect(temperature.step).toBe('0.01')

    temperature.value = '0.7'
    temperature.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    buttonByText(language.modelProfiles.save).click()
    await flushAsync()

    expect(commandSpies.updateModelRuntimeDefaultsDurably).toHaveBeenCalledWith({ temperature: 70 })

    const submittedDefaults = commandSpies.updateModelRuntimeDefaultsDurably.mock.calls[0][0]
    const database = {
      ...getDatabase(),
      modelProfiles: [
        {
          id: 'profile-runtime-defaults',
          name: 'Runtime Defaults',
          providerId: 'debug-echo',
          modelId: 'debug-echo',
        },
      ],
      modelRoleProfiles: {
        chatMain: { mode: 'profile', profileId: 'profile-runtime-defaults' },
      },
      modelRuntimeDefaults: submittedDefaults,
    } as Database

    expect(resolveModelProfile({ database, role: 'chatMain' }).runtimeOptions.temperature).toBe(0.7)
  })

  it('clamps decimal-facing scaled samplers while preserving the disabled sentinel', async () => {
    getDatabase().modelRuntimeDefaults = { presencePenalty: -1000 }
    component = mount(ModelRuntimeDefaultsEditor, { target })

    buttonByText(language.modelProfiles.edit).click()
    await tick()

    const temperature = runtimeNumberInput(language.modelProfiles.runtimeFields.temperature)
    const frequencyPenalty = runtimeNumberInput(language.modelProfiles.runtimeFields.frequencyPenalty)
    const presencePenalty = runtimeNumberInput(language.modelProfiles.runtimeFields.presencePenalty)
    expect(presencePenalty.value).toBe('-1000')

    temperature.value = '2.5'
    temperature.dispatchEvent(new Event('input', { bubbles: true }))
    frequencyPenalty.value = '-0.25'
    frequencyPenalty.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    buttonByText(language.modelProfiles.save).click()
    await flushAsync()

    expect(commandSpies.updateModelRuntimeDefaultsDurably).toHaveBeenCalledWith({
      temperature: 200,
      frequencyPenalty: 0,
      presencePenalty: -1000,
    })
  })

  it('locks the runtime form until a deferred save failure settles', async () => {
    const pending = deferred<{ status: 'failed'; result: { status: 'error'; error: string } }>()
    commandSpies.updateModelRuntimeDefaultsDurably.mockReturnValueOnce(pending.promise)
    component = mount(ModelRuntimeDefaultsEditor, { target })

    buttonByText(language.modelProfiles.edit).click()
    await tick()

    const maxContextInput = Array.from(target.querySelectorAll<HTMLInputElement>('input[type="number"]')).find(
      (input) => input.value === '4096',
    )
    const booleanSelect = target.querySelector<HTMLSelectElement>('select')
    if (!maxContextInput || !booleanSelect) throw new Error('Runtime defaults fields not found')
    maxContextInput.value = '8192'
    maxContextInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const reset = buttonByText(language.modelProfiles.reset)
    const cancel = buttonByText(language.modelProfiles.cancel)
    const save = buttonByText(language.modelProfiles.save)
    save.click()
    await flushAsync()

    const form = target.querySelector<HTMLFieldSetElement>('[data-model-runtime-defaults-form]')
    if (!form) throw new Error('Runtime defaults form not found')
    expect(form.getAttribute('aria-busy')).toBe('true')
    expect(form.disabled).toBe(true)
    expect(maxContextInput.closest('fieldset[disabled]')).toBe(form)
    expect(booleanSelect.closest('fieldset[disabled]')).toBe(form)
    expect(reset.disabled).toBe(true)
    expect(cancel.disabled).toBe(true)
    expect(save.disabled).toBe(true)

    reset.click()
    cancel.click()
    await tick()
    expect(target.querySelector('[data-model-runtime-defaults-form]')).toBe(form)
    expect(maxContextInput.value).toBe('8192')

    pending.resolve({ status: 'failed', result: { status: 'error', error: 'Runtime defaults save failed' } })
    await flushAsync()

    expect(form.getAttribute('aria-busy')).toBe('false')
    expect(form.disabled).toBe(false)
    expect(maxContextInput.closest('fieldset[disabled]')).toBeNull()
    expect(booleanSelect.closest('fieldset[disabled]')).toBeNull()
    expect(reset.disabled).toBe(false)
    expect(cancel.disabled).toBe(false)
    expect(target.textContent).toContain('Runtime defaults save failed')

    maxContextInput.value = '16384'
    maxContextInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    expect(maxContextInput.value).toBe('16384')
  })

  it('preserves untouched authoritative fields while an edit draft is dirty', async () => {
    component = mount(ModelRuntimeDefaultsEditor, { target })

    buttonByText(language.modelProfiles.edit).click()
    await tick()

    const maxContextInput = Array.from(target.querySelectorAll<HTMLInputElement>('input[type="number"]')).find(
      (input) => input.value === '4096',
    )
    if (!maxContextInput) throw new Error('Max context input not found')
    maxContextInput.value = '8192'
    maxContextInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    setDatabaseLite({
      modelRuntimeDefaults: {
        maxContext: 4096,
        maxResponse: 2048,
        temperature: 120,
      },
    } as any)
    await tick()

    buttonByText(language.modelProfiles.save).click()
    await flushAsync()

    expect(commandSpies.updateModelRuntimeDefaultsDurably).toHaveBeenCalledWith({
      maxContext: 8192,
      maxResponse: 2048,
      temperature: 120,
    })
  })

  it('closes and latches the editor when the save is durably queued', async () => {
    commandSpies.updateModelRuntimeDefaultsDurably.mockResolvedValue({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationId: 'queued-runtime-defaults',
    })
    component = mount(ModelRuntimeDefaultsEditor, { target })

    buttonByText(language.modelProfiles.edit).click()
    await tick()
    buttonByText(language.modelProfiles.reset).click()
    await tick()
    buttonByText(language.modelProfiles.save).click()
    await flushAsync()

    expect(target.querySelector('[data-model-runtime-command-notice]')).toBeNull()
    expect(buttonByText(language.modelProfiles.edit).disabled).toBe(true)
    expect(commandSpies.updateModelRuntimeDefaultsDurably).toHaveBeenCalledTimes(1)

    getDatabase().modelRuntimeDefaults = { maxContext: 1 }
    await flushAsync()
    expect(buttonByText(language.modelProfiles.edit).disabled).toBe(true)
    expect(target.querySelector('[data-model-runtime-command-notice]')).toBeNull()

    getDatabase().modelRuntimeDefaults = {}
    await flushAsync()
    expect(target.querySelector('[data-model-runtime-command-notice]')).toBeNull()
    expect(buttonByText(language.modelProfiles.edit).disabled).toBe(false)
  })

  it('releases the runtime form when the mutation helper rejects unexpectedly', async () => {
    commandSpies.updateModelRuntimeDefaultsDurably.mockRejectedValueOnce(new Error('staging rejected'))
    component = mount(ModelRuntimeDefaultsEditor, { target })

    buttonByText(language.modelProfiles.edit).click()
    await tick()
    buttonByText(language.modelProfiles.reset).click()
    await tick()
    buttonByText(language.modelProfiles.save).click()
    await flushAsync()

    const form = target.querySelector<HTMLFieldSetElement>('[data-model-runtime-defaults-form]')
    expect(form?.disabled).toBe(false)
    expect(form?.getAttribute('aria-busy')).toBe('false')
    expect(target.textContent).toContain(language.modelProfiles.commandUnavailable)
    expect(buttonByText(language.modelProfiles.save).disabled).toBe(false)
  })
})
