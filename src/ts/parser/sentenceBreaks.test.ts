import { afterEach, describe, expect, it, vi } from 'vitest'
import { bilingualInterleave } from '../translator/bilingualInterleave'
import { insertSentenceParagraphBreaks } from './sentenceBreaks'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('insertSentenceParagraphBreaks', () => {
  it('groups sentences into paragraphs of two or three and leaves short lines unchanged', () => {
    expect(insertSentenceParagraphBreaks('One. Two. Three. Four. Five.', 2, 'en')).toBe(
      'One. Two.\n\nThree. Four.\n\nFive.',
    )
    expect(insertSentenceParagraphBreaks('One. Two. Three. Four. Five. Six. Seven.', 3, 'en')).toBe(
      'One. Two. Three.\n\nFour. Five. Six.\n\nSeven.',
    )
    expect(insertSentenceParagraphBreaks('One. Two. Three.', 3, 'en')).toBe('One. Two. Three.')
  })

  it('handles decimals, ellipses, question marks, and exclamation marks as sentence content and terminators', () => {
    expect(insertSentenceParagraphBreaks('Value is 3.14. Wait... Really? Yes! Done.', 2, 'en')).toBe(
      'Value is 3.14. Wait...\n\nReally? Yes!\n\nDone.',
    )
  })

  it('segments CJK and Korean sentences', () => {
    expect(insertSentenceParagraphBreaks('第一句。第二句。第三句。第四句。', 2, 'zh')).toBe(
      '第一句。第二句。\n\n第三句。第四句。',
    )
    expect(insertSentenceParagraphBreaks('첫째 문장이다. 둘째 문장이다. 셋째 문장이다.', 2, 'ko')).toBe(
      '첫째 문장이다. 둘째 문장이다.\n\n셋째 문장이다.',
    )
  })

  it('passes fenced code and its contents through untouched across multiple lines', () => {
    const input = [
      'Before one. Before two. Before three.',
      '```ts',
      'const prose = "Code one. Code two. Code three."',
      'Still code. Still code. Still code.',
      '```',
      'After one. After two. After three.',
    ].join('\n')

    expect(insertSentenceParagraphBreaks(input, 2, 'en')).toBe(
      [
        'Before one. Before two.',
        '',
        'Before three.',
        '```ts',
        'const prose = "Code one. Code two. Code three."',
        'Still code. Still code. Still code.',
        '```',
        'After one. After two.',
        '',
        'After three.',
      ].join('\n'),
    )
  })

  it('passes HTML and Markdown structural lines through untouched', () => {
    const protectedLines = [
      '<div>One. Two. Three.</div>',
      '  </div>',
      '# One. Two. Three.',
      '- One. Two. Three.',
      '* One. Two. Three.',
      '+ One. Two. Three.',
      '1. One. Two. Three.',
      '> One. Two. Three.',
      '| One. | Two. | Three. |',
      '---',
      '   ',
    ].join('\n')

    expect(insertSentenceParagraphBreaks(protectedLines, 1, 'en')).toBe(protectedLines)
  })

  it('segments both sides of a bilingual composite independently without changing wrapper lines', () => {
    const original = 'Original one. Original two. Original three.'
    const translation = '번역 하나. 번역 둘. 번역 셋.'
    const composite = bilingualInterleave(original, translation)
    const output = insertSentenceParagraphBreaks(composite, 2)

    expect(output).toBe(
      composite
        .replace(original, 'Original one. Original two.\n\nOriginal three.')
        .replace(translation, '번역 하나. 번역 둘.\n\n번역 셋.'),
    )
    expect(output.match(/^<\/?div.*>$/gm)).toEqual(composite.match(/^<\/?div.*>$/gm))
  })

  it('masks inline code, URLs, HTML tags, and CBS syntax before segmentation', () => {
    const input =
      'Use `alpha. beta? gamma!` with https://example.com/docs?v=1.2, <span title="Fake. Sentence?">inline</span>, and {{getvar::Fake. Sentence!}} safely. Second sentence. Third sentence.'

    expect(insertSentenceParagraphBreaks(input, 2, 'en')).toBe(
      'Use `alpha. beta? gamma!` with https://example.com/docs?v=1.2, <span title="Fake. Sentence?">inline</span>, and {{getvar::Fake. Sentence!}} safely. Second sentence.\n\nThird sentence.',
    )
  })

  it('restores protected spans containing replacement-pattern dollar sequences literally', () => {
    const input = 'Use `$& and $1 and $\'` here. Second sentence. Third sentence.'

    expect(insertSentenceParagraphBreaks(input, 2, 'en')).toBe(
      "Use `$& and $1 and $'` here. Second sentence.\n\nThird sentence.",
    )
  })

  it('defers a boundary until straight or curly quotations close', () => {
    expect(
      insertSentenceParagraphBreaks(
        'First sentence. “Quoted second sentence. Quoted third sentence.” Fourth sentence. Fifth sentence.',
        2,
        'en',
      ),
    ).toBe('First sentence. “Quoted second sentence. Quoted third sentence.”\n\nFourth sentence. Fifth sentence.')
    expect(
      insertSentenceParagraphBreaks(
        'First sentence. "Quoted second sentence. Quoted third sentence." Fourth sentence. Fifth sentence.',
        2,
        'en',
      ),
    ).toBe('First sentence. "Quoted second sentence. Quoted third sentence."\n\nFourth sentence. Fifth sentence.')
  })

  it('returns the input unchanged when Intl.Segmenter is unavailable', () => {
    const input = 'One. Two. Three.'
    vi.stubGlobal('Intl', { Segmenter: undefined })

    expect(insertSentenceParagraphBreaks(input, 2, 'en')).toBe(input)
  })

  it('rejects invalid counts and clamps valid counts to integers from one through ten', () => {
    const input = 'One. Two. Three. Four.'
    for (const count of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(insertSentenceParagraphBreaks(input, count, 'en')).toBe(input)
    }

    expect(insertSentenceParagraphBreaks(input, 2.9, 'en')).toBe('One. Two.\n\nThree. Four.')
    expect(
      insertSentenceParagraphBreaks('One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten. Eleven.', 12, 'en'),
    ).toBe('One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.\n\nEleven.')
  })

  it('keeps sentence counters independent per line and preserves existing blank lines', () => {
    const input =
      'Line one first. Line one second.\nLine two first. Line two second.\n\nFinal one. Final two. Final three.'

    expect(insertSentenceParagraphBreaks(input, 2, 'en')).toBe(
      'Line one first. Line one second.\nLine two first. Line two second.\n\nFinal one. Final two.\n\nFinal three.',
    )
  })

  it('keeps initial indentation while trimming whitespace around inserted paragraph breaks', () => {
    expect(insertSentenceParagraphBreaks('  One. Two.   Three. Four.  ', 2, 'en')).toBe('  One. Two.\n\nThree. Four.')
  })
})
