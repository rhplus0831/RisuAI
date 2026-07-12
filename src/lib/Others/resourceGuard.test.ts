import { mount, tick, unmount } from 'svelte'
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
  alertInput: vi.fn(),
  alertNormalWait: vi.fn(),
}))

import BookmarkList from './BookmarkList.svelte'
import HypaV3Modal from './HypaV3Modal.svelte'
import { alertInput } from 'src/ts/alert'
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
      summary: {
        id: 'server-summary-1',
        chatId: 'chat-1',
        chunkId: 'chunk-1',
        model: 'summary-model',
        text: 'Edited server summary',
        metadata: { chatMemos: ['msg-1'], isImportant: true, categoryId: 'story', tags: ['live'] },
        tokens: 0,
        createdAt: '2026-07-12T00:00:00.000Z',
      },
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
    expect(patchServerMemorySummary).toHaveBeenCalledWith('server-summary-1', {
      text: 'Edited server summary',
      isImportant: true,
      categoryId: 'story',
      tags: ['live'],
    })

    const importantButton = target.querySelector<HTMLButtonElement>('button[data-summary-action="important"]')
    expect(importantButton).not.toBeNull()
    importantButton!.click()
    for (let attempt = 0; attempt < 40 && vi.mocked(patchServerMemorySummary).mock.calls.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(vi.mocked(patchServerMemorySummary).mock.calls.at(-1)).toEqual([
      'server-summary-1',
      {
        text: 'Edited server summary',
        isImportant: false,
        categoryId: 'story',
        tags: ['live'],
      },
    ])
    expect(getDatabase().characters[0].chats[0].hypaV3Data).toBeUndefined()
  })

  it('renames bookmarks through a command patch without mutating guarded chat state', async () => {
    const calls = stubCommandFetch()
    vi.mocked(alertInput).mockResolvedValue('New name')
    bookmarkListOpen.set(true)
    setResourceWriteGuardEnabled(true)

    component = mount(BookmarkList, { target })
    await tick()

    const buttons = target.querySelectorAll('button')
    buttons[3].click()

    const command = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1' && call.method === 'PATCH',
    )
    expect(command.body.patch.bookmarkNames).toEqual({ 'msg-1': 'New name' })
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({ 'msg-1': 'Old name' })
  })

  it('removes bookmarks through a command patch without mutating guarded chat state', async () => {
    const calls = stubCommandFetch()
    bookmarkListOpen.set(true)
    setResourceWriteGuardEnabled(true)

    component = mount(BookmarkList, { target })
    await tick()

    const buttons = target.querySelectorAll('button')
    buttons[4].click()

    const command = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1' && call.method === 'PATCH',
    )
    expect(command.body.patch.bookmarks).toEqual([])
    expect(command.body.patch.bookmarkNames).toEqual({})
    expect(getDatabase().characters[0].chats[0].bookmarks).toEqual(['msg-1'])
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({ 'msg-1': 'Old name' })
  })
})
