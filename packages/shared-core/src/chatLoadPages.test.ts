import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHAT_LOAD_ADDITIONAL_PAGES,
  DEFAULT_CHAT_LOAD_INITIAL_PAGES,
  getAdditionalChatLoadPages,
  getInitialChatLoadPages,
  normalizeChatLoadPages,
} from './chatLoadPages.js'

describe('normalizeChatLoadPages', () => {
  it('keeps valid page counts as positive integers', () => {
    expect(normalizeChatLoadPages(42, DEFAULT_CHAT_LOAD_INITIAL_PAGES)).toBe(42)
    expect(normalizeChatLoadPages(7.9, DEFAULT_CHAT_LOAD_INITIAL_PAGES)).toBe(7)
  })

  it('falls back for invalid page counts', () => {
    expect(normalizeChatLoadPages(0, DEFAULT_CHAT_LOAD_INITIAL_PAGES)).toBe(DEFAULT_CHAT_LOAD_INITIAL_PAGES)
    expect(normalizeChatLoadPages(-1, DEFAULT_CHAT_LOAD_INITIAL_PAGES)).toBe(DEFAULT_CHAT_LOAD_INITIAL_PAGES)
    expect(normalizeChatLoadPages(Infinity, DEFAULT_CHAT_LOAD_INITIAL_PAGES)).toBe(DEFAULT_CHAT_LOAD_INITIAL_PAGES)
    expect(normalizeChatLoadPages(Number.NaN, DEFAULT_CHAT_LOAD_INITIAL_PAGES)).toBe(DEFAULT_CHAT_LOAD_INITIAL_PAGES)
    expect(normalizeChatLoadPages('', DEFAULT_CHAT_LOAD_INITIAL_PAGES)).toBe(DEFAULT_CHAT_LOAD_INITIAL_PAGES)
  })

  it('reads defaults from database-like settings inputs', () => {
    expect(getInitialChatLoadPages({})).toBe(DEFAULT_CHAT_LOAD_INITIAL_PAGES)
    expect(getInitialChatLoadPages({ chatLoadInitialPages: 55 })).toBe(55)
    expect(getAdditionalChatLoadPages({})).toBe(DEFAULT_CHAT_LOAD_ADDITIONAL_PAGES)
    expect(getAdditionalChatLoadPages({ chatLoadAdditionalPages: 20 })).toBe(20)
  })
})
