import { mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

vi.mock('src/ts/platform', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('src/ts/storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'resource-guard-ui-token',
}))

vi.mock('src/ts/process/modules', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

vi.mock('src/ts/process/request/serverMemory', () => ({
  canUseServerMemoryApi: () => true,
  listServerMemorySummaries: vi.fn(async () => ({ status: 'ok', summaries: [] })),
  patchServerMemorySummary: vi.fn(async () => ({ status: 'error', error: 'not configured' })),
  deleteServerMemorySummary: vi.fn(async () => ({ status: 'error', error: 'not configured' })),
  listServerMemoryJobs: vi.fn(async () => ({ status: 'ok', jobs: [] })),
  cancelServerMemoryJob: vi.fn(async () => ({ status: 'ok', job: null })),
}))

vi.mock('src/ts/alert', () => ({
  alertError: vi.fn(),
  alertInput: vi.fn(),
  alertNormalWait: vi.fn(),
}))

import BookmarkList from './BookmarkList.svelte'
import HypaV3Modal from './HypaV3Modal.svelte'
import { alertError, alertInput } from 'src/ts/alert'
import { clearCachedServerCommandRevision } from 'src/ts/server/commands'
import { setResourceWriteGuardEnabled } from 'src/ts/server/resourceWriteGuard.svelte'
import { listServerMemorySummaries, patchServerMemorySummary } from 'src/ts/process/request/serverMemory'
import { bookmarkListOpen, hypaV3ModalOpen, selectedCharID } from 'src/ts/stores.svelte'
import { getDatabase, setDatabaseLite } from 'src/ts/storage/database.svelte'

interface CapturedFetch {
  url: string
  method: string
  body: any
}

interface DeferredResponse {
  promise: Promise<Response>
  resolve: (response: Response) => void
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 7 })
      if (url === '/api/v1/commands/chats/chat-1') {
        return jsonResponse({
          revision: 8,
          event: { type: 'chat.updated', revision: 8, resource: 'chat' },
        })
      }
      if (url === '/api/v1/memory/jobs?chatId=chat-1') {
        return jsonResponse({ jobs: [] })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void
  return {
    promise: new Promise<Response>((resolvePromise) => {
      resolve = resolvePromise
    }),
    resolve,
  }
}

function stubControlledFailingBookmarkCommands(): {
  calls: CapturedFetch[]
  responses: [DeferredResponse, DeferredResponse]
} {
  const calls: CapturedFetch[] = []
  const responses: [DeferredResponse, DeferredResponse] = [deferredResponse(), deferredResponse()]
  let commandIndex = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 7 })
      if (url === '/api/v1/commands/chats/chat-1') {
        const response = responses[commandIndex]
        commandIndex += 1
        return response.promise
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return { calls, responses }
}

async function waitForCommand(
  calls: CapturedFetch[],
  predicate: (call: CapturedFetch) => boolean,
): Promise<CapturedFetch> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const match = calls.find(predicate)
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`command not dispatched; saw: ${JSON.stringify(calls)}`)
}

async function waitForCommandCount(calls: CapturedFetch[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (calls.filter((call) => call.url === '/api/v1/commands/chats/chat-1').length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`expected ${count} chat commands; saw: ${JSON.stringify(calls)}`)
}

function bookmarkAction(target: HTMLElement, bookmarkId: string, action: 'rename' | 'remove'): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>(
    `[data-risu-bookmark-id="${bookmarkId}"] [data-risu-bookmark-action="${action}"]`,
  )
  expect(button, `${action} action for ${bookmarkId}`).not.toBeNull()
  return button!
}

function seedDatabase(): void {
  selectedCharID.set(0)
  setDatabaseLite({
    hypaV3PresetId: 0,
    hypaV3Presets: [{ name: 'Default', settings: { processRegexScript: false } }],
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        image: '',
        chatPage: 0,
        chats: [
          {
            id: 'chat-1',
            name: 'Main',
            message: [{ chatId: 'msg-1', role: 'user', data: 'Bookmarked line' }],
            bookmarks: ['msg-1'],
            bookmarkNames: { 'msg-1': 'Old name' },
            localLore: [],
          },
        ],
        type: 'character',
      },
    ],
  } as any)
}

