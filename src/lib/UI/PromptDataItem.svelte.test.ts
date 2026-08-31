import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./GUI/TextAreaInput.svelte', async () => ({
  default: (await import('./PromptDataItem.testStub.svelte')).default,
}))

const settingsResourceState = vi.hoisted(() => ({
  value: {
    promptSettings: {
      customChainOfThought: false,
      sendChatAsSystem: false,
    },
  },
  groupStatuses: { prompt: 'ready' },
  groupErrors: {} as Record<string, string>,
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({ settingsResourceState }))

import PromptDataItemTestHost from './PromptDataItem.testHost.svelte'
import { language } from 'src/lang'
import { RISU_PROMPT_DRAG_TYPE } from 'src/ts/dragTypes'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  settingsResourceState.value.promptSettings = {
    customChainOfThought: false,
    sendChatAsSystem: false,
  }
  settingsResourceState.groupStatuses.prompt = 'ready'
  settingsResourceState.groupErrors = {}
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('PromptDataItem disclosure control', () => {
  it('scopes prompt drags and leaves external file drops unconsumed', async () => {
    component = mount(PromptDataItemTestHost, { target })
    await tick()

    const dragHandle = target.querySelector<HTMLElement>('[draggable="true"]')
    const promptRow = dragHandle?.parentElement
    if (!promptRow || !dragHandle) throw new Error('Prompt drag targets not found')

    const types: string[] = []
    const setData = vi.fn((type: string) => {
      if (!types.includes(type)) types.push(type)
    })
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true })
    Object.defineProperty(dragStart, 'dataTransfer', {
      value: { setData, setDragImage: vi.fn(), types },
    })
    dragHandle.dispatchEvent(dragStart)
    expect(setData).toHaveBeenCalledWith(RISU_PROMPT_DRAG_TYPE, 'true')

    const externalTransfer = { types: ['Files'] }
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'dataTransfer', { value: externalTransfer })
    promptRow.dispatchEvent(dragOver)
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: externalTransfer })
    promptRow.dispatchEvent(drop)

    expect(dragOver.defaultPrevented).toBe(false)
    expect(drop.defaultPrevented).toBe(false)
  })

  it('names the remove and move actions for their prompt item', async () => {
    component = mount(PromptDataItemTestHost, { target })
    await tick()

    const actionNames = Array.from(target.querySelectorAll<HTMLButtonElement>('button[aria-label]')).map((button) =>
      button.getAttribute('aria-label'),
    )

    expect(actionNames).toEqual([
      `${language.remove}: Cached context`,
      `${language.moveDown}: Cached context`,
      `${language.moveUp}: Cached context`,
    ])
    expect(new Set(actionNames).size).toBe(actionNames.length)
  })

  it('uses native button activation and reports its expanded state', async () => {
    component = mount(PromptDataItemTestHost, { target })
    await tick()

    const toggle = Array.from(target.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cached context',
    )
    expect(toggle).toBeInstanceOf(HTMLButtonElement)
    expect(toggle?.type).toBe('button')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(target.querySelector('[data-testid="opened-state"]')?.textContent).toBe('closed')

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    await tick()

    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(target.querySelector('[data-testid="opened-state"]')?.textContent).toBe('open')

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    await tick()

    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(target.querySelector('[data-testid="opened-state"]')?.textContent).toBe('closed')
  })

  it('names every editable field in an expanded prompt row', async () => {
    component = mount(PromptDataItemTestHost, { target })
    await tick()

    Array.from(target.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cached context')
      ?.click()
    await tick()

    const names = Array.from(target.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'), (field) =>
      field.getAttribute('aria-label'),
    )
    expect(names).toEqual([language.name, language.type, language.depth, language.role])
    expect(names.every(Boolean)).toBe(true)
  })

  it('uses the assistant wire role for cache-card character matching', async () => {
    component = mount(PromptDataItemTestHost, { target })
    await tick()
    Array.from(target.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cached context')
      ?.click()
    await tick()

    const roleSelect = Array.from(target.querySelectorAll<HTMLSelectElement>('select')).at(-1)
    expect(Array.from(roleSelect?.options ?? [], (option) => option.value)).toEqual([
      'all',
      'user',
      'assistant',
      'system',
    ])
  })

  it('defaults block role2 to system and persists a selected block role', async () => {
    component = mount(PromptDataItemTestHost, {
      target,
      props: { initialPrompt: { type: 'persona', name: 'Persona' } },
    })
    await tick()
    Array.from(target.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Persona')
      ?.click()
    await tick()

    const roleSelect = Array.from(target.querySelectorAll<HTMLSelectElement>('select')).at(-1)
    expect(roleSelect?.value).toBe('system')
    if (roleSelect) {
      roleSelect.value = 'bot'
      roleSelect.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await tick()
    expect(target.querySelector('[data-testid="prompt-json"]')?.textContent).toContain('"role2":"bot"')
  })

  it('shows custom chain-of-thought only from a ready prompt-settings owner', async () => {
    settingsResourceState.value.promptSettings.customChainOfThought = true
    component = mount(PromptDataItemTestHost, {
      target,
      props: { initialPrompt: { type: 'plain', name: 'Main', text: '', role: 'system' } },
    })
    await tick()
    Array.from(target.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Main')
      ?.click()
    await tick()

    const typeSelect = target.querySelector<HTMLSelectElement>(`select[aria-label="${language.type}"]`)
    expect(Array.from(typeSelect?.options ?? [], (option) => option.value)).toContain('cot')
  })

  it('fails closed when the ready prompt-settings owner carries an error', async () => {
    settingsResourceState.value.promptSettings.customChainOfThought = true
    settingsResourceState.groupErrors.prompt = 'invalid prompt settings'
    component = mount(PromptDataItemTestHost, {
      target,
      props: { initialPrompt: { type: 'plain', name: 'Main', text: '', role: 'system' } },
    })
    await tick()
    Array.from(target.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Main')
      ?.click()
    await tick()

    const typeSelect = target.querySelector<HTMLSelectElement>(`select[aria-label="${language.type}"]`)
    expect(Array.from(typeSelect?.options ?? [], (option) => option.value)).not.toContain('cot')
  })
})
