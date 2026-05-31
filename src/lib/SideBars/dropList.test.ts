import { describe, expect, it } from 'vitest'
import { moveDropListItem } from './dropList'

describe('moveDropListItem', () => {
  it('does not corrupt one-item lists', () => {
    const list = ['main']

    expect(moveDropListItem(list, 0, -1)).toBe(list)
    expect(list).toEqual(['main'])
    expect(Object.keys(list)).toEqual(['0'])

    expect(moveDropListItem(list, 0, 1)).toBe(list)
    expect(list).toEqual(['main'])
    expect(Object.keys(list)).toEqual(['0'])
  })

  it('wraps items at list boundaries without mutating the source list', () => {
    const list = ['main', 'description', 'chats']

    expect(moveDropListItem(list, 0, -1)).toEqual(['chats', 'description', 'main'])
    expect(moveDropListItem(list, 2, 1)).toEqual(['chats', 'description', 'main'])
    expect(moveDropListItem(list, 1, -1)).toEqual(['description', 'main', 'chats'])
    expect(moveDropListItem(list, 1, 1)).toEqual(['main', 'chats', 'description'])
    expect(list).toEqual(['main', 'description', 'chats'])
  })
})