describe('server resource guarded UI paths', () => {
  let target: HTMLElement
  let component: Record<string, never> | undefined

  beforeEach(() => {
    platformState.isFastifyServer = true
    clearCachedServerCommandRevision()
    setResourceWriteGuardEnabled(false)
    seedDatabase()
    vi.mocked(alertError).mockReset()
    vi.mocked(listServerMemorySummaries).mockResolvedValue({ status: 'ok', summaries: [] })
    vi.mocked(patchServerMemorySummary).mockResolvedValue({ status: 'error', error: 'not configured' })
    target = document.createElement('div')
    document.body.appendChild(target)
  })

  afterEach(() => {
    if (component) {
      unmount(component)
      component = undefined
    }
    setResourceWriteGuardEnabled(false)
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('mounts Hypa V3 server memory without initializing guarded chat state', async () => {
    hypaV3ModalOpen.set(true)
    setResourceWriteGuardEnabled(true)

    expect(() => {
      component = mount(HypaV3Modal, { target })
    }).not.toThrow()

    await tick()
    expect(getDatabase().characters[0].chats[0].hypaV3Data).toBeUndefined()
  })

  it('loads live server summaries into the Hypa V3 manager and edits them through the memory API', async () => {
    vi.mocked(listServerMemorySummaries).mockResolvedValue({
      status: 'ok',
      summaries: [
        {
          id: 'server-summary-1',
          chatId: 'chat-1',
          chunkId: 'chunk-1',
          model: 'summary-model',
          text: 'Live server summary',
          metadata: {
            chatMemos: ['msg-1'],
            isImportant: true,
            categoryId: 'story',
            tags: ['live'],
          },
          tokens: 4,
          createdAt: '2026-07-12T00:00:00.000Z',
        },
      ],
    })
    vi.mocked(patchServerMemorySummary).mockResolvedValue({
      status: 'ok',
      summaryId: 'server-summary-1',
    })
    hypaV3ModalOpen.set(true)
    setResourceWriteGuardEnabled(true)

    component = mount(HypaV3Modal, { target })
    let summaryTextarea: HTMLTextAreaElement | undefined
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await tick()
      summaryTextarea = Array.from(target.querySelectorAll('textarea')).find(
        (textarea) => textarea.value === 'Live server summary',
      )
      if (summaryTextarea) break
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(listServerMemorySummaries).toHaveBeenCalledWith('chat-1', undefined, expect.any(AbortSignal))
    expect(summaryTextarea).toBeDefined()
    summaryTextarea!.value = 'Edited server summary'
    summaryTextarea!.dispatchEvent(new Event('input', { bubbles: true }))
    summaryTextarea!.dispatchEvent(new Event('change', { bubbles: true }))

    for (let attempt = 0; attempt < 40 && vi.mocked(patchServerMemorySummary).mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(patchServerMemorySummary).toHaveBeenCalledWith('server-summary-1', { text: 'Edited server summary' })

    const importantButton = target.querySelector<HTMLButtonElement>('button[data-summary-action="important"]')
    expect(importantButton).not.toBeNull()
    importantButton!.click()
    for (let attempt = 0; attempt < 40 && vi.mocked(patchServerMemorySummary).mock.calls.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(vi.mocked(patchServerMemorySummary).mock.calls.at(-1)).toEqual(['server-summary-1', { isImportant: false }])
    expect(getDatabase().characters[0].chats[0].hypaV3Data).toBeUndefined()
  })

  it('renames bookmarks immediately while the command patch is pending', async () => {
    const calls = stubCommandFetch()
    vi.mocked(alertInput).mockResolvedValue('New name')
    bookmarkListOpen.set(true)
    setResourceWriteGuardEnabled(true)

    component = mount(BookmarkList, { target })
    await tick()

    bookmarkAction(target, 'msg-1', 'rename').click()

    const command = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1' && call.method === 'PATCH',
    )
    expect(command.body.patch.bookmarkNames).toEqual({ 'msg-1': 'New name' })
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({ 'msg-1': 'New name' })
    await tick()
    expect(target.textContent).toContain('New name')
    expect(target.textContent).not.toContain('Old name')
  })

  it('contains bookmark focus and restores the opener after Escape', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Open bookmarks'
    document.body.insertBefore(opener, target)
    bookmarkListOpen.set(true)
    opener.focus()

    component = mount(BookmarkList, { target })
    await Promise.resolve()
    await tick()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const backdrop = dialog?.parentElement
    const close = dialog?.querySelector<HTMLElement>('[data-modal-initial-focus]')
    if (!dialog || !backdrop || !close) throw new Error('Bookmark modal not found')
    expect(backdrop.hasAttribute('data-modal-root')).toBe(true)
    expect(dialog.getAttribute('aria-labelledby')).toBe('risu-bookmark-list-title')
    expect(opener.inert).toBe(true)
    expect(document.activeElement).toBe(close)

    opener.focus()
    expect(document.activeElement).toBe(close)

    const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    close.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(get(bookmarkListOpen)).toBe(false)

    unmount(component)
    component = undefined
    await Promise.resolve()
    await tick()
    expect(opener.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('removes bookmarks immediately while the command patch is pending', async () => {
    const calls = stubCommandFetch()
    bookmarkListOpen.set(true)
    setResourceWriteGuardEnabled(true)

    component = mount(BookmarkList, { target })
    await tick()

    bookmarkAction(target, 'msg-1', 'remove').click()

    const command = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1' && call.method === 'PATCH',
    )
    expect(command.body.patch.bookmarks).toEqual([])
    expect(command.body.patch.bookmarkNames).toEqual({})
    expect(getDatabase().characters[0].chats[0].bookmarks).toEqual([])
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({})
    await tick()
    expect(target.textContent).toContain('No Bookmarks')
    expect(target.textContent).not.toContain('Old name')
  })

  it('does not resurrect a bookmark name when the bookmark disappears while its rename prompt is open', async () => {
    const calls = stubCommandFetch()
    let resolveName!: (name: string) => void
    vi.mocked(alertInput).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveName = resolve
      }),
    )
    bookmarkListOpen.set(true)
    setResourceWriteGuardEnabled(true)

    component = mount(BookmarkList, { target })
    await tick()

    bookmarkAction(target, 'msg-1', 'rename').click()
    bookmarkAction(target, 'msg-1', 'remove').click()
    await tick()
    resolveName('Stale rename')

    await waitForCommandCount(calls, 1)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await tick()

    const commands = calls.filter((call) => call.url === '/api/v1/commands/chats/chat-1')
    expect(commands).toHaveLength(1)
    expect(commands[0].body.patch).toEqual({ bookmarks: [], bookmarkNames: {} })
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({})
    expect(target.textContent).toContain('No Bookmarks')
    expect(target.textContent).not.toContain('Stale rename')
  })

  it('restores both bookmarks when overlapping optimistic removals fail', async () => {
    const { calls, responses } = stubControlledFailingBookmarkCommands()
    const chat = getDatabase().characters[0].chats[0]
    chat.message.push({ chatId: 'msg-2', role: 'char', data: 'Second bookmarked line' })
    chat.bookmarks = ['msg-1', 'msg-2']
    chat.bookmarkNames = { 'msg-1': 'Old name', 'msg-2': 'Second name' }
    bookmarkListOpen.set(true)
    setResourceWriteGuardEnabled(true)

    component = mount(BookmarkList, { target })
    await tick()

    bookmarkAction(target, 'msg-1', 'remove').click()
    await tick()
    bookmarkAction(target, 'msg-2', 'remove').click()
    await tick()

    expect(chat.bookmarks).toEqual([])
    expect(target.textContent).toContain('No Bookmarks')
    await waitForCommandCount(calls, 1)

    responses[0].resolve(jsonResponse({ error: 'first failed' }, 500))
    await waitForCommandCount(calls, 2)
    responses[1].resolve(jsonResponse({ error: 'second failed' }, 500))

    await vi.waitFor(() => {
      expect(chat.bookmarks).toEqual(['msg-1', 'msg-2'])
      expect(chat.bookmarkNames).toEqual({ 'msg-1': 'Old name', 'msg-2': 'Second name' })
      expect(alertError).toHaveBeenCalledTimes(2)
    })
    await tick()
    expect(target.textContent).toContain('Old name')
    expect(target.textContent).toContain('Second name')
  })
})
