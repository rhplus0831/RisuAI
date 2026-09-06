import { describe, expect, it } from 'vitest'
import { createInternalReasoningStream, stripInternalReasoning } from './internalReasoning.js'

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

describe('incremental internal-reasoning stripping', () => {
  it.each([
    '',
    '  visible\n ',
    ' \n ',
    '<Thoughts>hidden</Thoughts>\n\nvisible  ',
    'before<THINK class="private">secret</think>after',
    'before< Thoughts >secret< think >nested</ think ></ Thoughts >after',
    'before<THOUGHTſ>hidden</THINK>after',
    'before</Thoughts>after',
    'before<Thoughts>unterminated',
    'visible\n\n<Thoughts>hidden</Thoughts>',
    'a<Thoughts>x</Thoughts>b<think>y</think>c',
    '<thoughtful>visible</thoughtful> <thinker>visible</thinker>',
    '<think_foo>visible</think_foo>',
    '<think-x>hidden</think>visible',
    '2 < 3; <div <think>hidden</think>visible',
    'visible <',
    'visible <Tho',
    'visible <think attribute="incomplete"',
    '<think>hidden <Tho',
    '<<think>hidden</think>visible',
  ])('matches whole-string stripping across every split of %o', (text) => {
    const expected = stripInternalReasoning(text, { preserveUnchanged: true })
    for (let split = 0; split <= text.length; split++) {
      const filter = createInternalReasoningStream()
      expect(filter.push(text.slice(0, split)) + filter.push(text.slice(split)) + filter.finish()).toBe(expected)
    }
    const filter = createInternalReasoningStream()
    expect([...text].map((char) => filter.push(char)).join('') + filter.finish()).toBe(expected)
  })

  it('releases safe visible text while later tokens are still pending', () => {
    const filter = createInternalReasoningStream()
    expect(filter.push('<Tho')).toBe('')
    expect(filter.push('ughts>private')).toBe('')
    expect(filter.push('</Thoughts>\nHello ')).toBe('Hello')
    expect(filter.push('world<think>more')).toBe(' world')
    expect(filter.push(' private</think>!\n')).toBe('!')
    expect(filter.finish()).toBe('')
  })

  it('preserves an already-emitted prefix when reasoning appears later, independently of chunking', () => {
    const text = '  prefix <think>hidden</think> tail  '
    for (let split = 0; split <= text.length; split++) {
      const filter = createInternalReasoningStream()
      expect(filter.push(text.slice(0, split)) + filter.push(text.slice(split)) + filter.finish()).toBe(
        '  prefix  tail',
      )
    }
  })
})
