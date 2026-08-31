import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const translateStackTrace = vi.hoisted(() => vi.fn())

vi.mock('src/ts/sourcemap', () => ({ translateStackTrace }))
vi.mock('src/ts/process/modules', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import AlertComp from './AlertComp.svelte'
import {
  alertAddCharacter,
  alertCardExport,
  alertConfirm,
  alertInput,
  alertNormal,
  alertRequestData,
  alertRequiredSelect,
  alertSelectChar,
  alertSelect,
  resolveAlertWorkflow,
} from 'src/ts/alert'
import { language } from 'src/lang'
import { getDatabase, setDatabaseLite, type MessageGenerationInfo } from 'src/ts/storage/database.svelte'
import { alertStore, selectedCharID } from 'src/ts/stores.svelte'
import { charactersResourceState } from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined
let outsideButton: HTMLButtonElement | undefined

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  component = mount(AlertComp, { target })
})

afterEach(async () => {
  alertStore.set({ type: 'none', msg: '' })
  await tick()
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  outsideButton?.remove()
  outsideButton = undefined
  selectedCharID.set(-1)
  setDatabaseLite({} as never)
})

describe('AlertComp stack trace translation', () => {
  beforeEach(() => {
    translateStackTrace.mockReset()
    alertStore.set({ type: 'none', msg: '' })
  })

  it('does not display a translation that belongs to an older error', async () => {
    const first = deferred<{ didTranslate: true; stackTrace: string }>()
    const second = deferred<{ didTranslate: true; stackTrace: string }>()
    translateStackTrace.mockImplementation((stackTrace: string) =>
      stackTrace === 'first source trace' ? first.promise : second.promise,
    )
    alertStore.set({ type: 'error', msg: 'First error', stackTrace: 'first source trace' })
    await tick()
    alertStore.set({ type: 'error', msg: 'Second error', stackTrace: 'second source trace' })
    await tick()

    second.resolve({ didTranslate: true, stackTrace: 'translated second trace' })
    await tick()
    first.resolve({ didTranslate: true, stackTrace: 'translated first trace' })
    await tick()

    const detailsButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Show Error Details'),
    )
    expect(detailsButton).toBeDefined()
    detailsButton?.click()
    await tick()

    expect(target.textContent).toContain('translated second trace')
    expect(target.textContent).not.toContain('translated first trace')
  })
})

describe('AlertComp input dialog', () => {
  beforeEach(() => {
    translateStackTrace.mockReset()
    alertStore.set({ type: 'none', msg: '' })
  })

  it('focuses the input and submits its value with Enter', async () => {
    const result = alertInput('Character name', undefined, 'Risu')
    await tick()

    const input = target.querySelector<HTMLInputElement>('#alert-input')
    expect(input).toBeTruthy()
    expect(document.activeElement).toBe(input)
    expect(input?.getAttribute('aria-label')).toBe('Character name')

    input!.value = 'Risu AI'
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(get(alertStore)).toMatchObject({ type: 'none', msg: 'Risu AI' })
    await expect(result).resolves.toBe('Risu AI')
  })

  it('cancels with Escape or the visible cancel button', async () => {
    const escaped = alertInput('First prompt', undefined, 'keep me')
    await tick()
    target
      .querySelector<HTMLInputElement>('#alert-input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(get(alertStore)).toMatchObject({ type: 'none', msg: '' })
    await expect(escaped).resolves.toBe('')

    const cancelled = alertInput('Second prompt', undefined, 'keep me')
    await tick()
    const cancel = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Cancel'),
    )
    expect(cancel).toBeTruthy()
    cancel?.click()
    expect(get(alertStore)).toMatchObject({ type: 'none', msg: '' })
    await expect(cancelled).resolves.toBe('')
  })

  it('resets the input when another dialog with the same default is queued', async () => {
    const first = alertInput('First prompt')
    const second = alertInput('Second prompt')
    await tick()

    const firstInput = target.querySelector<HTMLInputElement>('#alert-input')
    expect(firstInput?.getAttribute('aria-label')).toBe('First prompt')
    firstInput!.value = 'first answer'
    firstInput!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await expect(first).resolves.toBe('first answer')
    await tick()

    const secondInput = target.querySelector<HTMLInputElement>('#alert-input')
    expect(secondInput).not.toBe(firstInput)
    expect(secondInput?.getAttribute('aria-label')).toBe('Second prompt')
    expect(secondInput?.value).toBe('')

    const ok = Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'OK')
    ok?.click()
    await expect(second).resolves.toBe('')
  })
})

