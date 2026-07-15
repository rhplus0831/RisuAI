import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/lang', () => ({
  language: {
    continueAnyway: 'Continue anyway',
    doNotInstall: 'Do not install',
    pluginRiskDetectedAlert: 'Plugin risk detected',
    pluginRisksInuserFriendly: {
      storageAccess: 'Storage access',
    },
    pluginRisksInuserFriendlyDesc: {
      storageAccess: 'Can read or modify stored data.',
    },
  },
}))

vi.mock('src/ts/stores.svelte', async () => import('./PluginAlertModal.testState.svelte'))

import PluginAlertModal from './PluginAlertModal.svelte'
import { pluginAlertModalStore } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let backgroundButton: HTMLButtonElement
let component: MountedComponent | undefined
let target: HTMLElement

async function settle(): Promise<void> {
  await tick()
  await Promise.resolve()
  await Promise.resolve()
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === text,
  )
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

beforeEach(() => {
  target = document.createElement('div')
  backgroundButton = document.createElement('button')
  backgroundButton.textContent = 'Background action'
  target.appendChild(backgroundButton)
  document.body.appendChild(target)
  pluginAlertModalStore.errors = [
    {
      message: 'Plugin can access storage.',
      userAlertKey: 'storageAccess',
    },
  ]
  pluginAlertModalStore.open = true
  backgroundButton.focus()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  pluginAlertModalStore.open = false
  pluginAlertModalStore.errors = []
  document.body.style.overflow = ''
})

describe('PluginAlertModal keyboard safety', () => {
  it('opens as a labelled modal and puts initial focus on the safe action', async () => {
    component = mount(PluginAlertModal, { target })
    await settle()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const safeAction = buttonByText('Do not install')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBe('risu-plugin-risk-dialog-title')
    expect(target.querySelector('#risu-plugin-risk-dialog-title')?.textContent?.trim()).toBe('Plugin risk detected')
    expect(document.activeElement).toBe(safeAction)
    expect(backgroundButton.inert).toBe(true)
    expect(backgroundButton.getAttribute('aria-hidden')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('contains forward and reverse Tab navigation', async () => {
    component = mount(PluginAlertModal, { target })
    await settle()

    const safeAction = buttonByText('Do not install')
    const summary = target.querySelector<HTMLElement>('summary')
    expect(summary).not.toBeNull()

    const forwardTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    safeAction.dispatchEvent(forwardTab)
    expect(forwardTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(summary)

    const reverseTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    summary?.dispatchEvent(reverseTab)
    expect(reverseTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(safeAction)
  })

  it('treats Escape as do-not-install and restores background focus', async () => {
    component = mount(PluginAlertModal, { target })
    await settle()

    const safeAction = buttonByText('Do not install')
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    safeAction.dispatchEvent(escape)
    await settle()

    expect(escape.defaultPrevented).toBe(true)
    expect(pluginAlertModalStore.open).toBe(false)
    expect(pluginAlertModalStore.errors).toHaveLength(1)
    expect(target.querySelector('[role="dialog"]')).toBeNull()
    expect(backgroundButton.inert).toBe(false)
    expect(backgroundButton.hasAttribute('aria-hidden')).toBe(false)
    expect(document.activeElement).toBe(backgroundButton)
    expect(document.body.style.overflow).toBe('')
  })
})
