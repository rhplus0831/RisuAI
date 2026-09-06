import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const triggerListMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  settingsResourceState: {
    value: { showDeprecatedTriggerV1: true },
    groupStatuses: { advanced: 'ready' },
  },
}))

vi.mock('src/lang', () => ({
  language: {
    helpBlock: 'Help',
    triggerSwitchWarn: 'Replace triggers?',
    triggerV1Warning: 'V1 warning',
  },
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: triggerListMocks.alertConfirm,
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  settingsResourceState: triggerListMocks.settingsResourceState,
}))

vi.mock('src/ts/globalApi.svelte', () => ({ openURL: vi.fn() }))
vi.mock('src/ts/characterCards', () => ({ hubURL: 'https://example.test' }))

vi.mock('./TriggerV1List.svelte', async () => {
  const child = await import('./TriggerList.testChild.svelte')
  return { default: child.default }
})

vi.mock('./TriggerV2List.svelte', async () => {
  const child = await import('./TriggerList.testChild.svelte')
  return { default: child.default }
})

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', async () => {
  const child = await import('./TriggerList.testChild.svelte')
  return { default: child.default }
})

vi.mock('src/lib/UI/GUI/Button.svelte', async () => {
  const child = await import('./TriggerList.testChild.svelte')
  return { default: child.default }
})

import TriggerListHarness from './TriggerList.testHarness.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function modeButton(label: string): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  expect(button, `${label} mode button`).toBeTruthy()
  return button!
}

function output(): string {
  return target.querySelector('[data-testid="trigger-value"]')?.textContent ?? ''
}

async function settle(): Promise<void> {
  await tick()
  await Promise.resolve()
  await tick()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  triggerListMocks.alertConfirm.mockReset()
  triggerListMocks.settingsResourceState.value.showDeprecatedTriggerV1 = true
  triggerListMocks.settingsResourceState.groupStatuses.advanced = 'ready'
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('TriggerList mode confirmation freshness', () => {
  it('honors the deprecated V1 toggle only from a ready advanced-settings owner', async () => {
    component = mount(TriggerListHarness, { target, props: { initialMode: 'v2' } })
    await settle()
    expect(modeButton('V1')).toBeTruthy()

    unmount(component)
    component = undefined
    triggerListMocks.settingsResourceState.groupStatuses.advanced = 'error'
    component = mount(TriggerListHarness, { target, props: { initialMode: 'v2' } })
    await settle()

    expect(Array.from(target.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'V1')).toBe(
      false,
    )
  })

  it.each([
    ['v1', 'V2'],
    ['v1', 'Lua'],
    ['v2', 'V1'],
  ] as const)(
    'does not apply a stale %s-to-%s confirmation after the projection changes',
    async (initialMode, targetMode) => {
      const confirmation = deferred<boolean>()
      triggerListMocks.alertConfirm.mockReturnValue(confirmation.promise)
      component = mount(TriggerListHarness, { target, props: { initialMode } })
      await settle()

      modeButton(targetMode).click()
      await settle()
      target.querySelector<HTMLButtonElement>('[data-testid="replace-projection"]')?.click()
      await settle()
      expect(output()).toContain('Newer projection')

      confirmation.resolve(true)
      await settle()

      expect(output()).toContain('Newer projection')
      expect(output()).not.toContain('New Event')
      expect(output()).not.toContain('triggerlua')
    },
  )

  it('does not apply a confirmation after the editor owner changes', async () => {
    const confirmation = deferred<boolean>()
    triggerListMocks.alertConfirm.mockReturnValue(confirmation.promise)
    component = mount(TriggerListHarness, { target, props: { initialMode: 'v1' } })
    await settle()

    modeButton('V2').click()
    await settle()
    target.querySelector<HTMLButtonElement>('[data-testid="replace-owner"]')?.click()
    await settle()

    confirmation.resolve(true)
    await settle()

    expect(output()).toContain('Original V1')
    expect(output()).not.toContain('New Event')
  })
})
