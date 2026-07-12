import { writable } from 'svelte/store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { language } from '../../../lang'
import { parseThoughtsAndTools, risuChatParser } from '../parser.svelte'

vi.mock(
  import('../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getDatabase: () => ({}),
    }) as typeof import('../../storage/database.svelte'),
)

vi.mock(import('../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
}))

vi.mock(import('../../stores.svelte'), () => {
  return {
    selIdState: {
      selId: 0,
    },
    selectedCharID: writable(0),
  } as typeof import('../../stores.svelte')
})

const thoughtsDetails = (content: string) => `<details><summary>${language.cot}</summary>${content}</details>`

const toolCallHtml = (payload: string) =>
  `<div class="x-risu-tool-call">\ud83d\udee0\ufe0f ${language.toolCalled.replace(
    '{{tool}}',
    payload.split('\uf100')?.[1] ?? 'unknown',
  )}</div>\n\n`

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseThoughtsAndTools render fast paths (L39)', () => {
  it('L39: marker-free thoughts/tools parsing returns unchanged without slicing', () => {
    const input = 'plain markdown with a stray </Thoughts> close marker only'
    const sliceSpy = vi.spyOn(String.prototype, 'slice')

    const output = parseThoughtsAndTools(input)
    const sliceCalls = sliceSpy.mock.calls.length
    sliceSpy.mockRestore()

    expect(output).toBe(input)
    expect(sliceCalls).toBe(0)
  })

  it('renders a single thoughts block', () => {
    expect(parseThoughtsAndTools('before <Thoughts>secret</Thoughts> after')).toBe(
      `before ${thoughtsDetails('secret')} after`,
    )
  })

  it('preserves nested thoughts while matching the outer block', () => {
    const input = 'A <Thoughts>outer <Thoughts>inner</Thoughts> tail</Thoughts> Z'

    expect(parseThoughtsAndTools(input)).toBe(`A ${thoughtsDetails('outer <Thoughts>inner</Thoughts> tail')} Z`)
  })

  it('preserves malformed unclosed thoughts and still converts later nested thoughts', () => {
    expect(parseThoughtsAndTools('<Thoughts>open ended')).toBe('<Thoughts>open ended')
    expect(parseThoughtsAndTools('<Thoughts>outer <Thoughts>inner</Thoughts> tail')).toBe(
      `<Thoughts>outer ${thoughtsDetails('inner')} tail`,
    )
  })

  it('replaces tool calls and preserves the unknown-tool fallback', () => {
    const knownPayload = 'request\uf100weather'

    expect(parseThoughtsAndTools(`<tool_call>${knownPayload}</tool_call>`)).toBe(toolCallHtml(knownPayload))
    expect(parseThoughtsAndTools('<tool_call>opaque</tool_call>')).toBe(toolCallHtml('opaque'))
  })

  it('replaces tool calls inside and outside thoughts after thoughts conversion', () => {
    const innerPayload = 'request\uf100lookup'
    const outerPayload = 'request\uf100done'

    expect(
      parseThoughtsAndTools(
        `A <Thoughts>plan <tool_call>${innerPayload}</tool_call></Thoughts> B <tool_call>${outerPayload}</tool_call>`,
      ),
    ).toBe(`A ${thoughtsDetails(`plan ${toolCallHtml(innerPayload)}`)} B ${toolCallHtml(outerPayload)}`)
  })
})

describe('risuChatParser function render path logging (L38)', () => {
  it('L38: function definition and call parsing writes nothing to console.log', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const output = risuChatParser('before {{#function greet}}Hello {{arg::1}}{{/}}{{call::greet::Ada}} after')
    const logCalls = logSpy.mock.calls.length
    logSpy.mockRestore()

    expect(output).toBe('before Hello Ada after')
    expect(logCalls).toBe(0)
  })
})
