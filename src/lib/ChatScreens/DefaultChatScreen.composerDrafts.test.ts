import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CHAT_COMPOSER_DRAFT_LIMIT,
  clearDefaultChatComposerDrafts,
  readDefaultChatComposerDraft,
  writeDefaultChatComposerDraft,
} from './DefaultChatScreen.composerDrafts'

beforeEach(() => {
  clearDefaultChatComposerDrafts()
})

afterEach(() => {
  clearDefaultChatComposerDrafts()
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
})
