import { describe, expect, it } from 'vitest'
import {
  BILINGUAL_MUTED_CLASS,
  BILINGUAL_PAIR_CLASS,
  BILINGUAL_TRANSLATION_CLASS,
  bilingualInterleave,
} from './bilingualInterleave'

const wrapped = (text: string, classes: readonly string[]) => `<div class="${classes.join(' ')}">\n\n${text}\n\n</div>`
const pair = (...sides: string[]) => wrapped(sides.join('\n\n'), [BILINGUAL_PAIR_CLASS])
const translated = (text: string, muted = false) =>
  wrapped(text, [BILINGUAL_TRANSLATION_CLASS, ...(muted ? [BILINGUAL_MUTED_CLASS] : [])])
const muted = (text: string) => wrapped(text, [BILINGUAL_MUTED_CLASS])

describe('bilingualInterleave', () => {
  it('pairs equal non-empty line counts with original emphasized by default', () => {
    expect(bilingualInterleave('Hello\nBye', '안녕하세요\n안녕히 가세요')).toBe(
      [pair('Hello', translated('안녕하세요', true)), pair('Bye', translated('안녕히 가세요', true))].join('\n'),
    )
  })

  it('uses the same output for the default and explicit original emphasis', () => {
    expect(bilingualInterleave('Original', 'Translation')).toBe(
      bilingualInterleave('Original', 'Translation', { emphasize: 'original' }),
    )
  })

  it('puts emphasized translations first and wraps the original as muted', () => {
    expect(bilingualInterleave('Original', 'Translation', { emphasize: 'translation' })).toBe(
      pair(translated('Translation'), muted('Original')),
    )
  })

  it('appends unmatched original lines when the translation is shorter', () => {
    expect(
      bilingualInterleave(
        "Hello\nI'm Claude\nBye!\nSee you later!",
        '안녕하세요\n저는 클로드입니다. 잘가! 나중에 봐요!',
      ),
    ).toBe(
      [
        pair('Hello', translated('안녕하세요', true)),
        pair("I'm Claude", translated('저는 클로드입니다. 잘가! 나중에 봐요!', true)),
        pair('Bye!'),
        pair('See you later!'),
      ].join('\n'),
    )
  })

  it('puts each unmatched translated line in its own muted pair under original emphasis', () => {
    expect(bilingualInterleave('One', '하나\n둘\n셋')).toBe(
      [pair('One', translated('하나', true)), pair(translated('둘', true)), pair(translated('셋', true))].join('\n'),
    )
  })

  it('keeps unmatched translated lines emphasized under translation emphasis', () => {
    expect(bilingualInterleave('One', '하나\n둘', { emphasize: 'translation' })).toBe(
      [pair(translated('하나'), muted('One')), pair(translated('둘'))].join('\n'),
    )
  })

  it("preserves the original's blank-line paragraph separation", () => {
    expect(bilingualInterleave('First paragraph\n\nSecond paragraph', '첫 문단\n\n둘째 문단')).toBe(
      [
        pair('First paragraph', translated('첫 문단', true)),
        '',
        pair('Second paragraph', translated('둘째 문단', true)),
      ].join('\n'),
    )
  })

  it('treats fenced code blocks as indivisible units on either side', () => {
    const originalFence = '```ts\nconst greeting = "hello"\nconst farewell = "bye"\n```'
    const translatedFence = '```ts\nconst greeting = "안녕"\n```'
    const composite = bilingualInterleave(`Before\n${originalFence}\nAfter`, `이전\n${translatedFence}\n이후`)

    expect(composite).toContain(originalFence)
    expect(composite).toContain(translated(translatedFence, true))
    expect(composite.indexOf(originalFence)).toBeLessThan(composite.indexOf(translated(translatedFence, true)))
    expect(composite.indexOf(translated(translatedFence, true))).toBeLessThan(composite.indexOf('After'))
  })
})
