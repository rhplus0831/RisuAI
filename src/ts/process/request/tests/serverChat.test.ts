import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../storage/nodeStorage', () => ({
  getNodeServerProxyAuth: async () => 'test-auth-token',
}))

vi.mock('../../../server/activeWriterSession', () => ({
  activeWriterSessionHeader: () => ({ 'risu-writer-session': 'writer-session-1' }),
  handleActiveWriterStaleResponse: vi.fn((response: Response) => response.status === 423),
}))

import {
  cancelServerChatGeneration,
  requestServerChat,
  requestServerChatGeneration,
  type ServerChatInput,
} from '../serverChat'
import { handleActiveWriterStaleResponse } from '../../../server/activeWriterSession'
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
  vi.mocked(handleActiveWriterStaleResponse).mockClear()
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

  it('sends the intent body with auth and active-writer headers', async () => {
    vi.stubGlobal('fetch', serverChatFetch)
    await requestServerChat(baseInput, null)

    const calls = getServerChatCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'POST',
      authHeader: 'test-auth-token',
      writerHeader: 'writer-session-1',
      chatId: 'chat-1',
      characterId: 'char-1',
      mode: 'send',
    })
  })

  it('sends regenerate intent with the target message id', async () => {
    vi.stubGlobal('fetch', serverChatFetch)
    await requestServerChat(
      {
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'regenerate',
        regenerateMessageId: 'msg-assistant-1',
      },
      null,
    )

    const calls = getServerChatCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      mode: 'regenerate',
      regenerateMessageId: 'msg-assistant-1',
      userMessage: '',
    })
  })

  it('surfaces a terminal error event as a status:error result', async () => {
    setServerChatError('character not found')
    vi.stubGlobal('fetch', serverChatFetch)

    const res = await requestServerChat(baseInput, null)
    expect(res).toEqual({ status: 'error', error: 'character not found' })
  })

  it('keeps pre-error message patches visible for stop-trigger aborts', async () => {
    const patch: ServerChatMessagePatch = {
      chatId: 'chat-1',
      characterId: 'char-1',
      selectedCharID: 0,
      chatPage: 0,
      varChanged: true,
      messageMutations: [
        {
          type: 'replace_all',
          source: 'start_trigger',
          beforeLength: 1,
          afterLength: 2,
          messages: [
            { role: 'user', data: 'hi' },
            { role: 'char', data: 'mutated before stop' },
          ],
        },
      ],
      chatVarMutations: [{ key: '$score', before: '1', after: '9' }],
      additionalSystemPrompt: [],
    }
    setServerChatError('prompt assembly was stopped by a trigger', { messagePatch: patch })
    vi.stubGlobal('fetch', serverChatFetch)

    const res = await requestServerChat(baseInput, null)
    expect(res).toEqual({
      status: 'error',
      error: 'prompt assembly was stopped by a trigger',
      messagePatches: [patch],
    })
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

  it('handles stale writer responses before opening the stream', async () => {
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['risu-writer-session']).toBe(
        'writer-session-1',
      )
      return new Response(JSON.stringify({ error: 'active_writer_stale' }), {
        status: 423,
        headers: { 'content-type': 'application/json' },
      })
    })

    const res = await requestServerChat(baseInput, null)

    expect(res).toEqual({ status: 'error', error: 'active_writer_stale' })
    expect(handleActiveWriterStaleResponse).toHaveBeenCalledTimes(1)
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

  it('surfaces pre-error patches and restoration before dispatch is ready', async () => {
    const patch: ServerChatMessagePatch = {
      chatId: 'chat-1',
      characterId: 'char-1',
      selectedCharID: 0,
      chatPage: 0,
      varChanged: true,
      messageMutations: [],
      chatVarMutations: [{ key: '$score', before: '1', after: '9' }],
      additionalSystemPrompt: [],
    }
    const restoration = {
      chatId: 'chat-1',
      characterId: 'char-1',
      selectedCharID: 0,
      chatPage: 0,
      messages: [{ role: 'user' as const, data: 'Hi there' }],
      scriptstate: { $score: '1' },
    }
    setServerChatError('prompt assembly was stopped by a trigger', {
      messagePatch: patch,
      restoration,
    })
    vi.stubGlobal('fetch', serverChatFetch)

    const res = await requestServerChatGeneration(baseInput, null)
    expect(res).toEqual({
      status: 'error',
      error: 'prompt assembly was stopped by a trigger',
      messagePatches: [patch],
      restoration,
    })
  })
})

describe('cancelServerChatGeneration', () => {
  it('DELETEs the durable job by generationId with auth + writer-session headers', async () => {
    const calls: Array<{ url: string; method?: string; headers: Record<string, string> }> = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        headers: (init?.headers ?? {}) as Record<string, string>,
      })
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    })

    await cancelServerChatGeneration('gen-123')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/v1/generate/chat/gen-123')
    expect(calls[0].method).toBe('DELETE')
    expect(calls[0].headers['risu-auth']).toBe('test-auth-token')
    expect(calls[0].headers['risu-writer-session']).toBe('writer-session-1')
  })

  it('is a no-op for an empty generationId and swallows fetch failures', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchSpy)
    await expect(cancelServerChatGeneration('')).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(cancelServerChatGeneration('gen-x')).resolves.toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('requestServerChatGeneration durable cancel-on-abort', () => {
  // A streaming SSE response that emits `job_accepted` (carrying the jobId) + a stage
  // frame, then hangs until the request is aborted — modelling a durable job that is
  // still running when the user hits stop mid-assembly. DELETEs are captured.
  function stubDurableStreamFetch(jobId: string): { deletes: string[] } {
    const deletes: string[] = []
    const enc = new TextEncoder()
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deletes.push(url)
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode(`event: job_accepted\ndata: ${JSON.stringify({ jobId })}\n\n`))
          controller.enqueue(enc.encode('event: stage\ndata: {"stage":"prompt","status":"start"}\n\n'))
          // Intentionally never closes — the abort must end the stream.
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    return { deletes }
  }

  it('DELETEs the durable jobId (captured from job_accepted) when aborted mid-stream', async () => {
    const { deletes } = stubDurableStreamFetch('job-xyz')
    const controller = new AbortController()
    const pending = requestServerChatGeneration({ ...baseInput, durable: true }, controller.signal)
    await new Promise((r) => setTimeout(r, 15))
    controller.abort()
    const res = await pending
    expect(res.status).toBe('aborted')
    await new Promise((r) => setTimeout(r, 5))
    expect(deletes).toContain('/api/v1/generate/chat/job-xyz')
  })

  it('does NOT cancel on abort for a non-durable send', async () => {
    const { deletes } = stubDurableStreamFetch('job-xyz')
    const controller = new AbortController()
    const pending = requestServerChatGeneration({ ...baseInput, durable: false }, controller.signal)
    await new Promise((r) => setTimeout(r, 15))
    controller.abort()
    await pending
    await new Promise((r) => setTimeout(r, 5))
    expect(deletes).toEqual([])
  })
})
