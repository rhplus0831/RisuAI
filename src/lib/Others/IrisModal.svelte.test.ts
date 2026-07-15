import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const irisMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  forageGetItem: vi.fn(async () => null),
  forageSetItem: vi.fn(async (_key: string, _value: unknown) => undefined),
  getIrisSystemPrompt: vi.fn(async () => 'Iris system prompt'),
  requestChatData: vi.fn(),
  getToolList: vi.fn(async () => []),
}))

vi.mock('src/ts/alert', () => ({ alertError: irisMocks.alertError }))

vi.mock('src/ts/iris', () => ({ getIrisSystemPrompt: irisMocks.getIrisSystemPrompt }))

vi.mock('localforage', () => ({
  default: {
    createInstance: () => ({
      getItem: irisMocks.forageGetItem,
      setItem: irisMocks.forageSetItem,
    }),
  },
}))

vi.mock('src/ts/process/request/request', () => ({
  requestChatData: irisMocks.requestChatData,
}))

vi.mock('src/ts/process/mcp/risuaccess', () => ({
  RisuAccessClient: class {
    getToolList = irisMocks.getToolList
  },
}))

import IrisModal from './IrisModal.svelte'
import type { Database } from 'src/ts/storage/database.svelte'
import { replaceResourceDatabase as setDatabaseLite } from 'src/ts/server/resourceState.svelte'

const originalAnimate = Element.prototype.animate

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await tick()
    await Promise.resolve()
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function submitMessage(text: string): Promise<void> {
  await vi.runAllTimersAsync()
  await settle()
  const input = target.querySelector<HTMLInputElement>('input[type="text"]')
  expect(input).not.toBeNull()
  input!.value = text
  input!.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
  const send = Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Send')
  expect(send).toBeDefined()
  expect(send!.disabled).toBe(false)
  send!.click()
  await settle()
}

async function resetFromBacklog(): Promise<void> {
  const log = target.querySelector<HTMLButtonElement>('button[title^="View backlog"]')
  expect(log).not.toBeNull()
  log!.click()
  await tick()
  const reset = target.querySelector<HTMLButtonElement>('button[aria-label="Reset"]')
  expect(reset).not.toBeNull()
  reset!.click()
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({
      cancel: vi.fn(),
      commitStyles: vi.fn(),
      finished: Promise.resolve(),
      pause: vi.fn(),
      play: vi.fn(),
      reverse: vi.fn(),
    })),
  })
  target = document.createElement('div')
  document.body.appendChild(target)
  setDatabaseLite({
    language: 'en',
    aiModel: 'echo_model',
    subModel: 'echo_model',
    modelRoles: {
      otherAx: 'claude-3-haiku-20240307',
    },
    seperateModelsForAxModels: false,
    seperateModels: {
      memory: '',
      emotion: '',
      translate: '',
      otherAx: '',
      scriptMain: '',
      scriptAux: '',
    },
    customModels: [],
  } as unknown as Database)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  setDatabaseLite({} as Database)
  if (originalAnimate) {
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: originalAnimate,
    })
  } else {
    delete (Element.prototype as { animate?: unknown }).animate
  }
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('IrisModal model availability', () => {
  it('treats canonical otherAx overrides as available even when subModel is unsupported', async () => {
    component = mount(IrisModal, { target })
    await settle()

    expect(target.textContent).not.toContain("doesn't support me responding")
  })

  it('removes parenthesized and mustache metadata from new dialogue', async () => {
    component = mount(IrisModal, { target })
    await settle()
    ;(
      component as unknown as {
        pushDialogue: (line: { speaker: string; text: string }) => void
      }
    ).pushDialogue({ speaker: 'You', text: '(private direction) Hello {{hidden state}}' })
    await settle()

    const savedDialogue = irisMocks.forageSetItem.mock.calls.at(-1)?.[1] as Array<{
      speaker: string
      text: string
    }>
    expect(savedDialogue.at(-1)).toEqual({ speaker: 'You', text: 'Hello' })
  })

  it('cancels an older typing animation when a newer line starts', async () => {
    component = mount(IrisModal, { target })
    await settle()
    const pushDialogue = (
      component as unknown as {
        pushDialogue: (line: { speaker: string; text: string }) => void
      }
    ).pushDialogue

    pushDialogue({ speaker: 'You', text: 'First line' })
    pushDialogue({ speaker: 'You', text: 'Second line' })
    await vi.runAllTimersAsync()
    await settle()

    const dialogueText = target.querySelector('[aria-live="polite"]')
    expect(dialogueText?.textContent?.trim()).toBe('Second line')
  })

  it('clears the active typing timer when the modal is destroyed', async () => {
    component = mount(IrisModal, { target })
    await settle()
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount(component)
    component = undefined

    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a successful response after the dialogue is reset', async () => {
    const response = deferred<{ type: 'success'; result: string }>()
    irisMocks.requestChatData.mockReturnValue(response.promise)
    component = mount(IrisModal, { target })
    await settle()

    await submitMessage('Question before reset')
    expect(irisMocks.requestChatData).toHaveBeenCalledOnce()
    await resetFromBacklog()

    response.resolve({ type: 'success', result: 'Stale Iris response' })
    await settle()

    const savedDialogue = irisMocks.forageSetItem.mock.calls.at(-1)?.[1] as DialogueLineForTest[]
    expect(savedDialogue).toHaveLength(1)
    expect(savedDialogue.some((line) => line.text === 'Stale Iris response')).toBe(false)
  })

  it('ignores a failed response after the dialogue is reset', async () => {
    const response = deferred<{ type: 'fail'; result: string }>()
    irisMocks.requestChatData.mockReturnValue(response.promise)
    component = mount(IrisModal, { target })
    await settle()

    await submitMessage('Question before reset')
    await resetFromBacklog()

    response.resolve({ type: 'fail', result: 'Stale failure' })
    await settle()

    expect(irisMocks.alertError).not.toHaveBeenCalled()
    const savedDialogue = irisMocks.forageSetItem.mock.calls.at(-1)?.[1] as DialogueLineForTest[]
    expect(savedDialogue).toHaveLength(1)
  })

  it('restores the previous line when the current request fails', async () => {
    const response = deferred<{ type: 'fail'; result: string }>()
    irisMocks.requestChatData.mockReturnValue(response.promise)
    component = mount(IrisModal, { target })
    await settle()

    await submitMessage('Question that fails')
    response.resolve({ type: 'fail', result: 'Provider failed' })
    await settle()

    expect(irisMocks.alertError).toHaveBeenCalledOnce()
    const savedDialogue = irisMocks.forageSetItem.mock.calls.at(-1)?.[1] as DialogueLineForTest[]
    expect(savedDialogue).toHaveLength(1)
    expect(savedDialogue[0].speaker).toBe('Iris')
    expect(target.querySelector('[aria-live="polite"]')).not.toBeNull()
  })
})

interface DialogueLineForTest {
  speaker: string
  text: string
}
