import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Regression coverage: the global lorebook add / folder / import helpers
// captured a `lorebook`/`lore` alias from the read-only projection before the
// trusted write swapped the resource-backed database to a mutable clone, then pushed into that
// stale alias and threw. The writes must run against the freshly-cloned mutable
// projection and still dispatch the matching global-lorebook command.

vi.mock('../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'lorebook-projection-token',
}))

const downloadFile = vi.hoisted(() => vi.fn(async (_filename: string, _data: Uint8Array) => undefined))

vi.mock('../../globalApi.svelte', async (importActual) => ({
  ...(await importActual<typeof import('../../globalApi.svelte')>()),
  downloadFile,
}))

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, getModuleLorebooks: () => [] }
})

const fileSelection = vi.hoisted(() => ({
  data: null as Uint8Array | null,
  beforeResolve: null as null | (() => void | Promise<void>),
  calls: 0,
}))

vi.mock('../../filePicker', () => {
  return {
    selectSingleFile: async () => {
      fileSelection.calls += 1
      await fileSelection.beforeResolve?.()
      return { name: 'lore.json', data: fileSelection.data }
    },
  }
})

import { safeStructuredClone } from '../../polyfill'
import { addLorebook, addLorebookFolder, exportLoreBook, importLoreBook } from '../lorebook.svelte'
import { clearCachedServerCommandRevision } from '../../server/commands'
import { resetLorebookHydration } from '../../server/lorebookOwner.svelte'
import { setResourceWriteGuardEnabled, withTrustedResourceWrite } from '../../server/resourceWriteGuard.svelte'
import { getDatabase, setDatabaseLite } from '../../storage/database.svelte'
import { selectedCharID } from '../../stores.svelte'
import { lorebookPageOwner } from '../../server/lorebookPageOwner.svelte'

interface CapturedFetch {
  url: string
  method: string
  body: any
}

interface StubCommandFetchOptions {
  failCommands?: boolean
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(options: StubCommandFetchOptions = {}): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  let revision = 10
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url.startsWith('/api/v1/commands/')) {
        if (options.failCommands) return jsonResponse({ error: 'command failed' }, 500)
        revision += 1
        return jsonResponse({
          revision,
          event: { type: 'lorebook.entry.upserted', revision, resource: 'lorebook' },
        })
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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const match = calls.find(predicate)
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`command not dispatched; saw: ${JSON.stringify(calls)}`)
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function waitForPicker(): Promise<void> {
  await vi.waitFor(() => {
    expect(fileSelection.calls).toBeGreaterThan(0)
  })
}

function delayPicker() {
  const pending = createDeferred<void>()
  fileSelection.beforeResolve = () => pending.promise
  return pending
}

function selectedRisuLore(comment: string): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ type: 'risu', data: [{ key: comment.toLowerCase(), comment, content: 'x' }] }),
  )
}

function entryComments(entries: Array<{ comment?: string }>): string[] {
  return entries.map((entry) => entry.comment ?? '')
}

function seedDatabase(): void {
  selectedCharID.set(0)
  setDatabaseLite({
    loreBook: [
      { id: 'lore-1', name: 'Global', data: [] },
      { id: 'lore-2', name: 'Other Global', data: [] },
    ],
    loreBookPage: 0,
    characters: [
      {
        chaId: 'char-a',
        name: 'Character A',
        chatPage: 0,
        chats: [
          { id: 'chat-1', message: [], note: '', name: 'main', localLore: [] },
          { id: 'chat-2', message: [], note: '', name: 'second', localLore: [] },
        ],
        globalLore: [],
        type: 'character',
      },
      {
        chaId: 'char-b',
        name: 'Character B',
        chatPage: 0,
        chats: [{ id: 'chat-b', message: [], note: '', name: 'other', localLore: [] }],
        globalLore: [],
        type: 'character',
      },
    ],
    modules: [],
    characterOrder: [],
  } as any)
  lorebookPageOwner.reset()
  lorebookPageOwner.hydrate({
    revision: 1,
    setting: 'loreBookPage',
    state: { present: true, value: 0 },
  })
}