describe('AlertComp workflow dialogs', () => {
  beforeEach(() => {
    translateStackTrace.mockReset()
    alertStore.set({ type: 'none', msg: '' })
  })

  it('keeps Add Character active through a background notice and resolves its owned action', async () => {
    const result = alertAddCharacter()
    await tick()
    alertNormal('Background import notice')
    await tick()

    expect(get(alertStore)).toMatchObject({ type: 'addchar' })
    const create = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Create from Scratch'),
    )
    expect(create).toBeTruthy()
    create?.click()

    await expect(result).resolves.toBe('createfromScratch')
    await vi.waitFor(() => expect(get(alertStore)).toMatchObject({ type: 'normal', msg: 'Background import notice' }))
  })

  it('fails closed when the ready character picker has duplicate stable owners', async () => {
    setDatabaseLite({
      characters: [
        { chaId: 'duplicate-character', name: 'First' },
        { chaId: 'duplicate-character', name: 'Second' },
      ],
    } as never)
    const result = alertSelectChar()
    await tick()

    expect(target.querySelectorAll('[role="dialog"] button')).toHaveLength(0)
    expect(resolveAlertWorkflow(get(alertStore).dialogOwner, 'cancel')).toBe(true)
    await expect(result).resolves.toBe('cancel')
  })

  it('fails closed when preset export sees duplicate stable preset owners', async () => {
    setDatabaseLite({
      botPresetsId: 0,
      botPresets: [
        { id: 'duplicate-preset', name: 'First' },
        { id: 'duplicate-preset', name: 'Second' },
      ],
    } as never)
    const result = alertCardExport('preset')
    await tick()

    expect(target.textContent).toContain(language.risupresetDesc)
    expect(target.textContent).not.toContain('Preset with image or regexes cannot be exported for now.')
    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.close}"]`)?.click()
    await expect(result).resolves.toEqual({ type: 'cancel', type2: '' })
  })
})

describe('AlertComp select dialog', () => {
  beforeEach(() => {
    translateStackTrace.mockReset()
    alertStore.set({ type: 'none', msg: '' })
  })

  it('renders an accessible localized cancellation control and cancels with Escape', async () => {
    const result = alertSelect(['WebVTT', 'SRT'], 'Choose a subtitle format')
    await tick()
    await Promise.resolve()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const cancel = Array.from(target.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === language.cancel,
    )
    expect(dialog).toBeTruthy()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.textContent).toContain('Choose a subtitle format')
    expect(cancel).toBeTruthy()
    expect(dialog?.contains(document.activeElement)).toBe(true)

    cancel?.click()
    await expect(result).resolves.toBeNull()
    expect(get(alertStore)).toMatchObject({ type: 'none', msg: '' })

    const escapedResult = alertSelect(['Keep open'])
    await tick()
    target
      .querySelector<HTMLElement>('[role="dialog"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await expect(escapedResult).resolves.toBeNull()
  })

  it('keeps a required selection open until one of its choices is selected', async () => {
    const result = alertRequiredSelect(['Refresh now', 'Stay offline'], 'Another session took over.', 'Write access')
    await tick()

    const modalRoot = target.querySelector<HTMLElement>('[data-modal-root]')
    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.textContent).toContain('Write access')
    expect(dialog?.textContent).toContain('Another session took over.')
    expect(Array.from(target.querySelectorAll('button')).some((button) => button.textContent === language.cancel)).toBe(
      false,
    )

    dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    modalRoot?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await tick()
    expect(get(alertStore)).toMatchObject({ type: 'select', dismissible: false, title: 'Write access' })

    Array.from(target.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Stay offline')
      ?.click()
    await expect(result).resolves.toBe('1')
  })

  it('cancels only when the modal backdrop itself is clicked', async () => {
    const result = alertSelect(['Keep open'])
    await tick()

    const modalRoot = target.querySelector<HTMLElement>('[data-modal-root]')
    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    expect(modalRoot).toBeTruthy()
    expect(dialog).toBeTruthy()

    dialog?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(get(alertStore)).toMatchObject({ type: 'select' })

    modalRoot?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await expect(result).resolves.toBeNull()
  })
})

describe('AlertComp confirmation queue', () => {
  beforeEach(() => {
    translateStackTrace.mockReset()
    alertStore.set({ type: 'none', msg: '' })
  })

  it('renders concurrent confirmations one at a time and binds each button response to its caller', async () => {
    const firstResult = alertConfirm('First queued confirmation')
    const secondResult = alertConfirm('Second queued confirmation')
    await tick()

    expect(target.textContent).toContain('First queued confirmation')
    expect(target.textContent).not.toContain('Second queued confirmation')

    const yesButton = Array.from(target.querySelectorAll('button')).find((button) => button.textContent === 'YES')
    expect(yesButton).toBeTruthy()
    yesButton?.click()
    await expect(firstResult).resolves.toBe(true)
    await tick()

    expect(target.textContent).not.toContain('First queued confirmation')
    expect(target.textContent).toContain('Second queued confirmation')

    const noButton = Array.from(target.querySelectorAll('button')).find((button) => button.textContent === 'NO')
    expect(noButton).toBeTruthy()
    noButton?.click()
    await expect(secondResult).resolves.toBe(false)
    await tick()

    expect(target.querySelector('[role="alertdialog"]')).toBeNull()
  })
})

