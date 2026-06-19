import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  requestChatData: vi.fn(),
}))

vi.mock('../request/request', () => ({
  requestChatData: testState.requestChatData,
}))

import { AIAccessClient } from './aiaccess'

const messages = [
  { role: 'system', content: 'You are concise.' },
  { role: 'user', content: 'Say hello.' },
]

function parseTextResponse(result: Awaited<ReturnType<AIAccessClient['callTool']>>): unknown {
  expect(result).toHaveLength(1)
  const content = result[0]
  if (!content || content.type !== 'text') {
    throw new Error(`Expected a single text response, got ${JSON.stringify(result)}`)
  }
  return JSON.parse(content.text)
}

describe('AIAccessClient runLLM routing', () => {
  beforeEach(() => {
    testState.requestChatData.mockReset()
    testState.requestChatData.mockResolvedValue({ type: 'success', result: 'ok' })
  })

  it('routes the normal model through the scriptMain role', async () => {
    const client = new AIAccessClient()

    const result = await client.callTool('runLLM', { model: 'normal', messages })

    expect(testState.requestChatData).toHaveBeenCalledTimes(1)
    expect(testState.requestChatData).toHaveBeenCalledWith({ formated: messages, bias: {} }, 'scriptMain')
    expect(parseTextResponse(result)).toEqual({ success: true, message: 'ok' })
  })

  it('routes the lite model through the scriptAux role', async () => {
    const client = new AIAccessClient()

    await client.callTool('runLLM', { model: 'lite', messages })

    expect(testState.requestChatData).toHaveBeenCalledTimes(1)
    expect(testState.requestChatData).toHaveBeenCalledWith({ formated: messages, bias: {} }, 'scriptAux')
  })

  it('keeps unknown non-lite models on the scriptMain compatibility route', async () => {
    const client = new AIAccessClient()

    await client.callTool('runLLM', { model: 'full-size', messages })

    expect(testState.requestChatData).toHaveBeenCalledTimes(1)
    expect(testState.requestChatData).toHaveBeenCalledWith({ formated: messages, bias: {} }, 'scriptMain')
  })

  it('does not request chat data for invalid runLLM arguments', async () => {
    const client = new AIAccessClient()

    await expect(client.callTool('runLLM', { model: 'normal', messages: 'hello' })).resolves.toEqual([
      {
        type: 'text',
        text: 'Invalid arguments for runLLM. Please provide a valid model and messages.',
      },
    ])
    await client.callTool('runLLM', { messages })
    await client.callTool('runLLM', { model: 'normal' })

    expect(testState.requestChatData).not.toHaveBeenCalled()
  })

  it('preserves the MCP text JSON response shape for failed requests', async () => {
    testState.requestChatData.mockResolvedValue({ type: 'fail', result: 'model unavailable' })
    const client = new AIAccessClient()

    const result = await client.callTool('runLLM', { model: 'normal', messages })

    expect(parseTextResponse(result)).toEqual({ success: false, message: 'model unavailable' })
  })
})
