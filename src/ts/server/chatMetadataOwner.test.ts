import { describe, expect, it } from 'vitest'
import { preferChatMetadataOwner, projectChatMetadata, type ChatMetadataRecord } from './chatMetadataOwner'

describe('chat metadata owner projection', () => {
  it('prefers owner metadata over divergent aggregate metadata without exposing chat body fields', () => {
    const aggregate = projectChatMetadata('chat-a', {
      lastMemory: 'aggregate-memory',
      autoTranslate: false,
      message: [{ data: 'stale transcript' }],
    } as ChatMetadataRecord)
    const owner = projectChatMetadata('chat-a', {
      lastMemory: 'owner-memory',
      autoTranslate: true,
      message: [{ data: 'fresh transcript' }],
    } as ChatMetadataRecord)

    expect(preferChatMetadataOwner(owner, aggregate)).toEqual({
      chatId: 'chat-a',
      lastMemory: 'owner-memory',
      autoTranslate: true,
    })
    expect(preferChatMetadataOwner(owner, aggregate)).not.toHaveProperty('message')
  })

  it('keeps the named legacy fallback available when owner metadata is absent', () => {
    const fallback = projectChatMetadata('chat-a', { lastMemory: 'legacy-memory', autoTranslate: true })

    expect(preferChatMetadataOwner(undefined, fallback)).toEqual(fallback)
  })
})
