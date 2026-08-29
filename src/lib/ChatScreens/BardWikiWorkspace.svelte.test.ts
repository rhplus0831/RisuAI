import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BARDWIKI_GLOBAL_SETTINGS, BARDWIKI_PROTOCOL_VERSION } from '@risuai/protocol'

const reads = vi.hoisted(() => ({
  chat: vi.fn(),
  document: vi.fn(),
  versions: vi.fn(),
}))

const mutations = vi.hoisted(() => ({
  settings: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('src/ts/server/resourceReads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/ts/server/resourceReads')>()),
  fetchServerBardWikiChat: reads.chat,
  fetchServerBardWikiDocument: reads.document,
  fetchServerBardWikiVersions: reads.versions,
}))

vi.mock('src/ts/server/bardWikiCommands', () => ({
  saveBardWikiChatSettings: mutations.settings,
  createBardWikiDocument: mutations.create,
  updateBardWikiDocument: mutations.update,
  deleteBardWikiDocument: mutations.remove,
}))

import BardWikiWorkspace from './BardWikiWorkspace.svelte'
import { resetBardWikiResource } from 'src/ts/server/bardWikiResource'

type MountedComponent = Parameters<typeof unmount>[0]

const index = {
  id: 'document-a',
  chatId: 'chat-a',
  kind: 'location' as const,
  title: 'Old Tavern',
  logicalPath: 'Places/Old Tavern',
  normalizedPath: 'places/old tavern',
  aliases: ['Tavern'],
  contextPolicy: 'relevant' as const,
  reviewState: 'active' as const,
  contentHash: 'a'.repeat(64),
  version: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
}

const chatResource = {
  status: 'ok' as const,
  protocolVersion: BARDWIKI_PROTOCOL_VERSION,
  revision: 4,
  chatId: 'chat-a',
  globalSettings: DEFAULT_BARDWIKI_GLOBAL_SETTINGS,
  chatSettings: null,
  effectiveSettings: { ...DEFAULT_BARDWIKI_GLOBAL_SETTINGS, enabledByDefault: true },
  documents: [index],
  receipts: [],
  jobs: [],
}

const documentResource = {
  status: 'ok' as const,
  protocolVersion: BARDWIKI_PROTOCOL_VERSION,
  revision: 4,
  chatId: 'chat-a',
  document: { ...index, markdown: '# Old Tavern', deletedAt: null },
  links: [],
}

let component: MountedComponent | undefined
let target: HTMLElement

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await tick()
    await Promise.resolve()
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  )
  resetBardWikiResource()
  reads.chat.mockReset().mockResolvedValue(chatResource)
  reads.document.mockReset().mockResolvedValue(documentResource)
  reads.versions.mockReset().mockResolvedValue({
    status: 'ok',
    protocolVersion: BARDWIKI_PROTOCOL_VERSION,
    revision: 4,
    chatId: 'chat-a',
    documentId: 'document-a',
    versions: [
      {
        documentId: 'document-a',
        version: 1,
        kind: 'location',
        title: 'Old Tavern',
        logicalPath: 'Places/Old Tavern',
        normalizedPath: 'places/old tavern',
        aliases: ['Tavern'],
        contextPolicy: 'relevant',
        reviewState: 'active',
        markdown: '# Old Tavern',
        contentHash: 'a'.repeat(64),
        deleted: false,
        actor: 'user',
        reason: 'create',
        receiptId: null,
        jobId: null,
        commandRevision: 4,
        createdAt: '2026-08-29T00:00:00.000Z',
      },
    ],
    nextBeforeVersion: null,
  })
  const accepted = {
    status: 'ok',
    revision: 5,
    event: { type: 'bardwiki.updated', revision: 5, resource: 'bardWikiDocument' },
    document: documentResource.document,
  }
  mutations.settings.mockReset().mockResolvedValue({ status: 'accepted', result: { ...accepted, settings: {} } })
  mutations.create.mockReset().mockResolvedValue({ status: 'accepted', result: accepted })
  mutations.update.mockReset().mockResolvedValue({ status: 'accepted', result: accepted })
  mutations.remove.mockReset().mockResolvedValue({ status: 'accepted', result: accepted })
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  target.remove()
  vi.unstubAllGlobals()
})

