import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandSpies = vi.hoisted(() => ({
  runServerCommand: vi.fn(),
  updateModelRuntimeDefaultsCommand: vi.fn(),
}))

vi.mock('src/ts/server/commands', () => ({
  runServerCommand: commandSpies.runServerCommand,
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

import ModelRuntimeDefaultsEditor from './ModelRuntimeDefaultsEditor.svelte'
import { language } from 'src/lang'
import { setDatabaseLite } from 'src/ts/storage/database.svelte'

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

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  setDatabaseLite({
    modelRuntimeDefaults: {
      maxContext: 4096,
      temperature: 0.7,
    },
  } as any)
  commandSpies.runServerCommand.mockReset()
  commandSpies.updateModelRuntimeDefaultsCommand.mockReset()
  commandSpies.updateModelRuntimeDefaultsCommand.mockResolvedValue({ status: 'ok' })
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

    expect(commandSpies.updateModelRuntimeDefaultsCommand).toHaveBeenCalledWith({
      baseRevision: 123,
      runtimeDefaults: {},
    })
  })

  it('locks the runtime form until a deferred save failure settles', async () => {
    const pending = deferred<{ status: 'error'; error: string }>()
    commandSpies.runServerCommand.mockImplementationOnce((input: { command: (baseRevision: number) => unknown }) => {
      input.command(123)
      return pending.promise
    })
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

    pending.resolve({ status: 'error', error: 'Runtime defaults save failed' })
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
        temperature: 1.2,
      },
    } as any)
    await tick()

    buttonByText(language.modelProfiles.save).click()
    await flushAsync()

    expect(commandSpies.updateModelRuntimeDefaultsCommand).toHaveBeenCalledWith({
      baseRevision: 123,
      runtimeDefaults: {
        maxContext: 8192,
        maxResponse: 2048,
        temperature: 1.2,
      },
    })
  })
})
