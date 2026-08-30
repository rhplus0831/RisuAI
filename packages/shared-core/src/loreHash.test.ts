import { describe, expect, it } from 'vitest'
import { pickHashRand, sfc32 } from './loreHash.js'

function sfc32BeforeExtraction(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0
    b |= 0
    c |= 0
    d |= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

function pickHashRandBeforeExtraction(cid: number, word: string): number {
  let hashAddress = 5515
  const rand = (value: string): number => {
    for (let index = 0; index < value.length; index += 1) {
      hashAddress = (hashAddress << 5) + hashAddress + value.charCodeAt(index)
    }
    return hashAddress
  }
  const random = sfc32BeforeExtraction(rand(word), rand(word), rand(word), rand(word))
  const advances = cid % 1000
  for (let index = 0; index < advances; index += 1) random()
  return random()
}

describe('lore hash randomization', () => {
  it.each([
    { seeds: [0, 0, 0, 0] },
    { seeds: [0, 1, -1, 4294967297] },
    { seeds: [Number.NaN, Number.POSITIVE_INFINITY, 3.5, -4.5] },
    { seeds: [2147483647, 2147483648, -2147483649, 0xffffffff] },
  ])('preserves stateful sfc32 output for $seeds', ({ seeds }) => {
    const actual = sfc32(seeds[0], seeds[1], seeds[2], seeds[3])
    const oracle = sfc32BeforeExtraction(seeds[0], seeds[1], seeds[2], seeds[3])

    expect(Array.from({ length: 20 }, () => actual())).toEqual(Array.from({ length: 20 }, () => oracle()))
  })

  it('pins a signed-overflow sfc32 sequence', () => {
    const random = sfc32(0, 1, -1, 4294967297)
    expect(Array.from({ length: 5 }, () => random())).toEqual([
      4.656612873077393e-10, 0.9999999986030161, 0.9980468796566129, 0.00439452170394361, 0.9604428347665817,
    ])
  })

  it.each([
    { cid: -1000, word: '', expected: 0.000003852182999253273 },
    { cid: 0, word: '', expected: 0.000003852182999253273 },
    { cid: 999, word: 'ascii', expected: 0.6407577134668827 },
    { cid: 1000, word: '한글🙂', expected: 0.015324681531637907 },
    { cid: 1001, word: 'x'.repeat(4096), expected: 0.5155586861073971 },
    { cid: 2147483647, word: 'overflow', expected: 0.9226429469417781 },
    { cid: 2.9, word: 'fractional', expected: 0.5053094227332622 },
  ])('preserves deterministic pickHashRand vector $cid / $word', ({ cid, word, expected }) => {
    expect(pickHashRand(cid, word)).toBe(pickHashRandBeforeExtraction(cid, word))
    expect(pickHashRand(cid, word)).toBe(expected)
    expect(pickHashRand(cid, word)).toBe(expected)
  })
})
