import { mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPPORTER_ENDPOINT } from './Pages/supporters'

const alertSpies = vi.hoisted(() => ({
  alertConfirm: vi.fn(async () => false),
}))

vi.mock('src/ts/alert', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/alert')>()
  return {
    ...actual,
    alertConfirm: alertSpies.alertConfirm,
  }
})

vi.mock('src/ts/globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/globalApi.svelte')>()
  return {
    ...actual,
    openURL: vi.fn(),
  }
})

import Settings from './Settings.svelte'
import { language } from 'src/lang'
import { additionalSettingsMenu, DBState, MobileGUI, SettingsMenuIndex } from 'src/ts/stores.svelte'
import { isLite } from 'src/ts/lite'

type MountedComponent = Parameters<typeof unmount>[0]

const SUPPORTER_CONFIRM_MESSAGE =
  'Continuing will send a request to the RisuAI server, and your IP address may be transmitted. Do you want to continue?'

let target: HTMLElement
let component: MountedComponent | undefined

function supporterButton() {
  const button = Array.from(target.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(language.supporterThanks),
  )
  expect(button).toBeTruthy()
  return button!
}

async function flushClick() {
  await Promise.resolve()
  await tick()
}

describe('Settings supporter tab', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    additionalSettingsMenu.splice(0)
    DBState.db = {
      enableRisuaiProTools: false,
      settingsCloseButtonSize: 24,
    } as any
    isLite.set(false)
    MobileGUI.set(false)
    SettingsMenuIndex.set(-1)
    alertSpies.alertConfirm.mockReset()
    alertSpies.alertConfirm.mockResolvedValue(false)
    vi.stubGlobal('fetch', vi.fn())

    target = document.createElement('div')
    document.body.appendChild(target)
    component = mount(Settings, { target })
  })

  afterEach(() => {
    if (component) {
      unmount(component)
      component = undefined
    }
    vi.unstubAllGlobals()
    target.remove()
    document.body.innerHTML = ''
  })

  it('does not navigate or fetch supporters when the user cancels', async () => {
    supporterButton().click()
    await flushClick()

    expect(alertSpies.alertConfirm).toHaveBeenCalledWith(SUPPORTER_CONFIRM_MESSAGE)
    expect(get(SettingsMenuIndex)).toBe(-1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('navigates to supporters only after confirmation', async () => {
    alertSpies.alertConfirm.mockResolvedValue(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([{ amount: 50, name: 'top' }]))),
    )

    supporterButton().click()
    await flushClick()

    expect(get(SettingsMenuIndex)).toBe(77)
    expect(fetch).toHaveBeenCalledWith(SUPPORTER_ENDPOINT)
  })
})
