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
  getNodeServerProxyAuth: async () => 'projection-guard-ui-token',
}))

vi.mock('src/ts/process/modules', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

vi.mock('src/ts/process/request/serverMemory', () => ({
  canUseServerMemoryApi: () => true,
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
import { setServerProjectionWriteGuardEnabled } from 'src/ts/server/projectionWriteGuard.svelte'
import { bookmarkListOpen, DBState, hypaV3ModalOpen, selectedCharID } from 'src/ts/stores.svelte'

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
  DBState.db = {
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
  } as any
}

describe('server projection guarded UI paths', () => {
  let target: HTMLElement
  let component: Record<string, never> | undefined

  beforeEach(() => {
    platformState.isFastifyServer = true
    clearCachedServerCommandRevision()
    setServerProjectionWriteGuardEnabled(false)
    seedDatabase()
    target = document.createElement('div')
    document.body.appendChild(target)
  })

  afterEach(() => {
    if (component) {
      unmount(component)
      component = undefined
    }
    setServerProjectionWriteGuardEnabled(false)
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('mounts Hypa V3 server memory without initializing guarded chat state', async () => {
    hypaV3ModalOpen.set(true)
    setServerProjectionWriteGuardEnabled(true)

    expect(() => {
      component = mount(HypaV3Modal, { target })
    }).not.toThrow()

    await tick()
    expect(DBState.db.characters[0].chats[0].hypaV3Data).toBeUndefined()
  })

  it('renames bookmarks through a command patch without mutating guarded chat state', async () => {
    const calls = stubCommandFetch()
    vi.mocked(alertInput).mockResolvedValue('New name')
    bookmarkListOpen.set(true)
    setServerProjectionWriteGuardEnabled(true)

    component = mount(BookmarkList, { target })
    await tick()

    const buttons = target.querySelectorAll('button')
    buttons[3].click()

    const command = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1' && call.method === 'PATCH',
    )
    expect(command.body.patch.bookmarkNames).toEqual({ 'msg-1': 'New name' })
    expect(DBState.db.characters[0].chats[0].bookmarkNames).toEqual({ 'msg-1': 'Old name' })
  })

  it('removes bookmarks through a command patch without mutating guarded chat state', async () => {
    const calls = stubCommandFetch()
    bookmarkListOpen.set(true)
    setServerProjectionWriteGuardEnabled(true)

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
    expect(DBState.db.characters[0].chats[0].bookmarks).toEqual(['msg-1'])
    expect(DBState.db.characters[0].chats[0].bookmarkNames).toEqual({ 'msg-1': 'Old name' })
  })
})
