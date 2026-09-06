import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser notification banner preference', () => {
  it('survives a fresh runtime using the same browser storage and stays local to that storage', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    const firstRuntime = await import('./pushNotificationWarningPreference')
    expect(get(firstRuntime.pushNotificationWarningDismissed)).toBe(false)
    firstRuntime.setPushNotificationWarningDismissed(true)

    vi.resetModules()
    const reloadedRuntime = await import('./pushNotificationWarningPreference')
    expect(get(reloadedRuntime.pushNotificationWarningDismissed)).toBe(true)

    vi.stubGlobal('localStorage', { getItem: () => null })
    vi.resetModules()
    const otherBrowser = await import('./pushNotificationWarningPreference')
    expect(get(otherBrowser.pushNotificationWarningDismissed)).toBe(false)
  })

  it('still dismisses for the session when browser storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage blocked')
      },
      setItem: () => {
        throw new Error('storage blocked')
      },
      removeItem: () => {
        throw new Error('storage blocked')
      },
    })
    const preference = await import('./pushNotificationWarningPreference')
    expect(get(preference.pushNotificationWarningDismissed)).toBe(false)
    expect(() => preference.setPushNotificationWarningDismissed(true)).not.toThrow()
    expect(get(preference.pushNotificationWarningDismissed)).toBe(true)
    preference.setPushNotificationWarningDismissed(false)
    expect(get(preference.pushNotificationWarningDismissed)).toBe(false)
  })
})
