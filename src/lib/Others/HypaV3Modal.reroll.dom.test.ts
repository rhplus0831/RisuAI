import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), chatCompletion: vi.fn() }))

vi.mock('src/ts/server/resourceInvalidation', () => ({
  refreshServerResourceTargets: mocks.refresh,
}))
vi.mock('src/ts/storage/fastifyStorage', () => ({ getNodeServerProxyAuth: async () => 'test-auth' }))
vi.mock('src/ts/process/webllm', () => ({ chatCompletion: mocks.chatCompletion, unloadEngine: vi.fn() }))
vi.mock('src/ts/process/modules', async (importActual) => ({
  ...(await importActual<typeof import('src/ts/process/modules')>()),
  moduleUpdate: () => {},
  getModuleTriggers: () => [],
}))

import ModalSummaryItem from './HypaV3Modal/modal-summary-item.svelte'
import { createHypaV3Preset, type SerializableSummary } from 'src/ts/process/memory/hypav3'
import { setDatabase } from 'src/ts/storage/database.svelte'
import { selectedCharID } from 'src/ts/stores.svelte'
import { createDefaultModelRoleProfiles } from 'src/ts/model/modelProfileRecords'
import {
  applyCollectionsResource,
  applySettingsGroupResource,
  collectionsResourceState,
  settingsResourceState,
} from 'src/ts/server/resourceState.svelte'
import { SERVER_SETTINGS_KEYS_BY_GROUP, type SettingsGroup } from 'src/ts/server/settingsGroups'

let target: HTMLElement
let component: ReturnType<typeof mount> | undefined
let fetchSpy: ReturnType<typeof vi.fn>

function button(action: string): HTMLButtonElement {
  const result = target.querySelector<HTMLButtonElement>(`[data-summary-action="${action}"]`)
  if (!result) throw new Error(`Missing summary action: ${action}`)
  return result
}

function seedSummary(model: string): SerializableSummary {
  const preset = createHypaV3Preset('Default', { summarizationModel: model }, 'hypa-default')
  setDatabase({
    aiModel: 'gpt-4o',
    subModel: 'gpt-4o',
    providerCredentials: [{ id: 'memory-key', name: 'Memory', type: 'apiKey', apiKey: 'test-key' }],
    modelProfiles: [
      {
        id: 'memory-profile',
        name: 'Memory',
        modelId: 'gpt-4o',
        providerOptions: { credentialId: 'memory-key' },
      },
    ],
    modelRoleProfiles: {
      ...createDefaultModelRoleProfiles(),
      memory: { mode: 'profile', profileId: 'memory-profile' },
    },
    hypaV3Presets: [preset],
    selectedHypaV3PresetId: preset.id,
    hypaV3PresetId: 0,
    characters: [
      {
        type: 'character',
        chaId: 'character-a',
        name: 'Character A',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            message: [{ chatId: 'message-a', role: 'char', data: 'Connected story message' }],
          },
        ],
      },
    ],
  } as never)
  selectedCharID.set(0)

  const settings = safeStructuredClone(settingsResourceState.value)
  settingsResourceState.groupStatuses = { display: 'ready' }
  delete collectionsResourceState.values.hypaV3Presets
  collectionsResourceState.statuses.hypaV3Presets = 'idle'
  mocks.refresh.mockImplementation(async (targets: { settingsGroups?: SettingsGroup[]; collections?: string[] }) => {
    for (const group of targets.settingsGroups ?? []) {
      applySettingsGroupResource({ revision: 10, group, settings }, SERVER_SETTINGS_KEYS_BY_GROUP[group])
    }
    if (targets.collections?.includes('hypaV3Presets')) {
      applyCollectionsResource({ revision: 10, collections: { hypaV3Presets: [preset] } }, 'hypaV3Presets')
    }
    return { status: 'ok', revision: 10, scope: 'targeted' }
  })

  const summary: SerializableSummary = { text: 'Saved summary', chatMemos: ['message-a'], isImportant: false }
  component = mount(ModalSummaryItem, {
    target,
    props: {
      summaryIndex: 0,
      hypaV3Data: { summaries: [summary] },
      summaryItemStateMap: new WeakMap(),
      expandedMessageState: null,
      searchState: null,
      filterSelected: false,
      categories: [{ id: '', name: 'Unclassified' }],
    },
  })
  return summary
}

beforeEach(() => {
  mocks.refresh.mockReset()
  mocks.chatCompletion.mockReset().mockRejectedValue(new Error('Unexpected WebLLM dispatch'))
  fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify({ type: 'success', result: 'New summary' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetchSpy)
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  target.remove()
  vi.unstubAllGlobals()
})

describe('HypaV3 summary reroll with deferred resources', () => {
  it.each(['subModel', 'memory'])('loads the preset and rerolls through the %s API path', async (model) => {
    const summary = seedSummary(model)
    button('reroll').click()

    await vi.waitFor(() =>
      expect(
        fetchSpy,
        Array.from(target.querySelectorAll('textarea'), (item) => item.value).join('\n'),
      ).toHaveBeenCalledOnce(),
    )
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/v1/generate/completion')
    expect(JSON.parse(options.body)).toMatchObject({
      kind: 'server-intent',
      mode: 'memory',
      stream: false,
      messages: [{ role: 'user', content: 'assistant: Connected story message' }, { role: 'system' }],
    })
    expect(mocks.chatCompletion).not.toHaveBeenCalled()
    expect(settingsResourceState.groupStatuses.data).toBeUndefined()
    expect(settingsResourceState.groupStatuses.account).toBeUndefined()
    await vi.waitFor(() => expect(button('apply-rerolled').disabled).toBe(false))
    expect(summary.text).toBe('Saved summary')
    button('apply-rerolled').click()
    expect(summary.text).toBe('New summary')
  })

  it('shows a resource failure and allows retry without overwriting the saved summary', async () => {
    const summary = seedSummary('subModel')
    const refresh = mocks.refresh.getMockImplementation()!
    mocks.refresh.mockResolvedValue({ status: 'error', error: 'Unable to load memory settings' })
    button('reroll').click()

    await vi.waitFor(() =>
      expect(
        Array.from(target.querySelectorAll('textarea')).some((textarea) =>
          textarea.value.includes('Reroll failed: Unable to load memory settings'),
        ),
      ).toBe(true),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(button('apply-rerolled').disabled).toBe(true)
    expect(summary.text).toBe('Saved summary')

    mocks.refresh.mockImplementation(refresh)
    button('reroll').click()
    await vi.waitFor(() => expect(button('apply-rerolled').disabled).toBe(false))
  })
})
