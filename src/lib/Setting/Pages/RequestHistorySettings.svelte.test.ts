import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  persist: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('src/ts/server/requestHistory', () => ({
  listRequestHistory: mocks.list,
  getRequestHistoryRecord: mocks.get,
  deleteRequestHistoryRecord: mocks.remove,
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  persistServerBackedSettingsPatchWithSettlement: mocks.persist,
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: mocks.confirm,
}))

import RequestHistorySettings from './RequestHistorySettings.svelte'
import { language } from 'src/lang'

const summary = {
  id: 'history-a',
  startedAt: 100,
  completedAt: 200,
  status: 'success' as const,
  source: 'chat',
  profile: {
    id: 'profile-a',
    name: 'Profile A',
    role: 'chatMain',
    sourceKind: 'durable-profile',
    provider: 'openai',
    modelId: 'gpt-4o',
    requestModel: 'gpt-4o',
  },
  context: { characterId: 'char-a', chatId: 'chat-a', chatName: 'Chat A' },
  responsePreview: 'Hello',
}

let target: HTMLElement
let component: ReturnType<typeof mount> | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  mocks.list.mockReset().mockResolvedValue({ status: 'ok', value: { limit: 20, records: [summary] } })
  mocks.get.mockReset().mockResolvedValue({
    status: 'ok',
    value: {
      ...summary,
      prompt: [{ role: 'user', content: 'Private prompt' }],
      toggles: { lore: '1' },
      response: 'Private response',
      metadata: { finishReason: 'stop' },
      apiMetadata: { usage: { prompt_tokens: 12, completion_tokens: 3 } },
    },
  })
  mocks.remove.mockReset().mockResolvedValue({ status: 'ok', value: { id: 'history-a' } })
  mocks.persist.mockReset().mockResolvedValue({ status: 'accepted' })
  mocks.confirm.mockReset().mockResolvedValue(true)
  component = mount(RequestHistorySettings, { target })
})

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  target.remove()
})

describe('RequestHistorySettings', () => {
  it('loads summaries and reveals the full private record only when selected', async () => {
    await vi.waitFor(() => expect(target.textContent).toContain('Profile A'))
    expect(target.textContent).not.toContain('Private prompt')

    const rowButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Profile A'),
    )
    rowButton?.click()
    await vi.waitFor(() => expect(target.textContent).toContain('Private prompt'))

    expect(mocks.get).toHaveBeenCalledWith('history-a', expect.any(AbortSignal))
    expect(target.textContent).toContain('Private response')
    expect(target.textContent).toContain(language.requestHistoryApiMetadata)
    expect(target.textContent).toContain('prompt_tokens')
    const detailHeadings = Array.from(target.querySelectorAll('h3'), (heading) => heading.textContent?.trim())
    expect(detailHeadings.indexOf(language.requestHistoryApiMetadata)).toBe(
      detailHeadings.indexOf(language.requestHistoryMetadata) + 1,
    )
  })

  it('saves an integer retention limit and refreshes the list', async () => {
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledOnce())
    const input = target.querySelector<HTMLInputElement>('#request-history-limit')!
    input.value = '3'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const save = Array.from(target.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === language.requestHistorySaveLimit,
    )
    save?.click()

    await vi.waitFor(() => expect(mocks.persist).toHaveBeenCalledWith({ requestHistoryLimit: 3 }))
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it('reconciles an offline-queued limit after durable replay settles', async () => {
    let settle: ((settlement: 'accepted' | 'failed') => void) | undefined
    mocks.persist.mockResolvedValueOnce({
      status: 'queued',
      mutationId: 'request-history-limit-1',
      settlement: new Promise<'accepted' | 'failed'>(() => {}),
      subscribeSettlement(listener: (settlement: 'accepted' | 'failed') => void) {
        settle = listener
        return () => {
          settle = undefined
        }
      },
    })
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledOnce())
    const input = target.querySelector<HTMLInputElement>('#request-history-limit')!
    input.value = '3'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const save = Array.from(target.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === language.requestHistorySaveLimit,
    )
    save?.click()
    await vi.waitFor(() => expect(target.textContent).toContain(language.settingsSaveQueued))

    mocks.list.mockResolvedValue({ status: 'ok', value: { limit: 3, records: [summary] } })
    settle?.('accepted')

    await vi.waitFor(() => expect(target.textContent).not.toContain(language.settingsSaveQueued))
    expect(mocks.list).toHaveBeenCalledTimes(3)
    expect(input.value).toBe('3')
  })

  it('deletes only the selected records after confirmation', async () => {
    await vi.waitFor(() => expect(target.textContent).toContain('Profile A'))
    const checkbox = target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    const remove = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Delete selected'),
    )
    remove?.click()

    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('history-a', expect.any(AbortSignal)))
    expect(mocks.confirm).toHaveBeenCalledWith(language.requestHistoryDeleteConfirm(1))
    expect(target.textContent).toContain(language.requestHistoryEmpty)
  })
})
