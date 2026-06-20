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

import ModelRuntimeDefaultsEditor from './ModelRuntimeDefaultsEditor.svelte'
import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'

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

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  DBState.db = {
    modelRuntimeDefaults: {
      maxContext: 4096,
      temperature: 0.7,
    },
  } as any
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
  DBState.db = {} as any
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
})