function seedBranchDatabase(): void {
  setDatabaseLite({
    currentChar: 0,
    characters: [
      {
        chaId: 'branch-character',
        firstMessage: 'Opening greeting',
        alternateGreetings: ['Alternate greeting'],
        chatPage: 0,
        chats: [
          {
            id: 'chat-main',
            name: 'Main path',
            fmIndex: -1,
            message: [
              { chatId: 'branch-message-1', role: 'user', data: 'First turn' },
              { chatId: 'branch-message-2', role: 'char', data: 'Second turn' },
            ],
          },
        ],
      },
    ],
  } as never)
}

async function openBranches(): Promise<void> {
  alertStore.set({ type: 'branches', msg: '' })
  await tick()
  await Promise.resolve()
  await Promise.resolve()
}

function branchNodes(): HTMLButtonElement[] {
  return Array.from(target.querySelectorAll<HTMLButtonElement>('button[data-risu-branch-node]'))
}

function branchTooltip(): HTMLElement | null {
  return target.querySelector<HTMLElement>('[role="tooltip"]')
}

function branchCloseButton(): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.getAttribute('aria-label') === language.close,
  )
  if (!button) throw new Error('Branch dialog close button not found')
  return button
}

describe('AlertComp branch graph accessibility', () => {
  beforeEach(() => {
    selectedCharID.set(0)
    seedBranchDatabase()
  })

  it('renders named native controls and exposes each branch detail on focus', async () => {
    await openBranches()

    const nodes = branchNodes()
    expect(nodes).toHaveLength(3)
    for (const [index, node] of nodes.entries()) {
      expect(node.tagName).toBe('BUTTON')
      expect(node.type).toBe('button')
      expect(node.tabIndex).toBe(0)
      expect(node.getAttribute('aria-label')).toBe(`${language.branch} ${index + 1}`)
    }

    nodes[0].focus()
    await tick()

    expect(document.activeElement).toBe(nodes[0])
    expect(branchTooltip()?.textContent?.trim()).toBe('Opening greeting')
    expect(nodes[0].getAttribute('aria-describedby')).toBe(branchTooltip()?.id)

    nodes[1].focus()
    await tick()

    expect(branchTooltip()?.textContent?.trim()).toBe('First turn')
    expect(nodes[0].hasAttribute('aria-describedby')).toBe(false)
    expect(nodes[1].getAttribute('aria-describedby')).toBe(branchTooltip()?.id)
  })

  it('keeps hover, click, Enter, and Space detail disclosure working', async () => {
    await openBranches()
    const node = branchNodes()[2]
    branchCloseButton().focus()

    node.dispatchEvent(new MouseEvent('mouseenter'))
    await tick()
    expect(branchTooltip()?.textContent?.trim()).toBe('Second turn')

    node.dispatchEvent(new MouseEvent('mouseleave'))
    await tick()
    expect(branchTooltip()).toBeNull()

    node.click()
    await tick()
    expect(branchTooltip()?.textContent?.trim()).toBe('Second turn')

    node.dispatchEvent(new MouseEvent('mouseleave'))
    await tick()
    expect(branchTooltip()).toBeNull()

    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    node.focus()
    node.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
    node.dispatchEvent(new MouseEvent('mouseleave'))
    await tick()
    expect(branchTooltip()).toBeNull()

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    node.dispatchEvent(enter)
    await tick()
    expect(enter.defaultPrevented).toBe(false)
    expect(branchTooltip()?.textContent?.trim()).toBe('Second turn')

    node.dispatchEvent(new MouseEvent('mouseleave'))
    await tick()
    const space = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true })
    node.dispatchEvent(space)
    await tick()
    expect(space.defaultPrevented).toBe(false)
    expect(branchTooltip()?.textContent?.trim()).toBe('Second turn')
  })

  it('includes branch controls in the modal focus trap and restores outside focus on close', async () => {
    outsideButton = document.createElement('button')
    outsideButton.textContent = 'Outside'
    document.body.appendChild(outsideButton)
    outsideButton.focus()
    await openBranches()

    const close = branchCloseButton()
    const nodes = branchNodes()
    const lastNode = nodes.at(-1)!
    expect(document.activeElement).toBe(close)

    lastNode.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(close)

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(lastNode)

    outsideButton.focus()
    expect(document.activeElement).toBe(close)

    close.click()
    await tick()
    await Promise.resolve()
    expect(document.activeElement).toBe(outsideButton)
  })

  it('remains safe when its selected character owner disappears while open', async () => {
    await openBranches()
    expect(branchNodes()).toHaveLength(3)

    selectedCharID.set(-1)
    charactersResourceState.currentChar = -1
    await tick()

    expect(target.querySelector('[role="dialog"]')).not.toBeNull()
    expect(branchNodes()).toHaveLength(0)
  })
})

