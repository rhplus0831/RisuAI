import { describe, expect, it } from 'vitest'
import { BILINGUAL_TRANSLATION_CLASS, bilingualInterleave } from './bilingualInterleave'

const translated = (text: string) => `<div class="${BILINGUAL_TRANSLATION_CLASS}">\n\n${text}\n\n</div>`

describe('bilingualInterleave', () => {
  it('pairs equal non-empty line counts in original/translation order', () => {
    expect(bilingualInterleave('Hello\nBye', '안녕하세요\n안녕히 가세요')).toBe(
      ['Hello', translated('안녕하세요'), 'Bye', translated('안녕히 가세요')].join('\n'),
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
        'Hello',
        translated('안녕하세요'),
        "I'm Claude",
        translated('저는 클로드입니다. 잘가! 나중에 봐요!'),
        'Bye!',
        'See you later!',
      ].join('\n'),
    )
  })

  it('appends unmatched translated lines when the translation is longer', () => {
    expect(bilingualInterleave('One', '하나\n둘\n셋')).toBe(
      ['One', translated('하나'), translated('둘'), translated('셋')].join('\n'),
    )
  })

  it("preserves the original's blank-line paragraph separation", () => {
    expect(bilingualInterleave('First paragraph\n\nSecond paragraph', '첫 문단\n\n둘째 문단')).toBe(
      ['First paragraph', translated('첫 문단'), '', 'Second paragraph', translated('둘째 문단')].join('\n'),
    )
  })

  it('treats fenced code blocks as indivisible units on either side', () => {
    const originalFence = '```ts\nconst greeting = "hello"\nconst farewell = "bye"\n```'
    const translatedFence = '```ts\nconst greeting = "안녕"\n```'
    const composite = bilingualInterleave(`Before\n${originalFence}\nAfter`, `이전\n${translatedFence}\n이후`)

    expect(composite).toContain(originalFence)
    expect(composite).toContain(translated(translatedFence))
    expect(composite.indexOf(originalFence)).toBeLessThan(composite.indexOf(translated(translatedFence)))
    expect(composite.indexOf(translated(translatedFence))).toBeLessThan(composite.indexOf('After'))
  })
})
