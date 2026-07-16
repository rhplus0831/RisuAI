import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/sourcemap', () => ({ translateStackTrace: vi.fn() }))
vi.mock('src/ts/process/modules', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import AlertComp from './AlertComp.svelte'
import { language } from 'src/lang'
import { setDatabaseLite } from 'src/ts/storage/database.svelte'
import { alertStore, selectedCharID } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let outsideButton: HTMLButtonElement
let component: MountedComponent | undefined

function seedBranchDatabase() {
  setDatabaseLite({
    characters: [
      {
        firstMessage: 'Opening greeting',
        alternateGreetings: ['Alternate greeting'],
        chatPage: 0,
        chats: [
          {
            id: 'chat-main',
            name: 'Main path',
            fmIndex: -1,
            message: [
              { role: 'user', data: 'First turn' },
              { role: 'char', data: 'Second turn' },
            ],
          },
        ],
      },
    ],
  } as any)
}

async function openBranches() {
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

function closeButton(): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.getAttribute('aria-label') === language.close,
  )
  if (!button) throw new Error('Branch dialog close button not found')
  return button
}

beforeEach(() => {
  alertStore.set({ type: 'none', msg: '' })
  selectedCharID.set(0)
  seedBranchDatabase()

  outsideButton = document.createElement('button')
  outsideButton.textContent = 'Outside'
  document.body.appendChild(outsideButton)
  outsideButton.focus()

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
  outsideButton.remove()
  selectedCharID.set(-1)
  setDatabaseLite({} as any)
})

describe('AlertComp branch graph accessibility', () => {
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
    closeButton().focus()

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
    await openBranches()

    const close = closeButton()
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
    await tick()

    expect(target.querySelector('[role="dialog"]')).not.toBeNull()
    expect(branchNodes()).toHaveLength(0)
  })
})
