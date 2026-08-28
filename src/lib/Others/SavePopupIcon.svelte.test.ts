import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const saveIconState = vi.hoisted(() => ({
  database: { showSavingIcon: true },
  saving: { state: true },
}))

vi.mock('src/ts/globalApi.svelte', () => ({ saving: saveIconState.saving }))
vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: () => saveIconState.database,
}))

import SavePopupIcon from './SavePopupIcon.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  saveIconState.database.showSavingIcon = true
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
  it('renders while persistence is active and the setting is enabled', () => {
    component = mount(SavePopupIcon, { target })

    expect(target.querySelector('svg')).not.toBeNull()
  })

  it('stays hidden when the setting is disabled', () => {
    saveIconState.database.showSavingIcon = false
    component = mount(SavePopupIcon, { target })

    expect(target.querySelector('svg')).toBeNull()
  })

  it('stays hidden while persistence is idle', () => {
    saveIconState.saving.state = false
    component = mount(SavePopupIcon, { target })

    expect(target.querySelector('svg')).toBeNull()
  })
})
