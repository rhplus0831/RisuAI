import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const saveIconState = vi.hoisted(() => ({
  settingsResourceState: {
    value: { showSavingIcon: true },
    status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
    shellRevision: 1 as number | null,
    groupStatuses: {} as Record<string, 'idle' | 'loading' | 'ready' | 'error'>,
  },
  saving: { state: true },
}))

vi.mock('src/ts/globalApi.svelte', () => ({ saving: saveIconState.saving }))
vi.mock('src/ts/server/resourceState.svelte', () => ({
  settingsResourceState: saveIconState.settingsResourceState,
}))

import SavePopupIcon from './SavePopupIcon.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  saveIconState.settingsResourceState.value.showSavingIcon = true
  saveIconState.settingsResourceState.status = 'ready'
  saveIconState.settingsResourceState.shellRevision = 1
  saveIconState.settingsResourceState.groupStatuses = {}
  saveIconState.saving.state = true
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  target.remove()
})

describe('SavePopupIcon', () => {
  it('renders from the resident shell owner while the display group loads', () => {
    saveIconState.settingsResourceState.groupStatuses.display = 'loading'
    component = mount(SavePopupIcon, { target })

    expect(target.querySelector('svg')).not.toBeNull()
  })

  it('stays hidden when the setting is disabled', () => {
    saveIconState.settingsResourceState.value.showSavingIcon = false
    component = mount(SavePopupIcon, { target })

    expect(target.querySelector('svg')).toBeNull()
  })

  it('stays hidden while persistence is idle', () => {
    saveIconState.saving.state = false
    component = mount(SavePopupIcon, { target })

    expect(target.querySelector('svg')).toBeNull()
  })

  it('stays hidden when the display owner errors', () => {
    saveIconState.settingsResourceState.groupStatuses.display = 'error'
    component = mount(SavePopupIcon, { target })

    expect(target.querySelector('svg')).toBeNull()
  })

  it('stays hidden when the display owner is missing', () => {
    saveIconState.settingsResourceState.status = 'idle'
    saveIconState.settingsResourceState.shellRevision = null
    saveIconState.settingsResourceState.groupStatuses.display = 'idle'
    component = mount(SavePopupIcon, { target })

    expect(target.querySelector('svg')).toBeNull()
  })
})
