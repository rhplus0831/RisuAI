import fc from 'fast-check'
import { expect, test, vi } from 'vitest'
import { parseChatML } from '../chatML'

vi.mock(import('../parser.svelte'), () => ({
  risuChatParser: (s: string) => s,
}))

const anythingNotToken = fc
  .string({ unit: 'grapheme' })
  .filter((s) => s !== '<|im_start|>' && s !== '<|im_sep|>' && s !== '<|im_end|>')
const anyRole = fc.constantFrom('assistant', 'system', 'user')

test('returns null if input does not start with <|im_start|>', () => {
  fc.assert(
    fc.property(anythingNotToken, (input) => {
      const result = parseChatML(input)
      expect(result).toBeNull()
    }),
  )
})

test('parses ChatML', () => {
  fc.assert(
    fc.property(
      anyRole,
      anyRole,
      anythingNotToken,
      fc.constantFrom('<|im_sep|>', '\n', ' '),
      (role1, role2, content, sep) => {
        const input = `<|im_start|>${role1}${sep}${content}<|im_end|><|im_start|>${role2}${sep}${content}<|im_end|>`
        const result = parseChatML(input)

        expect(result).toHaveLength(2)
        // Known behavior: ending token removal happens after trimming.
        expect(result).toEqual([
          {
            role: role1,
            content: content.trimStart(),
            thoughts: [],
          },
          {
            role: role2,
            content: content.trimStart(),
            thoughts: [],
          },
        ])
      },
    ),
  )
})

// Parser edge case:
/*
<|im_start|>assistant
<|im_start|>assistant
*/
test.skip('parses ChatML without ending token', () => {
  expect(parseChatML('<|im_start|>assistant\n<|im_start|>assistant')).toEqual([
    {
      role: 'assistant',
      content: '',
      thoughts: [],
    },
    {
      role: 'assistant',
      content: '',
      thoughts: [],
    },
  ])

  fc.assert(
    fc.property(
      anyRole,
      anyRole,
      anythingNotToken,
      fc.constantFrom('<|im_sep|>', '\n', ' '),
      (role1, role2, content, sep) => {
        const input = `<|im_start|>${role1}${sep}${content}<|im_start|>${role2}${sep}${content}`
        const result = parseChatML(input)

        expect(result).toHaveLength(2)
        // In this case, since there's no <|im_end|>, trimming removes both ends
        expect(result).toEqual([
          {
            role: role1,
            content: content.trim(),
            thoughts: [],
          },
          {
            role: role2,
            content: content.trim(),
            thoughts: [],
          },
        ])
      },
    ),
    { seed: 1735332051, path: '22:0', endOnFailure: true },
  )
})

test('extracts thoughts', () => {
  // Known behavior: empty thoughts leak the <Thoughts> tag.
  expect(parseChatML('<|im_start|>assistant<|im_sep|><Thoughts></Thoughts> OK')).toEqual([
    {
      role: 'assistant',
      content: '<Thoughts></Thoughts> OK',
      thoughts: [],
    },
  ])

  fc.assert(
    fc.property(
      anythingNotToken.filter((s) => s.length > 0),
      anythingNotToken,
      (thoughts, content) => {
        const input = `<|im_start|>assistant<|im_sep|><Thoughts>${thoughts}</Thoughts>${content}<|im_end|>`
        const result = parseChatML(input)

        expect(result).toHaveLength(1)
        expect(result?.[0]).toEqual({
          role: 'assistant',
          content,
          thoughts: [thoughts],
        })
      },
    ),
    { seed: 409853665, path: '6:0', endOnFailure: true },
  )
})

// Greedy thoughts matcher:
//        => Matches with the whole bulk of <Thoughts>Thought 1</Thoughts> Middle <Thoughts>Thought 2</Thoughts>
test.skip('extracts multiple thoughts', () => {
  const input = `<|im_start|>assistant<|im_sep|>Start <Thoughts>Thought 1</Thoughts> Middle <Thoughts>Thought 2</Thoughts> End<|im_end|>`
  const result = parseChatML(input)

  expect(result).toHaveLength(1)
  expect(result?.[0]).toEqual({
    role: 'assistant',
    content: 'Start  Middle  End',
    thoughts: ['Thought 1', 'Thought 2'],
  })
})

test('defaults to user role if unknown prefix', () => {
  fc.assert(
    fc.property(
      fc.string().filter((s) => s.trim().length > 0 && s !== 'assistant' && s !== 'system' && s !== 'user'),
      fc.string(),
      // No simple whitespace (ambiguous)
      fc.constantFrom('<|im_sep|>', '\n'),
      (prefix, content, sep) => {
        const input = `<|im_start|>${prefix}${sep}${content}<|im_end|>`
        const result = parseChatML(input)

        expect(result).toHaveLength(1)
        expect(result?.[0]).toEqual({
          role: 'user',
          // Known behavior: prefix and separator remain in content.
          content: `${prefix}${sep}${content}`.trimStart(),
          thoughts: [],
        })
      },
    ),
  )
})

test('handles empty segments', () => {
  const input = `<|im_start|><|im_start|><|im_start|>user<|im_sep|><|im_sep|>Content<|im_sep|><|im_end|><|im_end|><|im_end|>`
  const result = parseChatML(input)

  expect(result).toHaveLength(1)
  expect(result).toEqual([
    {
      role: 'user',
      content: '<|im_sep|>Content<|im_sep|><|im_end|><|im_end|>',
      thoughts: [],
    },
  ])
})
