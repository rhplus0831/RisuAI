import { describe, expect, it } from 'vitest'
import { mutateAlternateGreetings } from './alternateGreetingMutation'

describe('mutateAlternateGreetings', () => {
  it('deletes one greeting and repairs every child chat index', () => {
    expect(
      mutateAlternateGreetings(
        ['zero', 'one', 'two'],
        [
          { id: 'primary', fmIndex: -1 },
          { id: 'before', fmIndex: 0 },
          { id: 'deleted', fmIndex: 1 },
          { id: 'after', fmIndex: 2 },
          { id: 'fractional', fmIndex: 1.5 },
          { id: 'out-of-range', fmIndex: 9 },
        ],
        { type: 'delete', index: 1 },
      ),
    ).toEqual({
      alternateGreetings: ['zero', 'two'],
      chatGreetingIndices: [
        { chatId: 'primary', fmIndex: -1 },
        { chatId: 'before', fmIndex: 0 },
        { chatId: 'deleted', fmIndex: -1 },
        { chatId: 'after', fmIndex: 1 },
        { chatId: 'fractional', fmIndex: -1 },
        { chatId: 'out-of-range', fmIndex: -1 },
      ],
    })
  })

  it('swaps chat references together with adjacent greetings', () => {
    expect(
      mutateAlternateGreetings(
        ['zero', 'one', 'two'],
        [
          { id: 'one', fmIndex: 1 },
          { id: 'two', fmIndex: 2 },
        ],
        { type: 'swap', firstIndex: 1, secondIndex: 2 },
      ),
    ).toEqual({
      alternateGreetings: ['zero', 'two', 'one'],
      chatGreetingIndices: [
        { chatId: 'one', fmIndex: 2 },
        { chatId: 'two', fmIndex: 1 },
      ],
    })
  })
})
