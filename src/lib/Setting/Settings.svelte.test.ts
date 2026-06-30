import { mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const alertSpies = vi.hoisted(() => ({
  alertConfirm: vi.fn(async () => false),
}))

const supporterSpies = vi.hoisted(() => ({
  loadSupporters: vi.fn(),
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

vi.mock('./Pages/supporters', async (importActual) => {
  const actual = await importActual<typeof import('./Pages/supporters')>()
  supporterSpies.loadSupporters.mockImplementation(async () => {
    const supp = await fetch(actual.SUPPORTER_ENDPOINT)
    if (!supp.ok) {
      throw new Error(`Failed to load supporters (${supp.status})`)
    }

    await supp.json()
    return actual.createEmptySupporterBuckets()
  })

  return {
    ...actual,
    loadSupporters: supporterSpies.loadSupporters,
  }
})

import { SUPPORTER_ENDPOINT } from './Pages/supporters'
import Settings from './Settings.svelte'
import { language } from 'src/lang'
import { additionalSettingsMenu, DBState, MobileGUI, SettingsMenuIndex } from 'src/ts/stores.svelte'
import { isLite } from 'src/ts/lite'
import { applyRouteToStores, currentRoute, navigate } from 'src/ts/router'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function supporterButton() {
  const button = Array.from(target.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(language.settingsNavSupporters),
  )
  expect(button).toBeTruthy()
  return button!
}

function settingsButton(label: string) {
  return Array.from(target.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === label)
}

async function flushClick() {
  await Promise.resolve()
  await tick()
}

async function applyNavigatedRoute() {
  await applyRouteToStores(get(currentRoute))
  await tick()
  await Promise.resolve()
}

describe('Settings supporter tab', () => {
  beforeEach(() => {
    navigate('/')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    additionalSettingsMenu.splice(0)
    DBState.db = {
      enableRisuaiProTools: false,
      doNotWarnExternalServers: false,
      settingsCloseButtonSize: 24,
    } as any
    isLite.set(false)
    MobileGUI.set(false)
    SettingsMenuIndex.set(-1)
    alertSpies.alertConfirm.mockReset()
    alertSpies.alertConfirm.mockResolvedValue(false)
    supporterSpies.loadSupporters.mockClear()
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
    navigate('/')
  })

  it('does not navigate or fetch supporters when the user cancels', async () => {
    const initialPath = window.location.pathname

    supporterButton().click()
    await flushClick()

    expect(alertSpies.alertConfirm).toHaveBeenCalledWith(language.sendExternalServerWarning)
    expect(window.location.pathname).toBe(initialPath)
    expect(get(currentRoute)).toMatchObject({ kind: 'home', path: initialPath })
    expect(get(SettingsMenuIndex)).toBe(-1)
    expect(supporterSpies.loadSupporters).not.toHaveBeenCalled()
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

    expect(get(currentRoute)).toMatchObject({
      kind: 'settings',
      path: '/settings/supporter',
      section: 'supporter',
      index: 77,
    })
    await applyNavigatedRoute()

    expect(get(SettingsMenuIndex)).toBe(77)
    expect(supporterSpies.loadSupporters).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(SUPPORTER_ENDPOINT)
  })

  it('skips the external server warning when the opt-out is enabled', async () => {
    DBState.db.doNotWarnExternalServers = true

    supporterButton().click()
    await flushClick()

    expect(alertSpies.alertConfirm).not.toHaveBeenCalled()
    expect(get(currentRoute)).toMatchObject({
      kind: 'settings',
      path: '/settings/supporter',
      section: 'supporter',
      index: 77,
    })
    await applyNavigatedRoute()

    expect(get(SettingsMenuIndex)).toBe(77)
    expect(supporterSpies.loadSupporters).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(SUPPORTER_ENDPOINT)
  })

  it('groups model and prompt setup without the legacy bot presets item by default', () => {
    expect(target.textContent).toContain(language.settingsGroupChatSetup)
    expect(settingsButton(language.settingsNavModelProfiles)).toBeTruthy()
    expect(settingsButton(language.settingsNavPromptPresets)).toBeTruthy()
    expect(settingsButton(language.settingsNavLegacyBotPresets)).toBeUndefined()
  })

  it('shows the legacy bot presets settings item only when legacy bot presets remain', async () => {
    expect(settingsButton(language.settingsNavLegacyBotPresets)).toBeUndefined()

    if (component) {
      unmount(component)
      component = undefined
    }
    DBState.db = {
      enableRisuaiProTools: false,
      doNotWarnExternalServers: false,
      settingsCloseButtonSize: 24,
      botPresets: [{ id: 'legacy-preset', name: 'Legacy preset' }],
    } as any
    component = mount(Settings, { target })
    await tick()

    expect(settingsButton(language.settingsNavModelProfiles)).toBeTruthy()
    expect(settingsButton(language.settingsNavPromptPresets)).toBeTruthy()
    expect(settingsButton(language.settingsNavLegacyBotPresets)).toBeTruthy()
  })

  it('returns from a selected mobile settings page to the settings menu', async () => {
    const backupsButton = settingsButton(language.settingsNavBackups)
    expect(backupsButton).toBeTruthy()

    backupsButton?.click()
    await flushClick()

    expect(get(currentRoute)).toMatchObject({
      kind: 'settings',
      path: '/settings/backup',
      section: 'backup',
      index: 0,
    })

    await applyNavigatedRoute()

    expect(get(SettingsMenuIndex)).toBe(0)
    expect(target.textContent).toContain(language.saveServerBackup)
    expect(settingsButton(language.settingsNavBackups)).toBeUndefined()

    const backButton = target.querySelector<HTMLButtonElement>('[data-risu-settings-mobile-back]')
    expect(backButton).toBeTruthy()

    backButton?.click()
    await flushClick()

    expect(get(currentRoute)).toMatchObject({
      kind: 'settings',
      path: '/settings',
      section: '',
      index: -1,
    })

    await applyNavigatedRoute()

    expect(get(SettingsMenuIndex)).toBe(-1)
    expect(settingsButton(language.settingsNavBackups)).toBeTruthy()
    expect(target.textContent).not.toContain(language.saveServerBackup)
  })
})