const isGlobalEntries = (call: CapturedFetch) =>
  /\/api\/v1\/commands\/lorebooks\/lore-1\/entries\/[^/]+$/.test(call.url) && call.method === 'PUT'

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).safeStructuredClone = safeStructuredClone
  fileSelection.data = null
  fileSelection.beforeResolve = null
  fileSelection.calls = 0
  downloadFile.mockClear()
  clearCachedServerCommandRevision()
  resetLorebookHydration()
  setResourceWriteGuardEnabled(false)
  seedDatabase()
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('global lorebook durable writes under the resource guard', () => {
  it('baseline: a raw global lorebook write throws while the guard is active', () => {
    setResourceWriteGuardEnabled(true)
    expect(() => {
      ;(getDatabase().loreBook[0] as { data: unknown[] }).data.push({ id: 'raw' })
    }).toThrow(/resource database compatibility view is read-only/)
  })

  it('does not mutate, import into, or export an unhydrated character lorebook stub', async () => {
    const calls = stubCommandFetch()
    fileSelection.data = selectedRisuLore('Must Not Appear')
    withTrustedResourceWrite(() => {
      getDatabase().enableLorebookStubs = true
    })
    setResourceWriteGuardEnabled(true)

    addLorebook(0)
    addLorebookFolder(0)
    await importLoreBook('global')
    await exportLoreBook('global')

    expect(getDatabase().characters[0].globalLore).toEqual([])
    expect(downloadFile).not.toHaveBeenCalled()
    expect(calls.filter((call) => call.url.startsWith('/api/v1/commands/'))).toHaveLength(0)
  })

  it('addLorebook(-1) appends a global entry and dispatches the entries command', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(() => addLorebook(-1)).not.toThrow()
    expect((getDatabase().loreBook[0] as { data: unknown[] }).data).toHaveLength(1)

    const cmd = await waitForCommand(calls, isGlobalEntries)
    expect(cmd.body.entry).toMatchObject({ comment: 'New Lore 1' })
  })

  it('addLorebookFolder(-1) appends a global folder and dispatches the entries command', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(() => addLorebookFolder(-1)).not.toThrow()
    const entries = (getDatabase().loreBook[0] as { data: { mode?: string }[] }).data
    expect(entries).toHaveLength(1)
    expect(entries[0].mode).toBe('folder')

    const cmd = await waitForCommand(calls, isGlobalEntries)
    expect(cmd.body.entry).toMatchObject({ comment: 'New Folder', mode: 'folder' })
  })

  it('targets the owner-selected global lorebook instead of a stale compatibility pointer', async () => {
    const calls = stubCommandFetch()
    lorebookPageOwner.hydrate({
      revision: 2,
      setting: 'loreBookPage',
      state: { present: true, value: 1 },
    })
    withTrustedResourceWrite(() => {
      getDatabase().loreBookPage = 0
    })
    setResourceWriteGuardEnabled(true)

    expect(() => addLorebook(-1)).not.toThrow()
    expect((getDatabase().loreBook[0] as { data: unknown[] }).data).toHaveLength(0)
    expect((getDatabase().loreBook[1] as { data: unknown[] }).data).toHaveLength(1)

    await waitForCommand(
      calls,
      (call) => /\/api\/v1\/commands\/lorebooks\/lore-2\/entries\/[^/]+$/.test(call.url) && call.method === 'PUT',
    )
  })

  it('importLoreBook(sglobal) merges imported entries and dispatches the entries command', async () => {
    const imported = { type: 'risu', data: [{ key: 'imported', comment: 'Imported', content: 'x' }] }
    fileSelection.data = new TextEncoder().encode(JSON.stringify(imported))
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    await expect(importLoreBook('sglobal')).resolves.not.toThrow()
    expect((getDatabase().loreBook[0] as { data: unknown[] }).data).toHaveLength(1)

    const cmd = await waitForCommand(calls, isGlobalEntries)
    expect(cmd.body.entry).toMatchObject({ comment: 'Imported' })
  })

  it('importLoreBook(sglobal) keeps the original global lorebook target when the page changes during file selection', async () => {
    fileSelection.data = selectedRisuLore('Original Global Import')
    const calls = stubCommandFetch()
    const picker = delayPicker()
    setResourceWriteGuardEnabled(true)

    const importPromise = importLoreBook('sglobal')
    await waitForPicker()

    withTrustedResourceWrite(() => {
      getDatabase().loreBookPage = 1
    })
    picker.resolve()
    await importPromise

    expect(entryComments((getDatabase().loreBook[0] as { data: Array<{ comment?: string }> }).data)).toEqual([
      'Original Global Import',
    ])
    expect((getDatabase().loreBook[1] as { data: unknown[] }).data).toHaveLength(0)

    await waitForCommand(
      calls,
      (call) => /\/api\/v1\/commands\/lorebooks\/lore-1\/entries\/[^/]+$/.test(call.url) && call.method === 'PUT',
    )
    expect(calls.some((call) => call.url.includes('/lorebooks/lore-2/'))).toBe(false)
  })

  it('importLoreBook(global) keeps the original character target when selection and order change during file selection', async () => {
    fileSelection.data = selectedRisuLore('Original Character Import')
    const calls = stubCommandFetch()
    const picker = delayPicker()
    setResourceWriteGuardEnabled(true)

    const importPromise = importLoreBook('global')
    await waitForPicker()

    selectedCharID.set(1)
    withTrustedResourceWrite(() => {
      const database = getDatabase()
      const [charA, charB] = database.characters
      database.characters = [charB, charA] as typeof database.characters
    })
    selectedCharID.set(0)

    picker.resolve()
    await importPromise

    const charA = getDatabase().characters.find((character) => character.chaId === 'char-a')
    const charB = getDatabase().characters.find((character) => character.chaId === 'char-b')
    expect(entryComments(charA?.globalLore ?? [])).toEqual(['Original Character Import'])
    expect(charB?.globalLore ?? []).toHaveLength(0)

    await waitForCommand(
      calls,
      (call) =>
        /\/api\/v1\/commands\/characters\/char-a\/lorebooks\/entries\/[^/]+$/.test(call.url) && call.method === 'PUT',
    )
    expect(calls.some((call) => call.url.includes('/characters/char-b/lorebooks'))).toBe(false)
  })

  it('importLoreBook(local) keeps the original active chat target when chatPage changes during file selection', async () => {
    fileSelection.data = selectedRisuLore('Original Chat Import')
    const calls = stubCommandFetch()
    const picker = delayPicker()
    setResourceWriteGuardEnabled(true)

    const importPromise = importLoreBook('local')
    await waitForPicker()

    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatPage = 1
    })
    picker.resolve()
    await importPromise

    const charA = getDatabase().characters.find((character) => character.chaId === 'char-a')
    expect(entryComments(charA?.chats.find((chat) => chat.id === 'chat-1')?.localLore ?? [])).toEqual([
      'Original Chat Import',
    ])
    expect(charA?.chats.find((chat) => chat.id === 'chat-2')?.localLore ?? []).toHaveLength(0)

    await waitForCommand(
      calls,
      (call) =>
        /\/api\/v1\/commands\/chats\/chat-1\/lorebooks\/entries\/[^/]+$/.test(call.url) && call.method === 'PUT',
    )
    expect(calls.some((call) => call.url.includes('/chats/chat-2/lorebooks'))).toBe(false)
  })

  it('importLoreBook(global) keeps edits made during file selection when the import command rolls back', async () => {
    fileSelection.data = selectedRisuLore('Failed Import')
    const calls = stubCommandFetch({ failCommands: true })
    const picker = delayPicker()
    setResourceWriteGuardEnabled(true)

    const importPromise = importLoreBook('global')
    await waitForPicker()

    withTrustedResourceWrite(() => {
      getDatabase().characters[0].globalLore.push({
        id: 'during-picker-entry',
        key: 'during',
        comment: 'During Picker Edit',
        content: 'kept',
        mode: 'normal',
        insertorder: 100,
        alwaysActive: false,
        secondkey: '',
        selective: false,
      })
    })

    picker.resolve()
    await importPromise

    expect(entryComments(getDatabase().characters[0].globalLore)).toEqual(['During Picker Edit', 'Failed Import'])
    await waitForCommand(
      calls,
      (call) =>
        /\/api\/v1\/commands\/characters\/char-a\/lorebooks\/entries\/[^/]+$/.test(call.url) && call.method === 'PUT',
    )

    await vi.waitFor(() => {
      expect(entryComments(getDatabase().characters[0].globalLore)).toEqual(['During Picker Edit'])
    })
  })

  it('exports standalone Agent-only lorebook entries as inert without mutating stored entries', async () => {
    withTrustedResourceWrite(() => {
      getDatabase().loreBook[0].data = [
        {
          id: 'agent-only-export',
          key: 'live-key',
          secondkey: 'live-secondary',
          insertorder: 100,
          comment: 'Agent Notes',
          content: 'private context',
          mode: 'normal',
          alwaysActive: true,
          selective: true,
          agentOnly: true,
        },
      ]
    })
    const storedBefore = safeStructuredClone(getDatabase().loreBook[0].data)

    await exportLoreBook('sglobal')

    const bytes = downloadFile.mock.calls[0]?.[1] as Uint8Array
    const exported = JSON.parse(Buffer.from(bytes).toString('utf-8'))
    expect(exported.data[0]).toMatchObject({
      key: '',
      secondkey: '',
      alwaysActive: false,
      agentOnly: true,
    })
    expect(getDatabase().loreBook[0].data).toEqual(storedBefore)
  })
})
