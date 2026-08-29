import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BARDWIKI_GLOBAL_SETTINGS, BARDWIKI_PROTOCOL_VERSION } from '@risuai/protocol'

const reads = vi.hoisted(() => ({
  chat: vi.fn(),
  document: vi.fn(),
  versions: vi.fn(),
}))

vi.mock('src/ts/server/resourceReads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/ts/server/resourceReads')>()),
  fetchServerBardWikiChat: reads.chat,
  fetchServerBardWikiDocument: reads.document,
  fetchServerBardWikiVersions: reads.versions,
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

beforeEach(() => {
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
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  target.remove()
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
    expect(target.querySelector('[data-testid="bardwiki-document-detail"]')?.textContent).toContain('# Old Tavern')

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
})
