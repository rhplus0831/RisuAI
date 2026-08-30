import { describe, expect, it } from 'vitest'
import { stripInternalReasoning } from './internalReasoning.js'

const INTERNAL_REASONING_TAG_RE_BEFORE_EXTRACTION = /<\s*(\/?)\s*(?:Thoughts|think)\b[^>]*>/giu

function stripInternalReasoningBeforeExtraction(text: string, options: { preserveUnchanged?: boolean } = {}): string {
  let visible = ''
  let visibleFrom = 0
  let hiddenDepth = 0
  let foundOpeningTag = false

  for (const match of text.matchAll(INTERNAL_REASONING_TAG_RE_BEFORE_EXTRACTION)) {
    const index = match.index
    const closing = match[1] === '/'

    if (!closing) {
      foundOpeningTag = true
      if (hiddenDepth === 0) visible += text.slice(visibleFrom, index)
      hiddenDepth += 1
      continue
    }

    if (hiddenDepth === 0) continue
    hiddenDepth -= 1
    if (hiddenDepth === 0) visibleFrom = index + match[0].length
  }

  if (!foundOpeningTag && options.preserveUnchanged) return text
  if (hiddenDepth === 0) visible += text.slice(visibleFrom)
  return visible.trim()
}

describe('internal-reasoning stripping', () => {
  it.each([
    ['', {}, ''],
    ['  visible  ', {}, 'visible'],
    ['  visible  ', { preserveUnchanged: true }, '  visible  '],
    ['before<Thoughts>secret</Thoughts>after', {}, 'beforeafter'],
    ['before<THINK class="private">secret</think>after', {}, 'beforeafter'],
    ['before< Thoughts >secret< think >nested</ think ></ Thoughts >after', {}, 'beforeafter'],
    ['before</Thoughts>after', {}, 'before</Thoughts>after'],
    ['before<Thoughts>unterminated', {}, 'before'],
    ['<Thoughts>hidden</Thoughts>\n\nvisible', {}, 'visible'],
    ['visible\n\n<Thoughts>hidden</Thoughts>', {}, 'visible'],
    ['a<Thoughts>x</Thoughts>b<think>y</think>c', {}, 'abc'],
    ['<thoughtful>visible</thoughtful>', {}, '<thoughtful>visible</thoughtful>'],
    ['<thinker>visible</thinker>', {}, '<thinker>visible</thinker>'],
  ] as const)('preserves the pre-extraction result for %o', (text, options, expected) => {
    expect(stripInternalReasoningBeforeExtraction(text, options)).toBe(expected)
    expect(stripInternalReasoning(text, options)).toBe(expected)
  })
})
