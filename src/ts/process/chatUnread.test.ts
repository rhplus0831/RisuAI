import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearVisibleChat,
  isChatVisible,
  markChatRead,
  markChatUnread,
  resetChatUnreadForTests,
  setVisibleChat,
  unreadChatIds,
} from './chatUnread.svelte'

describe('chat unread state', () => {
  beforeEach(() => {
    resetChatUnreadForTests()
  })

  it('tracks unread chats independently by stable chat ID', () => {
    markChatUnread('chat-a')
    markChatUnread('chat-b')
    markChatUnread('chat-a')

    expect([...get(unreadChatIds)]).toEqual(['chat-a', 'chat-b'])

    markChatRead('chat-a')
    expect([...get(unreadChatIds)]).toEqual(['chat-b'])
  })

  it('ignores missing identities and read acknowledgements for other chats', () => {
    markChatUnread(undefined)
    markChatUnread('chat-a')
    markChatRead('chat-b')

    expect([...get(unreadChatIds)]).toEqual(['chat-a'])
  })

  it('bounds stale session entries', () => {
    for (let index = 0; index < 300; index += 1) markChatUnread(`chat-${index}`)

    const unread = [...get(unreadChatIds)]
    expect(unread).toHaveLength(256)
    expect(unread.at(0)).toBe('chat-44')
    expect(unread.at(-1)).toBe('chat-299')
  })

  it('tracks the mounted transcript without letting a stale owner clear a newer one', () => {
    setVisibleChat('chat-a')
    expect(isChatVisible('chat-a')).toBe(true)

    setVisibleChat('chat-b')
    clearVisibleChat('chat-a')
    expect(isChatVisible('chat-b')).toBe(true)

    clearVisibleChat('chat-b')
    expect(isChatVisible('chat-b')).toBe(false)
  })
})
