import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../storage/nodeStorage', () => ({
  getNodeServerProxyAuth: async () => 'test-auth-token',
}))

import { requestServerChat, requestServerChatGeneration, type ServerChatInput } from '../serverChat'
import type { ServerChatMessagePatch } from '../serverChatEvents'
import {
  getServerChatCalls,
  resetServerChatState,
  serverChatFetch,
  setServerChatDispatchError,
  setServerChatDispatchResult,
  setServerChatError,
  setServerChatMessagePatch,
  setServerChatPrompt,
} from '../../__fixtures__/mocks/serverChatFetch'

const baseInput: ServerChatInput = {
  chatId: 'chat-1',
  characterId: 'char-1',
  mode: 'send',
  userMessage: 'hi',
}

beforeEach(() => {
  resetServerChatState()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestServerChat', () => {
  it('parses the prompt + info events from a successful stream', async () => {
    setServerChatPrompt([{ role: 'user', content: 'hello there' }], { promptText: 'hello there' })
    vi.stubGlobal('fetch', serverChatFetch)

    const res = await requestServerChat(baseInput, null)
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.prompt.messages).toEqual([{ role: 'user', content: 'hello there' }])
    expect(res.prompt.promptInfo).toEqual({ promptText: 'hello there' })
    expect(res.info?.tokens).toEqual({ prompt: 7, total: 7 })
    expect(res.info?.responseBudget).toBe(50)
    expect(res.messagePatches).toEqual([])
  })

  it('surfaces the full formated rows + biases from the prompt event (7-12b)', async () => {
    setServerChatPrompt(
      [{ role: 'user', content: 'hi' }],
      { promptText: 'hi' },
      {
        formated: [{ role: 'user', content: 'hi', name: 'Tess' }],
        biases: [['hello', -100]],
      },
    )
    vi.stubGlobal('fetch', serverChatFetch)

    const res = await requestServerChat(baseInput, null)
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.prompt.formated).toEqual([{ role: 'user', content: 'hi', name: 'Tess' }])
    expect(res.prompt.biases).toEqual([['hello', -100]])
  })

  it('collects message_patch events from the stream', async () => {
    const patch: ServerChatMessagePatch = {
      chatId: 'chat-1',
      characterId: 'char-1',
      selectedCharID: 0,
      chatPage: 0,
      varChanged: true,
      messageMutations: [
        {
          type: 'replace_all',
          source: 'run_var',
          beforeLength: 1,
          afterLength: 1,
          messages: [{ role: 'user', data: 'hello' }],
        },
      ],
      chatVarMutations: [{ key: '$mood', before: null, after: 'bright' }],
      additionalSystemPrompt: [],
    }
    setServerChatMessagePatch(patch)
    vi.stubGlobal('fetch', serverChatFetch)

    const res = await requestServerChat(baseInput, null)
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.messagePatches).toEqual([patch])
  })

  it('sends the intent body and the risu-auth header', async () => {
    vi.stubGlobal('fetch', serverChatFetch)
    await requestServerChat(baseInput, null)

    const calls = getServerChatCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'POST',
      authHeader: 'test-auth-token',
      chatId: 'chat-1',
      characterId: 'char-1',
      mode: 'send',
    })
  })

  it('surfaces a terminal error event as a status:error result', async () => {
    setServerChatError('character not found')
    vi.stubGlobal('fetch', serverChatFetch)

    const res = await requestServerChat(baseInput, null)
    expect(res).toEqual({ status: 'error', error: 'character not found' })
  })

  it('maps a pre-stream 400 JSON body to status:error', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: 'chatId is required' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    )

    const res = await requestServerChat({ ...baseInput, chatId: '' }, null)
    expect(res).toEqual({ status: 'error', error: 'chatId is required' })
  })

  it('returns status:aborted when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      // a real fetch rejects on an already-aborted signal
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return new Response(null, { status: 200 })
    })

    const res = await requestServerChat(baseInput, controller.signal)
    expect(res).toEqual({ status: 'aborted' })
  })

  it('reports a stream that ends without a prompt event', async () => {
    vi.stubGlobal('fetch', async () => {
      const enc = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            enc.encode('event: stage\ndata: {"stage":"prompt","status":"start"}\n\n'),
          )
          controller.enqueue(enc.encode('event: done\ndata: {}\n\n'))
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    })

    const res = await requestServerChat(baseInput, null)
    expect(res).toEqual({ status: 'error', error: 'stream ended without a prompt event' })
  })

  it('ignores unknown / dispatch-coupled events (token, side_effect)', async () => {
    vi.stubGlobal('fetch', async () => {
      const enc = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode('event: token\ndata: {"content":"x"}\n\n'))
          controller.enqueue(
            enc.encode('event: side_effect\ndata: {"kind":"tts","payload":{}}\n\n'),
          )
          controller.enqueue(
            enc.encode('event: prompt\ndata: {"messages":[{"role":"user","content":"hi"}]}\n\n'),
          )
          controller.enqueue(enc.encode('event: done\ndata: {}\n\n'))
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    })

    const res = await requestServerChat(baseInput, null)
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.prompt.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('returns a streaming dispatch response from token + enriched done events', async () => {
    setServerChatPrompt([{ role: 'user', content: 'hello there' }], { promptText: 'hello there' })
    setServerChatDispatchResult('server reply', {
      model: 'echo_model',
      inputTokens: 7,
      outputTokens: 50,
      maxContext: 4000,
      stageTiming: { stage1: 1, stage2: 0, stage3: 2, stage4: 0 },
    })
    vi.stubGlobal('fetch', serverChatFetch)

    const res = await requestServerChatGeneration(baseInput, null)
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.generationId).toBe('uuid-0')
    expect(res.generationInfo).toMatchObject({
      model: 'echo_model',
      generationId: 'uuid-0',
      inputTokens: 7,
      outputTokens: 50,
    })
    expect(res.req.type).toBe('streaming')
    if (res.req.type !== 'streaming') return
    const reader = res.req.result.getReader()
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { 'uuid-0': 'server reply' },
    })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    await expect(res.terminal).resolves.toMatchObject({
      status: 'done',
      done: { result: 'server reply', generationId: 'uuid-0' },
    })
  })

  it('collects side_effect events on the terminal dispatch result', async () => {
    setServerChatPrompt([{ role: 'user', content: 'hello there' }], { promptText: 'hello there' })
    setServerChatDispatchResult(
      'server reply',
      {
        model: 'echo_model',
        inputTokens: 7,
        outputTokens: 50,
      },
      'uuid-tts',
      { emitTtsSideEffect: true },
    )
    vi.stubGlobal('fetch', serverChatFetch)

    const res = await requestServerChatGeneration(baseInput, null)
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    await expect(res.terminal).resolves.toMatchObject({
      status: 'done',
      sideEffects: [{ kind: 'tts', payload: { text: 'server reply', characterId: 'char-1' } }],
    })
  })

  it('surfaces restoration on terminal dispatch errors', async () => {
    const restoration = {
      chatId: 'chat-1',
      characterId: 'char-1',
      selectedCharID: 0,
      chatPage: 0,
      messages: [{ role: 'user' as const, data: 'Hi there' }],
      scriptstate: { $mood: 'calm' },
    }
    setServerChatPrompt([{ role: 'user', content: 'hello there' }], { promptText: 'hello there' })
    setServerChatDispatchError(
      'provider exploded',
      { model: 'echo_model', inputTokens: 7, outputTokens: 50 },
      restoration,
      'uuid-error',
    )
    vi.stubGlobal('fetch', serverChatFetch)

    const res = await requestServerChatGeneration(baseInput, null)
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    await expect(res.terminal).resolves.toMatchObject({
      status: 'error',
      error: 'provider exploded',
      restoration,
    })
  })
})
