import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InputHook } from '../storage/database.svelte'

const testState = vi.hoisted(() => ({
  parseChatML: vi.fn(),
  requestChatData: vi.fn(),
}))

vi.mock('../parser/chatML', () => ({
  parseChatML: testState.parseChatML,
}))

vi.mock('./request/request', () => ({
  requestChatData: testState.requestChatData,
}))

import { runInputHook } from './inputHooks'

function hook(prompt: string): InputHook {
  return {
    id: 'hook-a',
    name: 'Hook A',
    type: 'draft',
    prompt,
  }
}

function requestMessages(): OpenAIChat[] {
  return testState.requestChatData.mock.calls[0][0].formated
}

describe('runInputHook', () => {
  beforeEach(() => {
    testState.parseChatML.mockReset()
    testState.parseChatML.mockReturnValue(null)
    testState.requestChatData.mockReset()
    testState.requestChatData.mockResolvedValue({ type: 'success', result: '  hook result  ' })
  })

  it('substitutes both literal slots and uses the single-user fallback', async () => {
    const signal = new AbortController().signal

    await expect(
      runInputHook(
        hook('Content={{slot::content}}; Draft={{slot::draft}}'),
        { content: 'hello', draft: 'draft' },
        signal,
      ),
    ).resolves.toBe('hook result')

    expect(testState.parseChatML).toHaveBeenCalledWith('Content=hello; Draft=draft')
    expect(requestMessages()).toEqual([{ role: 'user', content: 'Content=hello; Draft=draft' }])
    expect(testState.requestChatData).toHaveBeenCalledWith(
      {
        formated: [{ role: 'user', content: 'Content=hello; Draft=draft' }],
        bias: {},
        useStreaming: false,
        noMultiGen: true,
      },
      'otherAx',
      signal,
    )
  })

  it('uses parsed ChatML messages after slot substitution', async () => {
    const parsed: OpenAIChat[] = [
      { role: 'system', content: 'System hello' },
      { role: 'user', content: 'Draft draft text' },
    ]
    testState.parseChatML.mockReturnValueOnce(parsed)

    await runInputHook(
      hook('<|im_start|>system {{slot::content}}<|im_end|><|im_start|>user {{slot::draft}}<|im_end|>'),
      { content: 'hello', draft: 'draft text' },
    )

    expect(testState.parseChatML).toHaveBeenCalledWith(
      '<|im_start|>system hello<|im_end|><|im_start|>user draft text<|im_end|>',
    )
    expect(requestMessages()).toBe(parsed)
  })

  it('falls back to system prompt plus content when no slot marker exists', async () => {
    await runInputHook(hook('Rewrite the content.'), { content: 'composer text', draft: 'ignored draft' })

    expect(requestMessages()).toEqual([
      { role: 'system', content: 'Rewrite the content.' },
      { role: 'user', content: 'composer text' },
    ])
  })

  it('does not recognize the legacy misspelled content marker', async () => {
    await runInputHook(hook('Legacy {{solt::content}}'), { content: 'composer text', draft: '' })

    expect(requestMessages()).toEqual([
      { role: 'system', content: 'Legacy {{solt::content}}' },
      { role: 'user', content: 'composer text' },
    ])
  })

  it('treats a draft-only marker as a slot fallback', async () => {
    await runInputHook(hook('Review this draft: {{slot::draft}}'), { content: 'composer text', draft: 'draft text' })

    expect(requestMessages()).toEqual([{ role: 'user', content: 'Review this draft: draft text' }])
  })

  it('substitutes an empty draft without leaving the marker behind', async () => {
    await runInputHook(hook('{{slot::content}}\n---\n{{slot::draft}}'), { content: 'composer text', draft: '' })

    expect(testState.parseChatML).toHaveBeenCalledWith('composer text\n---\n')
    expect(requestMessages()).toEqual([{ role: 'user', content: 'composer text\n---\n' }])
  })
})