const inspectedGeneration: MessageGenerationInfo = {
  generationId: 'generation-target',
  model: 'model-target',
  inputTokens: 12,
  outputTokens: 4,
  maxContext: 100,
}

function seedRequestDataDatabase(): void {
  setDatabaseLite({
    characters: [
      {
        chaId: 'character-a',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            message: [
              { role: 'user', data: 'before', chatId: 'message-before' },
              {
                role: 'char',
                data: 'inspected text',
                chatId: 'message-target',
                saying: 'Inspected speaker',
                generationInfo: inspectedGeneration,
              },
              {
                role: 'char',
                data: 'other text',
                chatId: 'message-other',
                saying: 'Other speaker',
                generationInfo: { ...inspectedGeneration, generationId: 'generation-other' },
              },
            ],
          },
        ],
      },
    ],
  } as never)
}

function metadataValue(label: string): string | undefined {
  const labelElement = Array.from(target.querySelectorAll('span')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  return labelElement?.nextElementSibling?.textContent?.trim()
}

async function openRequestMetadata(): Promise<void> {
  alertRequestData({ genInfo: inspectedGeneration, idx: 1 })
  await tick()
  const metadataButton = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === language.metaData,
  )
  expect(metadataButton).toBeTruthy()
  metadataButton?.click()
  await tick()
}

describe('AlertComp request-data message ownership', () => {
  beforeEach(() => {
    selectedCharID.set(0)
    seedRequestDataDatabase()
  })

  it('keeps metadata bound to the inspected message when its live index shifts', async () => {
    await openRequestMetadata()
    expect(metadataValue('ID')).toBe('message-target')
    expect(metadataValue('Saying')).toBe('Inspected speaker')

    getDatabase().characters[0].chats[0].message.unshift({
      role: 'user',
      data: 'inserted before inspector target',
      chatId: 'message-inserted',
    })
    await tick()

    expect(metadataValue('Index')).toBe('2')
    expect(metadataValue('ID')).toBe('message-target')
    expect(metadataValue('Saying')).toBe('Inspected speaker')
    expect(target.textContent).not.toContain('Other speaker')
  })

  it('reports when the inspected message is removed', async () => {
    await openRequestMetadata()
    const messages = getDatabase().characters[0].chats[0].message
    messages.splice(
      messages.findIndex((message) => message.chatId === 'message-target'),
      1,
    )
    await tick()

    expect(target.querySelector('[role="status"]')?.textContent).toContain(language.errors.requestDataMessageMissing)
    expect(metadataValue('ID')).toBeUndefined()
  })

  it('fails closed when a ready character or chat owner is missing or ambiguous', async () => {
    alertRequestData({
      genInfo: inspectedGeneration,
      idx: 1,
      characterId: 'missing-character',
      chatId: 'chat-a',
      messageId: 'message-target',
    })
    await tick()
    const missingMetadataButton = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === language.metaData,
    )
    missingMetadataButton?.click()
    await tick()
    expect(target.querySelector('[role="status"]')?.textContent).toContain(language.errors.requestDataMessageMissing)

    alertStore.set({ type: 'none', msg: '' })
    await tick()
    setDatabaseLite({
      characters: [
        {
          chaId: 'character-a',
          chatPage: 0,
          chats: [
            { id: 'chat-a', message: [{ chatId: 'message-target', data: 'first' }] },
            { id: 'chat-a', message: [{ chatId: 'message-target', data: 'second' }] },
          ],
        },
      ],
    } as never)
    alertRequestData({
      genInfo: inspectedGeneration,
      idx: 0,
      characterId: 'character-a',
      chatId: 'chat-a',
      messageId: 'message-target',
    })
    await tick()
    const duplicateMetadataButton = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === language.metaData,
    )
    duplicateMetadataButton?.click()
    await tick()
    expect(target.querySelector('[role="status"]')?.textContent).toContain(language.errors.requestDataMessageMissing)
  })
})
