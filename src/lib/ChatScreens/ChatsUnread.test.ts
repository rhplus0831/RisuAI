import { describe, expect, it } from 'vitest'
import { didChatOwnerChange } from './ChatsUnread'

describe('didChatOwnerChange', () => {
  it('clears chat-owned unread state when moving between chat IDs', () => {
    expect(didChatOwnerChange('chat-a', 'chat-b')).toBe(true)
    expect(didChatOwnerChange('chat-a', null)).toBe(true)
  })

  it('preserves unread state during updates to the same chat', () => {
    expect(didChatOwnerChange('chat-a', 'chat-a')).toBe(false)
    expect(didChatOwnerChange(null, null)).toBe(false)
  })
})
