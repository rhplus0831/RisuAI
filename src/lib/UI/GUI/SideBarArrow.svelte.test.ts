import { get } from 'svelte/store'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changeLanguage } from 'src/lang'
import { languageKorean } from 'src/lang/ko'
import { DynamicGUI, MobileGUI, sideBarClosing, sideBarStore } from 'src/ts/stores.svelte'
import SideBarArrow from './SideBarArrow.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  DynamicGUI.set(false)
  MobileGUI.set(false)
  sideBarClosing.set(false)
  sideBarStore.set(true)
  changeLanguage('ko')
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  changeLanguage('en')
  DynamicGUI.set(false)
  MobileGUI.set(false)
  sideBarClosing.set(false)
  sideBarStore.set(true)
})

describe('SideBarArrow accessible names', () => {
  it('uses localized names for both sidebar states and preserves their actions', async () => {
    component = mount(SideBarArrow, { target })
    await tick()

    const collapseButton = target.querySelector<HTMLButtonElement>('[data-risu-sidebar-toggle="collapse"]')
    expect(collapseButton?.getAttribute('aria-label')).toBe(languageKorean.collapseSidebar)

    collapseButton?.click()
    await tick()
    expect(get(sideBarClosing)).toBe(true)

    sideBarClosing.set(false)
    sideBarStore.set(false)
    await tick()

    const expandButton = target.querySelector<HTMLButtonElement>('[data-risu-sidebar-toggle="expand"]')
    expect(expandButton?.getAttribute('aria-label')).toBe(languageKorean.expandSidebar)

    expandButton?.click()
    await tick()
    expect(get(sideBarClosing)).toBe(false)
    expect(get(sideBarStore)).toBe(true)
  })
})
