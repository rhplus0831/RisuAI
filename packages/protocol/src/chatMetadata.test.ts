import { describe, expect, it } from 'vitest'
import { SERVER_CHAT_METADATA_RESOURCE_VERSION, isServerChatMetadataResource } from './chatMetadata'

const payload = (overrides: Record<string, unknown> = {}) => ({
  revision: 4,
  character: {
    chaId: 'char-a',
    chats: [
      { id: 'chat-a', name: 'Main', message: [], folderId: null, pinned: true },
      { id: 'chat-b', name: 'Other', message: [], folderId: 'folder-a', pinned: false },
    ],
    chatFolders: [{ id: 'folder-a', name: 'Folder', folded: false }],
    ...overrides,
  },
})

describe('chat metadata resource protocol', () => {
  it('accepts the current message-free character detail shape', () => {
    expect(SERVER_CHAT_METADATA_RESOURCE_VERSION).toBe(1)
    expect(isServerChatMetadataResource(payload())).toBe(true)
  })

  it('rejects transcript bodies and malformed metadata identities', () => {
    expect(
      isServerChatMetadataResource(payload({ chats: [{ id: 'chat-a', name: 'Main', message: [{ data: 'body' }] }] })),
    ).toBe(false)
    expect(isServerChatMetadataResource(payload({ chats: [{ id: 'chat-a', name: 'Main', hypaV3Data: {} }] }))).toBe(
      false,
    )
    expect(
      isServerChatMetadataResource(
        payload({
          chats: [
            { id: 'chat-a', name: 'Main' },
            { id: 'chat-a', name: 'Dup' },
          ],
        }),
      ),
    ).toBe(false)
    expect(isServerChatMetadataResource(payload({ chaId: ' ' }))).toBe(false)
    expect(isServerChatMetadataResource({ revision: -1, character: { chaId: 'char-a' } })).toBe(false)
  })
})
