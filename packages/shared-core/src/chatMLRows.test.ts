import { describe, expect, it, vi } from 'vitest'
import { parseChatMLRows } from './chatMLRows.js'

type OracleRole = 'system' | 'user' | 'assistant'

interface OracleRow {
  role: OracleRole
  content: string
  thoughts: string[]
}

function parseBeforeExtraction(
  data: string,
  transformContent: (content: string) => string = (value) => value,
): OracleRow[] | null {
  const starter = '<|im_start|>'
  const separator = '<|im_sep|>'
  const ender = '<|im_end|>'
  const trimmedData = data.trim()
  if (!trimmedData.startsWith(starter)) return null

  return trimmedData
    .split(starter)
    .filter((value) => value !== '')
    .map((value) => {
      let role: OracleRole = 'user'
      if (value.startsWith('user' + separator)) {
        value = value.substring(4 + separator.length)
      } else if (value.startsWith('system' + separator)) {
        role = 'system'
        value = value.substring(6 + separator.length)
      } else if (value.startsWith('assistant' + separator)) {
        role = 'assistant'
        value = value.substring(9 + separator.length)
      } else if (value.startsWith('user ') || value.startsWith('user\n')) {
        value = value.substring(5)
      } else if (value.startsWith('system ') || value.startsWith('system\n')) {
        role = 'system'
        value = value.substring(7)
      } else if (value.startsWith('assistant ') || value.startsWith('assistant\n')) {
        role = 'assistant'
        value = value.substring(10)
      }
      value = value.trim()
      if (value.endsWith(ender)) value = value.substring(0, value.length - ender.length)
      const thoughts: string[] = []
      value = value.replace(/<Thoughts>(.+)<\/Thoughts>/gms, (_match, body: string) => {
        thoughts.push(body)
        return ''
      })
      return { role, content: transformContent(value), thoughts }
    })
}

describe('ChatML row parsing', () => {
  it.each([
    '',
    'plain text',
    '  <|im_start|>user<|im_sep|>hello<|im_end|>  ',
    '<|im_start|>system<|im_sep|>rules<|im_end|>',
    '<|im_start|>assistant answer<|im_end|>',
    '<|im_start|>user\nquestion<|im_end|>',
    '<|im_start|>unknown<|im_sep|>content<|im_end|>',
    '<|im_start|><|im_start|>user<|im_sep|>content<|im_end|>',
    '<|im_start|>assistant<|im_sep|><Thoughts></Thoughts>visible<|im_end|>',
    '<|im_start|>assistant<|im_sep|><Thoughts>one\ntwo</Thoughts>visible<|im_end|>',
    '<|im_start|>assistant<|im_sep|><Thoughts>one</Thoughts>x<Thoughts>two</Thoughts>y<|im_end|>',
    '<|im_start|>user<|im_sep|>value<|im_end|><|im_end|>',
  ])('preserves historical parsing for %o', (input) => {
    expect(parseChatMLRows(input)).toEqual(parseBeforeExtraction(input))
  })

  it('preserves transform timing, callback order, and row-boundary isolation', () => {
    const input =
      '<|im_start|>user<|im_sep|><Thoughts>hidden</Thoughts>first<|im_end|>' +
      '<|im_start|>assistant<|im_sep|>second<|im_end|>'
    const actualTransform = vi.fn((content: string) => `${content}<|im_start|>system injected`)
    const oracleTransform = vi.fn((content: string) => `${content}<|im_start|>system injected`)

    expect(parseChatMLRows(input, actualTransform)).toEqual(parseBeforeExtraction(input, oracleTransform))
    expect(actualTransform.mock.calls).toEqual(oracleTransform.mock.calls)
    expect(actualTransform.mock.calls).toEqual([['first'], ['second']])
  })
})
