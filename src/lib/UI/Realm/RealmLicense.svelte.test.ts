import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const realmLicenseMocks = vi.hoisted(() => ({
  openURL: vi.fn(),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  openURL: realmLicenseMocks.openURL,
}))

vi.mock('src/ts/gui/tooltip', () => ({
  tooltip: () => ({
    destroy: vi.fn(),
    update: vi.fn(),
  }),
}))

import RealmLicense from './RealmLicense.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  realmLicenseMocks.openURL.mockReset()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('RealmLicense link semantics', () => {
  it('renders a named native link and preserves app URL handling', () => {
    component = mount(RealmLicense, {
      target,
      props: { license: 'CC BY 4.0' },
    })

    const link = target.querySelector<HTMLAnchorElement>('a')
    expect(link).not.toBeNull()
    expect(link?.href).toBe('https://creativecommons.org/licenses/by/4.0/')
    expect(link?.target).toBe('_blank')
    expect(link?.rel).toBe('noopener noreferrer')
    expect(link?.textContent?.trim()).toBe('Licensed with CC BY 4.0')

    link?.focus()
    expect(document.activeElement).toBe(link)
    link?.click()

    expect(realmLicenseMocks.openURL).toHaveBeenCalledOnce()
    expect(realmLicenseMocks.openURL).toHaveBeenCalledWith('https://creativecommons.org/licenses/by/4.0/')
  })

  it('does not render a link for an unsupported license', () => {
    component = mount(RealmLicense, {
      target,
      props: { license: 'All rights reserved' },
    })

    expect(target.querySelector('a')).toBeNull()
  })
})
