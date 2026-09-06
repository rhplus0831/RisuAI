import { describe, expect, it } from 'vitest'
import { stripInternalReasoning } from './internalReasoning.js'

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
  ] as const)('normalizes %o to the expected value', (text, options, expected) => {
    expect(stripInternalReasoning(text, options)).toBe(expected)
  })
})