describe('BardWiki workspace', () => {
  it('loads only the chat index until a document and its history are requested', async () => {
    component = mount(BardWikiWorkspace, { target, props: { chatId: 'chat-a' } })
    await settle()

    expect(reads.chat).toHaveBeenCalledWith('chat-a', undefined)
    expect(reads.document).not.toHaveBeenCalled()
    expect(reads.versions).not.toHaveBeenCalled()
    expect(target.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe('bardwiki-workspace-title')

    target.querySelector<HTMLButtonElement>('[aria-label="Open Old Tavern"]')?.click()
    await settle()

    expect(reads.document).toHaveBeenCalledWith('chat-a', 'document-a', undefined)
    expect(reads.versions).not.toHaveBeenCalled()
    expect(target.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('# Old Tavern')

    target.querySelector<HTMLButtonElement>('[aria-expanded="false"]')?.click()
    await settle()

    expect(reads.versions).toHaveBeenCalledWith('chat-a', 'document-a', {
      signal: undefined,
    })
    expect(target.textContent).toContain('Version 1')
  })

  it('shows distinct unavailable and retry states', async () => {
    reads.chat.mockResolvedValueOnce({ status: 'unavailable' })
    component = mount(BardWikiWorkspace, { target, props: { chatId: 'chat-a' } })
    await settle()

    expect(target.querySelector('[role="alert"]')?.textContent).toContain('offline')
    reads.chat.mockResolvedValueOnce(chatResource)
    target.querySelector<HTMLButtonElement>('[aria-label="Retry loading BardWiki"]')?.click()
    await settle()

    expect(reads.chat).toHaveBeenCalledTimes(2)
    expect(target.querySelector('[aria-label="Open Old Tavern"]')).toBeTruthy()
  })

  it('offers discard/reload and preserves a retrying draft behind the refreshed fence', async () => {
    component = mount(BardWikiWorkspace, { target, props: { chatId: 'chat-a' } })
    await settle()
    target.querySelector<HTMLButtonElement>('[aria-label="Open Old Tavern"]')?.click()
    await settle()

    const markdown = target.querySelector<HTMLTextAreaElement>('textarea')!
    markdown.value = '# My draft'
    markdown.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    mutations.update.mockResolvedValueOnce({
      status: 'conflict',
      result: { status: 'error', error: 'bardwiki_document_conflict' },
    })
    target.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
    await settle()

    expect(target.querySelector('[role="alert"]')?.textContent).toContain('newer server version')
    expect(target.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('# My draft')

    const latest = {
      ...documentResource,
      revision: 5,
      document: {
        ...documentResource.document,
        version: 2,
        contentHash: 'b'.repeat(64),
        markdown: '# Server version',
      },
    }
    reads.document.mockResolvedValueOnce(latest).mockResolvedValue(latest)
    const discard = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Discard draft and reload'),
    )
    discard?.click()
    await settle()
    expect(target.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('# Server version')

    const secondDraft = target.querySelector<HTMLTextAreaElement>('textarea')!
    secondDraft.value = '# My second draft'
    secondDraft.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    mutations.update.mockResolvedValueOnce({
      status: 'conflict',
      result: { status: 'error', error: 'bardwiki_document_conflict' },
    })
    target.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
    await settle()
    const newest = {
      ...latest,
      revision: 6,
      document: { ...latest.document, version: 3, contentHash: 'c'.repeat(64), markdown: '# Newest server version' },
    }
    reads.document.mockResolvedValueOnce(newest).mockResolvedValue(newest)
    const retry = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Keep draft and retry'),
    )
    retry?.click()
    await settle()

    expect(mutations.update).toHaveBeenLastCalledWith(
      'chat-a',
      'document-a',
      { expectedVersion: 3, expectedContentHash: 'c'.repeat(64) },
      expect.objectContaining({ markdown: '# My second draft' }),
    )
  })

  it('guards close while a document draft is unsaved', async () => {
    const close = vi.fn()
    const confirm = vi.mocked(globalThis.confirm)
    confirm.mockReturnValue(false)
    component = mount(BardWikiWorkspace, { target, props: { chatId: 'chat-a', close } })
    await settle()
    target.querySelector<HTMLButtonElement>('[aria-label="Open Old Tavern"]')?.click()
    await settle()
    const title = target.querySelector<HTMLInputElement>('input[required]')!
    title.value = 'Changed title'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()

    target.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click()

    expect(confirm).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
  })

  it('creates, renames, and deletes through explicit document actions', async () => {
    vi.mocked(globalThis.confirm).mockReturnValue(true)
    component = mount(BardWikiWorkspace, { target, props: { chatId: 'chat-a' } })
    await settle()

    const newDocument = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('New document'),
    )
    newDocument?.click()
    await settle()
    const required = target.querySelectorAll<HTMLInputElement>('input[required]')
    required[0]!.value = 'Arrival'
    required[0]!.dispatchEvent(new Event('input', { bubbles: true }))
    required[1]!.value = 'Events/Arrival'
    required[1]!.dispatchEvent(new Event('input', { bubbles: true }))
    const markdown = target.querySelector<HTMLTextAreaElement>('textarea')!
    markdown.value = '# Arrival'
    markdown.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    target.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
    await settle()

    expect(mutations.create).toHaveBeenCalledWith(
      'chat-a',
      expect.objectContaining({ title: 'Arrival', logicalPath: 'Events/Arrival', markdown: '# Arrival' }),
    )

    const title = target.querySelector<HTMLInputElement>('input[required]')!
    title.value = 'Renamed Tavern'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    target.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
    await settle()
    expect(mutations.update).toHaveBeenCalledWith(
      'chat-a',
      'document-a',
      expect.any(Object),
      expect.objectContaining({ title: 'Renamed Tavern' }),
    )

    const remove = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Remove',
    )
    remove?.click()
    await settle()
    expect(mutations.remove).toHaveBeenCalledWith('chat-a', 'document-a', expect.any(Object))
  })

  it('keeps a durable queued edit visibly pending until settlement', async () => {
    const settlement = deferred<{ status: 'accepted' }>()
    const close = vi.fn()
    vi.mocked(globalThis.confirm).mockReturnValue(false)
    component = mount(BardWikiWorkspace, { target, props: { chatId: 'chat-a', close } })
    await settle()
    target.querySelector<HTMLButtonElement>('[aria-label="Open Old Tavern"]')?.click()
    await settle()
    const markdown = target.querySelector<HTMLTextAreaElement>('textarea')!
    markdown.value = '# Queued draft'
    markdown.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    mutations.update.mockResolvedValueOnce({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationId: 'mutation-a',
      settlement: settlement.promise,
    })
    target.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
    await settle()

    expect(target.textContent).toContain('queued for retry')
    expect(target.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
    target.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click()
    expect(close).not.toHaveBeenCalled()

    settlement.resolve({ status: 'accepted' })
    await settle()
    expect(target.textContent).toContain('Saved on the server')
  })

  it('persists explicit per-chat overrides while leaving autonomous options absent', async () => {
    component = mount(BardWikiWorkspace, { target, props: { chatId: 'chat-a' } })
    await settle()
    const selects = target.querySelectorAll<HTMLSelectElement>('details select')
    selects[0]!.value = 'disabled'
    selects[0]!.dispatchEvent(new Event('change', { bubbles: true }))
    selects[1]!.value = 'hybrid'
    selects[1]!.dispatchEvent(new Event('change', { bubbles: true }))
    const budget = target.querySelector<HTMLInputElement>('details input[type="number"]')!
    budget.value = '4096'
    budget.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    const save = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Save chat overrides'),
    )
    save?.click()
    await settle()

    expect(mutations.settings).toHaveBeenCalledWith('chat-a', {
      enabledOverride: false,
      memoryModeOverride: 'hybrid',
      totalTokenBudgetOverride: 4096,
    })
    expect(target.textContent).not.toContain('Automatic confirmation')
    expect(target.textContent).not.toContain('canonical updates')
  })
})
