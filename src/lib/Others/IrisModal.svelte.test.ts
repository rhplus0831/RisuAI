import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const irisMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  forageGetItem: vi.fn(async () => null),
  forageSetItem: vi.fn(async (_key: string, _value: unknown) => undefined),
  getIrisSystemPrompt: vi.fn(async () => 'Iris system prompt'),
  requestChatData: vi.fn(),
  getToolList: vi.fn(async () => []),
  callTool: vi.fn(async () => []),
  risuAccessSignals: [] as Array<AbortSignal | undefined>,
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
    constructor(signal?: AbortSignal) {
      irisMocks.risuAccessSignals.push(signal)
    }

    getToolList = irisMocks.getToolList
    callTool = irisMocks.callTool
  },
}))

import IrisModal from './IrisModal.svelte'
import type { Database } from 'src/ts/storage/database.svelte'
import { replaceResourceDatabase as setDatabaseLite } from 'src/ts/server/resourceState.svelte'
import { irisStore } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { SERVER_TOOL_MAX_RESULT_BYTES } from 'src/ts/process/request/serverToolProtocol'

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

function keyboardActivate(control: HTMLButtonElement, key: 'Enter' | ' '): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })
  if (control.dispatchEvent(event)) control.click()
  return event
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
  irisStore.open = true
  irisMocks.risuAccessSignals.length = 0
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

  it('lets the focused close button handle Enter while dialogue is typing', async () => {
    component = mount(IrisModal, { target })
    await settle()

    const close = target.querySelector<HTMLButtonElement>(':scope [role="dialog"] > button[aria-label="Close"]')
    if (!close) throw new Error('Iris close button not found')
    const event = keyboardActivate(close, 'Enter')

    expect(event.defaultPrevented).toBe(false)
    expect(irisStore.open).toBe(false)
  })

  it('lets the focused backlog button handle Space without advancing dialogue', async () => {
    component = mount(IrisModal, { target })
    await settle()

    const dialogue = target.querySelector<HTMLElement>('[aria-live="polite"]')
    const log = target.querySelector<HTMLButtonElement>('button[title^="View backlog"]')
    if (!dialogue || !log) throw new Error('Iris dialogue controls not found')
    const textBeforeActivation = dialogue.textContent
    const event = keyboardActivate(log, ' ')
    await settle()

    expect(event.defaultPrevented).toBe(false)
    expect(target.querySelectorAll('[role="dialog"]')).toHaveLength(2)
    expect(dialogue.textContent).toBe(textBeforeActivation)
  })

  it('advances a focused dialogue control only once per keypress', async () => {
    component = mount(IrisModal, { target })
    await settle()
    await vi.runAllTimersAsync()
    await settle()
    ;(
      component as unknown as {
        pushDialogue: (line: { speaker: string; text: string }) => void
      }
    ).pushDialogue({ speaker: 'Iris', text: 'First sentence. Second sentence.' })
    await settle()

    const dialogue = target.querySelector<HTMLElement>('[aria-live="polite"]')
    if (!dialogue) throw new Error('Iris dialogue control not found')
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })
    dialogue.dispatchEvent(event)
    await settle()

    expect(event.defaultPrevented).toBe(true)
    expect(dialogue.textContent?.trim()).toBe('First sentence.')
  })

  it('lets Escape from the focused message input close Iris', async () => {
    component = mount(IrisModal, { target })
    await settle()
    await vi.runAllTimersAsync()
    await settle()

    const input = target.querySelector<HTMLInputElement>('input[type="text"]')
    if (!input) throw new Error('Iris message input not found')
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    input.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(irisStore.open).toBe(false)
  })

  it('keeps the decorative sprite out of pointer hit testing and below Close', async () => {
    component = mount(IrisModal, { target })
    await settle()

    const sprite = target.querySelector<HTMLElement>('[data-iris-sprite]')
    const close = target.querySelector<HTMLButtonElement>(':scope [role="dialog"] > button[aria-label="Close"]')
    if (!sprite || !close) throw new Error('Iris sprite or close button not found')

    expect(sprite.classList.contains('pointer-events-none')).toBe(true)
    expect(close.classList.contains('z-20')).toBe(true)
  })

  it('waits for saved dialogue hydration before accepting a submission', async () => {
    const savedDialogue = [{ speaker: 'Iris', text: 'Restored conversation' }]
    const restore = deferred<typeof savedDialogue | null>()
    irisMocks.forageGetItem.mockReturnValueOnce(restore.promise)
    irisMocks.requestChatData.mockResolvedValueOnce({ type: 'success', result: 'Reply after restore' })
    component = mount(IrisModal, { target })
    await settle()

    expect(target.querySelector('input[type="text"]')).toBeNull()

    restore.resolve(savedDialogue)
    await settle()
    await vi.runAllTimersAsync()
    await settle()

    expect(target.querySelector('input[type="text"]')?.getAttribute('aria-label')).toBe(language.messageInput)
    await submitMessage('Question after restore')
    await vi.waitFor(() => expect(irisMocks.requestChatData).toHaveBeenCalledOnce())
    await settle()

    const persistedDialogue = irisMocks.forageSetItem.mock.calls.at(-1)?.[1] as DialogueLineForTest[]
    expect(persistedDialogue).toEqual([
      { speaker: 'Iris', text: 'Restored conversation' },
      { speaker: 'You', text: 'Question after restore' },
      { speaker: 'Iris', text: 'Reply after restore' },
    ])
  })

  it.each(['', '<think>private reasoning</think>', '(private direction) {{hidden state}}'])(
    'keeps the submitted line when Iris returns no visible dialogue: %j',
    async (result) => {
      irisMocks.requestChatData.mockResolvedValueOnce({ type: 'success', result })
      component = mount(IrisModal, { target })
      await settle()

      await submitMessage('Question with an empty reply')
      await vi.waitFor(() => expect(irisMocks.alertError).toHaveBeenCalledWith(language.errors.irisEmptyResponse))

      const persistedDialogue = irisMocks.forageSetItem.mock.calls.at(-1)?.[1] as DialogueLineForTest[]
      expect(persistedDialogue.at(-1)).toEqual({ speaker: 'You', text: 'Question with an empty reply' })
      expect(persistedDialogue).toHaveLength(2)
    },
  )

  it('does not submit input that contains only hidden dialogue metadata', async () => {
    component = mount(IrisModal, { target })
    await settle()

    await submitMessage('(private direction) {{hidden state}}')

    expect(irisMocks.requestChatData).not.toHaveBeenCalled()
    expect(irisMocks.alertError).toHaveBeenCalledWith(language.errors.emptyText)
    const input = target.querySelector<HTMLInputElement>('input[type="text"]')
    expect(input?.value).toBe('(private direction) {{hidden state}}')
  })

  it('ignores a successful response after the dialogue is reset', async () => {
    const response = deferred<{ type: 'success'; result: string }>()
    irisMocks.requestChatData.mockReturnValue(response.promise)
    component = mount(IrisModal, { target })
    await settle()

    await submitMessage('Question before reset')
    expect(irisMocks.requestChatData).toHaveBeenCalledOnce()
    const signal = irisMocks.requestChatData.mock.calls[0]?.[2] as AbortSignal
    expect(signal.aborted).toBe(false)
    await resetFromBacklog()
    expect(signal.aborted).toBe(true)

    response.resolve({ type: 'success', result: 'Stale Iris response' })
    await settle()

    const savedDialogue = irisMocks.forageSetItem.mock.calls.at(-1)?.[1] as DialogueLineForTest[]
    expect(savedDialogue).toHaveLength(1)
    expect(savedDialogue.some((line) => line.text === 'Stale Iris response')).toBe(false)
  })

  it('executes only its supplied RisuAccess tool and feeds the result into a bounded follow-up round', async () => {
    const tool = {
      name: 'risu-get-character-info',
      description: 'Get character information.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    }
    irisMocks.getToolList.mockResolvedValueOnce([tool])
    irisMocks.callTool.mockResolvedValueOnce([{ type: 'text', text: '{"name":"Mira"}' }])
    irisMocks.requestChatData
      .mockResolvedValueOnce({
        type: 'success',
        result: '',
        toolCalls: [
          {
            id: 'call-1',
            name: tool.name,
            arguments: { id: 'mira-id' },
          },
        ],
      })
      .mockResolvedValueOnce({ type: 'success', result: 'Mira is ready.' })
    component = mount(IrisModal, { target })
    await settle()

    await submitMessage('Is Mira available?')
    await vi.waitFor(() => expect(irisMocks.requestChatData).toHaveBeenCalledTimes(2))
    await settle()

    expect(irisMocks.callTool).toHaveBeenCalledOnce()
    expect(irisMocks.callTool).toHaveBeenCalledWith(tool.name, { id: 'mira-id' })
    const [firstArg, firstMode, firstSignal] = irisMocks.requestChatData.mock.calls[0]
    const [secondArg, secondMode, secondSignal] = irisMocks.requestChatData.mock.calls[1]
    expect(firstMode).toBe('otherAx')
    expect(secondMode).toBe('otherAx')
    expect(firstSignal).toBeInstanceOf(AbortSignal)
    expect(secondSignal).toBe(firstSignal)
    expect(irisMocks.risuAccessSignals).toEqual([firstSignal])
    expect(firstArg).toMatchObject({ tools: [tool], toolRounds: [] })
    expect(secondArg.toolRounds).toEqual([
      {
        assistantContent: '',
        calls: [{ id: 'call-1', name: tool.name, arguments: { id: 'mira-id' } }],
        results: [{ callId: 'call-1', name: tool.name, content: '{"name":"Mira"}' }],
      },
    ])

    const savedDialogue = irisMocks.forageSetItem.mock.calls.at(-1)?.[1] as DialogueLineForTest[]
    expect(savedDialogue.at(-1)).toEqual({ speaker: 'Iris', text: 'Mira is ready.' })
  })

  it('rejects an unsupplied tool name with the localized Iris protocol error', async () => {
    irisMocks.getToolList.mockResolvedValueOnce([
      {
        name: 'risu-get-character-info',
        description: 'Get character information.',
        inputSchema: { type: 'object' },
      },
    ])
    irisMocks.requestChatData.mockResolvedValueOnce({
      type: 'success',
      result: '',
      toolCalls: [{ id: 'call-1', name: 'arbitrary-tool', arguments: {} }],
    })
    component = mount(IrisModal, { target })
    await settle()

    await submitMessage('Use an invalid tool')
    await vi.waitFor(() => expect(irisMocks.alertError).toHaveBeenCalledOnce())

    expect(irisMocks.callTool).not.toHaveBeenCalled()
    expect(irisMocks.alertError).toHaveBeenCalledWith(
      language.errors.irisToolRequestInvalid('tool call requested an unavailable tool: arbitrary-tool'),
    )
  })

  it('truncates multibyte tool output on a valid UTF-8 boundary before the follow-up', async () => {
    const tool = {
      name: 'risu-get-character-info',
      description: 'Get character information.',
      inputSchema: { type: 'object' },
    }
    const prefix = 'a'.repeat(SERVER_TOOL_MAX_RESULT_BYTES - 1)
    irisMocks.getToolList.mockResolvedValueOnce([tool])
    irisMocks.callTool.mockResolvedValueOnce([{ type: 'text', text: `${prefix}😀tail` }])
    irisMocks.requestChatData
      .mockResolvedValueOnce({
        type: 'success',
        result: `${prefix}😀assistant tail`,
        toolCalls: [{ id: 'call-1', name: tool.name, arguments: {} }],
      })
      .mockResolvedValueOnce({ type: 'success', result: 'Done.' })
    component = mount(IrisModal, { target })
    await settle()

    await submitMessage('Read a large result')
    await vi.waitFor(() => expect(irisMocks.requestChatData).toHaveBeenCalledTimes(2))

    const followUp = irisMocks.requestChatData.mock.calls[1]?.[0]
    const content = followUp.toolRounds[0].results[0].content as string
    const assistantContent = followUp.toolRounds[0].assistantContent as string
    expect(content).toBe(prefix)
    expect(content).not.toContain('�')
    expect(new TextEncoder().encode(content).byteLength).toBeLessThanOrEqual(SERVER_TOOL_MAX_RESULT_BYTES)
    expect(assistantContent).toBe(prefix)
    expect(new TextEncoder().encode(assistantContent).byteLength).toBeLessThanOrEqual(SERVER_TOOL_MAX_RESULT_BYTES)
  })

  it('aborts a deferred submission on destroy without surfacing an error or late output', async () => {
    const response = deferred<{ type: 'success'; result: string }>()
    irisMocks.requestChatData.mockReturnValue(response.promise)
    component = mount(IrisModal, { target })
    await settle()

    await submitMessage('Question before close')
    const signal = irisMocks.requestChatData.mock.calls[0]?.[2] as AbortSignal
    expect(signal.aborted).toBe(false)

    unmount(component)
    component = undefined
    expect(signal.aborted).toBe(true)
    response.resolve({ type: 'success', result: 'Late Iris response' })
    await settle()

    expect(irisMocks.alertError).not.toHaveBeenCalled()
    const savedDialogue = irisMocks.forageSetItem.mock.calls.at(-1)?.[1] as DialogueLineForTest[]
    expect(savedDialogue.some((line) => line.text === 'Late Iris response')).toBe(false)
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

  it('stacks backlog focus above Iris and restores each opener after Escape', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Open Iris'
    document.body.insertBefore(opener, target)
    opener.focus()
    component = mount(IrisModal, { target })
    await settle()

    const irisDialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const irisClose = irisDialog?.querySelector<HTMLElement>(':scope > [data-modal-initial-focus]')
    if (!irisDialog || !irisClose) throw new Error('Iris dialog not found')
    expect(irisDialog.hasAttribute('data-modal-root')).toBe(true)
    expect(irisDialog.getAttribute('aria-modal')).toBe('true')
    expect(opener.inert).toBe(true)
    expect(document.activeElement).toBe(irisClose)

    const backlogTrigger = target.querySelector<HTMLButtonElement>('button[title^="View backlog"]')
    if (!backlogTrigger) throw new Error('Iris backlog trigger not found')
    backlogTrigger.focus()
    backlogTrigger.click()
    await settle()

    const dialogs = target.querySelectorAll<HTMLElement>('[role="dialog"]')
    expect(dialogs).toHaveLength(2)
    const backlogDialog = dialogs[1]
    const backlogClose = backlogDialog.querySelector<HTMLElement>('[data-modal-initial-focus]')
    if (!backlogClose) throw new Error('Iris backlog close button not found')
    expect(backlogDialog.parentElement?.hasAttribute('data-modal-root')).toBe(true)
    expect(opener.inert).toBe(true)
    expect(irisClose.inert).toBe(true)
    expect(document.activeElement).toBe(backlogClose)

    irisClose.focus()
    expect(document.activeElement).toBe(backlogClose)

    const backlogEscape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    backlogClose.dispatchEvent(backlogEscape)
    await settle()

    expect(backlogEscape.defaultPrevented).toBe(true)
    expect(target.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(irisStore.open).toBe(true)
    expect(document.activeElement).toBe(backlogTrigger)

    const irisEscape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    backlogTrigger.dispatchEvent(irisEscape)
    expect(irisEscape.defaultPrevented).toBe(true)
    expect(irisStore.open).toBe(false)

    unmount(component)
    component = undefined
    await settle()
    expect(opener.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

interface DialogueLineForTest {
  speaker: string
  text: string
}
