import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CHAT_COMPOSER_DRAFT_LIMIT,
  DEFAULT_CHAT_COMPOSER_DRAFT_MAX_AGE_MS,
  clearDefaultChatComposerDrafts,
  currentDefaultChatComposerDraftGeneration,
  deleteDefaultChatComposerDraft,
  readDefaultChatComposerDraft,
  registerDefaultChatComposerDraftStorageFailureListener,
  resetDefaultChatComposerDraftRuntimeForTests,
  writeDefaultChatComposerDraft,
} from './DefaultChatScreen.composerDrafts'
import { initializeDraftRecoveryScope, resetDraftRecoveryScopeForTests } from 'src/ts/server/draftRecoveryScope'

beforeEach(() => {
  resetDraftRecoveryScopeForTests()
  clearDefaultChatComposerDrafts()
  initializeDraftRecoveryScope({ databaseLineage: 'database-a', writerSessionId: 'writer-a' })
})

afterEach(() => {
  clearDefaultChatComposerDrafts()
  resetDraftRecoveryScopeForTests()
})

describe('DefaultChatScreen composer draft cache', () => {
  it('clones drafts on write and read', () => {
    const draft = {
      messageInput: 'Draft',
      messageInputTranslate: 'Translated draft',
      fileInput: ['asset-a'],
      draftText: 'Hook draft',
      btwText: 'BTW result',
    }

    writeDefaultChatComposerDraft('chat-a', draft)
    draft.fileInput.push('mutated-after-write')

    const firstRead = readDefaultChatComposerDraft('chat-a')
    expect(firstRead).toEqual({
      messageInput: 'Draft',
      messageInputTranslate: 'Translated draft',
      fileInput: ['asset-a'],
      draftText: 'Hook draft',
      btwText: 'BTW result',
    })

    firstRead?.fileInput.push('mutated-after-read')
    expect(readDefaultChatComposerDraft('chat-a')?.fileInput).toEqual(['asset-a'])
  })

  it('evicts the least recently used transcript when the cache reaches its limit', () => {
    for (let index = 0; index < DEFAULT_CHAT_COMPOSER_DRAFT_LIMIT; index += 1) {
      writeDefaultChatComposerDraft(`chat-${index}`, {
        messageInput: `Draft ${index}`,
        messageInputTranslate: '',
        fileInput: [],
        draftText: '',
        btwText: '',
      })
    }

    expect(readDefaultChatComposerDraft('chat-0')?.messageInput).toBe('Draft 0')
    writeDefaultChatComposerDraft('chat-over-limit', {
      messageInput: 'Newest draft',
      messageInputTranslate: '',
      fileInput: [],
      draftText: '',
      btwText: '',
    })

    expect(readDefaultChatComposerDraft('chat-0')?.messageInput).toBe('Draft 0')
    expect(readDefaultChatComposerDraft('chat-1')).toBeUndefined()
    expect(readDefaultChatComposerDraft('chat-over-limit')?.messageInput).toBe('Newest draft')
  })

  it('restores all five fields after a fresh module runtime and keeps transcripts isolated', () => {
    writeDefaultChatComposerDraft('chat-a', {
      messageInput: 'Message A',
      messageInputTranslate: 'Translation A',
      fileInput: ['asset-a', 'asset-b'],
      draftText: 'Hook A',
      btwText: 'BTW A',
    })
    writeDefaultChatComposerDraft('chat-b', {
      messageInput: 'Message B',
      messageInputTranslate: '',
      fileInput: [],
      draftText: '',
      btwText: '',
    })

    resetDefaultChatComposerDraftRuntimeForTests()

    expect(readDefaultChatComposerDraft('chat-a')).toEqual({
      messageInput: 'Message A',
      messageInputTranslate: 'Translation A',
      fileInput: ['asset-a', 'asset-b'],
      draftText: 'Hook A',
      btwText: 'BTW A',
    })
    expect(readDefaultChatComposerDraft('chat-b')?.messageInput).toBe('Message B')
  })

  it('rejects another writer while leaving its same-lineage draft dormant', () => {
    writeDefaultChatComposerDraft('chat-a', {
      messageInput: 'Scoped draft',
      messageInputTranslate: '',
      fileInput: [],
      draftText: '',
      btwText: '',
    })

    resetDefaultChatComposerDraftRuntimeForTests()
    initializeDraftRecoveryScope({ databaseLineage: 'database-a', writerSessionId: 'writer-b' })
    expect(readDefaultChatComposerDraft('chat-a')).toBeUndefined()

    initializeDraftRecoveryScope({ databaseLineage: 'database-a', writerSessionId: 'writer-a' })
    resetDefaultChatComposerDraftRuntimeForTests()
    expect(readDefaultChatComposerDraft('chat-a')?.messageInput).toBe('Scoped draft')
  })

  it('rejects and cleans records from another database lineage', () => {
    writeDefaultChatComposerDraft('chat-a', {
      messageInput: 'Old database draft',
      messageInputTranslate: '',
      fileInput: [],
      draftText: '',
      btwText: '',
    })

    resetDefaultChatComposerDraftRuntimeForTests()
    initializeDraftRecoveryScope({ databaseLineage: 'database-b', writerSessionId: 'writer-a' })
    expect(readDefaultChatComposerDraft('chat-a')).toBeUndefined()

    initializeDraftRecoveryScope({ databaseLineage: 'database-a', writerSessionId: 'writer-a' })
    resetDefaultChatComposerDraftRuntimeForTests()
    expect(readDefaultChatComposerDraft('chat-a')).toBeUndefined()
  })

  it('deletes only the exact consumed generation', () => {
    const older = writeDefaultChatComposerDraft('chat-a', {
      messageInput: 'Older',
      messageInputTranslate: '',
      fileInput: [],
      draftText: '',
      btwText: '',
    })
    const newer = writeDefaultChatComposerDraft('chat-a', {
      messageInput: 'Newer',
      messageInputTranslate: '',
      fileInput: [],
      draftText: '',
      btwText: '',
    })

    expect(deleteDefaultChatComposerDraft('chat-a', older)).toBe(false)
    expect(readDefaultChatComposerDraft('chat-a')?.messageInput).toBe('Newer')
    const refreshed = currentDefaultChatComposerDraftGeneration('chat-a')
    expect(refreshed?.sequence).toBe(newer?.sequence)
    expect(deleteDefaultChatComposerDraft('chat-a', refreshed)).toBe(true)
    expect(readDefaultChatComposerDraft('chat-a')).toBeUndefined()
  })

  it('drops corrupt records without breaking the in-memory composer', () => {
    writeDefaultChatComposerDraft('chat-a', {
      messageInput: 'Before corruption',
      messageInputTranslate: '',
      fileInput: [],
      draftText: '',
      btwText: '',
    })
    const key = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).find(
      (candidate) => candidate?.startsWith('risu:recovery-draft:composer:v1:'),
    )
    expect(key).toBeTruthy()
    sessionStorage.setItem(key!, '{corrupt')

    resetDefaultChatComposerDraftRuntimeForTests()
    expect(readDefaultChatComposerDraft('chat-a')).toBeUndefined()

    expect(() =>
      writeDefaultChatComposerDraft('chat-a', {
        messageInput: 'Typing still works',
        messageInputTranslate: '',
        fileInput: [],
        draftText: '',
        btwText: '',
      }),
    ).not.toThrow()
  })

  it('deletes expired recovery records during reload hydration', () => {
    writeDefaultChatComposerDraft('chat-a', {
      messageInput: 'Expired draft',
      messageInputTranslate: '',
      fileInput: [],
      draftText: '',
      btwText: '',
    })
    const key = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).find(
      (candidate) => candidate?.startsWith('risu:recovery-draft:composer:v1:'),
    )
    const stored = JSON.parse(sessionStorage.getItem(key!)!)
    stored.updatedAt = Date.now() - DEFAULT_CHAT_COMPOSER_DRAFT_MAX_AGE_MS - 1
    sessionStorage.setItem(key!, JSON.stringify(stored))

    resetDefaultChatComposerDraftRuntimeForTests()

    expect(readDefaultChatComposerDraft('chat-a')).toBeUndefined()
    expect(sessionStorage.getItem(key!)).toBeNull()
  })

  it('reports a quota failure once without throwing from the typing path', () => {
    const failure = vi.fn()
    const unregister = registerDefaultChatComposerDraftStorageFailureListener(failure)
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    expect(() =>
      writeDefaultChatComposerDraft('chat-a', {
        messageInput: 'Keep this visible',
        messageInputTranslate: '',
        fileInput: [],
        draftText: '',
        btwText: '',
      }),
    ).not.toThrow()
    writeDefaultChatComposerDraft('chat-a', {
      messageInput: 'Keep typing',
      messageInputTranslate: '',
      fileInput: [],
      draftText: '',
      btwText: '',
    })

    expect(failure).toHaveBeenCalledOnce()
    expect(readDefaultChatComposerDraft('chat-a')?.messageInput).toBe('Keep typing')
    unregister()
  })

  it('keeps synchronous typing persistence to one bounded per-transcript write', () => {
    for (let index = 0; index < 20; index += 1) {
      writeDefaultChatComposerDraft(`other-${index}`, {
        messageInput: `Other ${index}`,
        messageInputTranslate: '',
        fileInput: [],
        draftText: '',
        btwText: '',
      })
    }
    const setItem = vi.spyOn(sessionStorage, 'setItem')
    const startedAt = performance.now()

    writeDefaultChatComposerDraft('active-chat', {
      messageInput: 'x'.repeat(32_000),
      messageInputTranslate: '',
      fileInput: [],
      draftText: '',
      btwText: '',
    })

    expect(performance.now() - startedAt).toBeLessThan(50)
    expect(setItem).toHaveBeenCalledOnce()
    expect(setItem.mock.calls[0]?.[0]).toContain('active-chat')
    expect((setItem.mock.calls[0]?.[1] ?? '').length).toBeLessThan(40_000)
  })
})
