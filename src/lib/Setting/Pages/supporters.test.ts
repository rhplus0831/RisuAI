import { describe, expect, it } from 'vitest'

import { bucketSupporters } from './supporters'

describe('bucketSupporters', () => {
  it('groups supporters in a single categorized result', () => {
    expect(
      bucketSupporters([
        { amount: 1, name: 'one' },
        { amount: 5, name: 'five' },
        { amount: 10, name: 'ten' },
        { amount: 20, name: 'twenty' },
        { amount: 50, name: 'fifty' },
        { amount: 100, name: '' },
      ]),
    ).toEqual({
      I: ['one'],
      II: ['five'],
      III: ['ten'],
      IV: ['twenty'],
      V: ['fifty'],
    })
  })
})
