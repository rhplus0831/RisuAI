import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ownerState = vi.hoisted(() => ({
  collectionsResourceState: {
    values: { botPresets: [] as Array<Record<string, unknown>> },
    statuses: { botPresets: 'ready' },
    errors: {} as Record<string, string>,
  },
  settingsResourceState: {
    value: { promptDiffPrefs: undefined as Record<string, unknown> | undefined },
    groupStatuses: { display: 'ready' },
    groupErrors: {} as Record<string, string>,
  },
}))
const ensureBotPresetHydratedById = vi.hoisted(() => vi.fn<(presetId: string) => Promise<boolean>>())
const applyServerBackedSetting = vi.hoisted(() => vi.fn())

vi.mock('src/ts/server/resourceState.svelte', () => ownerState)
vi.mock('src/ts/server/settingsBridge.svelte', () => ({ applyServerBackedSetting }))
vi.mock('../../ts/storage/database.svelte', () => ({
  botPresetHasHydratedSettings: (preset: Record<string, unknown> | undefined) =>
    !!preset?.id && Object.prototype.hasOwnProperty.call(preset, 'localNetworkMode'),
  ensureBotPresetHydratedById,
}))

import PromptDiffModal from './PromptDiffModal.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function promptItem(text: string) {
  return [{ type: 'plain', name: 'Main', role: 'system', type2: 'normal', text }]
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  ownerState.collectionsResourceState.values.botPresets = [
    { id: 'preset-a', name: 'A' },
    { id: 'preset-b', name: 'B' },
  ]
  ownerState.collectionsResourceState.statuses.botPresets = 'ready'
  ownerState.collectionsResourceState.errors = {}
  ownerState.settingsResourceState.value.promptDiffPrefs = undefined
  ownerState.settingsResourceState.groupStatuses.display = 'ready'
  ownerState.settingsResourceState.groupErrors = {}
  ensureBotPresetHydratedById.mockReset()
  ensureBotPresetHydratedById.mockImplementation(async (presetId) => {
    const owner = ownerState.collectionsResourceState.values.botPresets.find((preset) => preset.id === presetId)
    if (!owner) return false
    owner.localNetworkMode = false
    owner.promptTemplate = promptItem(presetId === 'preset-a' ? 'Alpha' : 'Beta')
    return true
  })
  applyServerBackedSetting.mockReset()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('PromptDiffModal resource owners', () => {
  it('hydrates and reads both preset bodies by their unique stable ids', async () => {
    component = mount(PromptDiffModal, { target, props: { firstPresetId: 0, secondPresetId: 1 } })

    await vi.waitFor(() => {
      expect(ensureBotPresetHydratedById).toHaveBeenCalledWith('preset-a')
      expect(ensureBotPresetHydratedById).toHaveBeenCalledWith('preset-b')
      expect(target.textContent).toContain('Alpha')
      expect(target.textContent).toContain('Beta')
    })
  })

  it('fails closed without hydration when preset ids are duplicated', async () => {
    ownerState.collectionsResourceState.values.botPresets = [
      { id: 'duplicate', name: 'A' },
      { id: 'duplicate', name: 'B' },
    ]
    component = mount(PromptDiffModal, { target, props: { firstPresetId: 0, secondPresetId: 1 } })
    await tick()

    expect(ensureBotPresetHydratedById).not.toHaveBeenCalled()
    expect(target.textContent).toContain('No diff computed yet.')
  })
})
