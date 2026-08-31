import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const globalFetchMock = vi.hoisted(() => vi.fn())
const fetchMock = vi.hoisted(() => vi.fn())
const resolveServerCompletionRouteMock = vi.hoisted(() => vi.fn())
const callToolMock = vi.hoisted(() => vi.fn())
const encodeToolCallMock = vi.hoisted(() => vi.fn())
const getNodeServerProxyAuthMock = vi.hoisted(() => vi.fn())

vi.mock('src/ts/globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../../../globalApi.svelte')>()
  return {
    ...actual,
    globalFetch: globalFetchMock,
  }
})

vi.mock('../serverCompletion', async (importActual) => {
  const actual = await importActual<typeof import('../serverCompletion')>()
  return {
    ...actual,
    resolveServerCompletionRoute: resolveServerCompletionRouteMock,
  }
})

vi.mock('../../mcp/mcp', async (importActual) => {
  const actual = await importActual<typeof import('../../mcp/mcp')>()
  return {
    ...actual,
    callTool: callToolMock,
    encodeToolCall: encodeToolCallMock,
  }
})

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '', getModuleTriggers: () => [] }
})

vi.mock('../../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: getNodeServerProxyAuthMock,
}))

import { LLMFormat } from '../../../model/types'
import { getDatabase, setDatabase, type Database } from '../../../storage/database.svelte'
import { selectedCharID } from '../../../stores.svelte'
import { requestChatDataMain } from '../request'

interface PreviewPayload {
  url: string
  model: string
  source: string
  stream: boolean
  think?: boolean | 'low' | 'medium' | 'high'
  headers: Record<string, string>
}

function db(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'ollama-hosted',
    subModel: 'ollama-hosted',
    characters: [{ name: 'Ollama Character', chats: [], chatPage: 0 }],
    modelRoles: {},
    seperateModelsForAxModels: false,
    seperateModels: {},
    fallbackModels: {},
    customModels: [],
    modelTools: [],
    temperature: 50,
    top_p: 0.9,
    top_k: 40,
    top_a: 0,
    repetition_penalty: 1.05,
    frequencyPenalty: -1000,
    PresensePenalty: -1000,
    maxContext: 4096,
    maxResponse: 512,
    useStreaming: false,
    genTime: 1,
    extractJson: '',
    ollamaURL: 'https://profile.ollama.example',
    ollamaModel: 'profile-local-model',
    ollamaModelSource: 'local',
    ollamaInputMode: 'manual',
    ollamaRequestFormat: LLMFormat.Ollama,
    ollamaApiKey: 'sk-profile-ollama',
    ollamaModelName: 'Profile Local Model',
    ollamaCloudModel: 'profile-cloud-model',
    ollamaCloudModelName: 'Profile Cloud Model',
    ollamaThinkingMode: 'high',
    OaiCompAPIKeys: {},
    openrouterProvider: { order: [], only: [], ignore: [] },
    localNetworkMode: false,
    gptVisionQuality: 'auto',
    newOAIHandle: false,
    instructChatTemplate: 'chatml',
    JinjaTemplate: '',
    username: 'Profile User',
    ...overrides,
  } as unknown as Database
}

function makeRequest() {
  return {
    // Ollama remains a named static compatibility format in this wire-level suite.
    staticModel: getDatabase().aiModel,
    formated: [{ role: 'user' as const, content: 'hello ollama' }],
    bias: {},
    maxTokens: 96,
    previewBody: true,
    useStreaming: false,
    tools: [],
  }
}

function ollamaOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function anthropicStream(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function switchActiveDbDuringRoute(overrides: Partial<Database>): void {
  resolveServerCompletionRouteMock.mockImplementation(() => {
    setDatabase(db(overrides))
    return { type: 'local' }
  })
}

async function preview(): Promise<PreviewPayload> {
  const result = await requestChatDataMain(makeRequest(), 'model')
  expect(result.type).toBe('success')
  if (typeof result.result !== 'string') throw new Error('Expected preview body string')
  return JSON.parse(result.result) as PreviewPayload
}

beforeEach(() => {
  selectedCharID.set(0)
  vi.stubGlobal('fetch', fetchMock)
  globalFetchMock.mockReset()
  fetchMock.mockReset()
  callToolMock.mockReset()
  encodeToolCallMock.mockReset()
  getNodeServerProxyAuthMock.mockReset()
  getNodeServerProxyAuthMock.mockResolvedValue('browser-auth-token')
  encodeToolCallMock.mockImplementation(async ({ call }: { call: { name: string } }) => {
    return `<tool_call>encoded-${call.name}</tool_call>\n\n`
  })
  resolveServerCompletionRouteMock.mockReset()
  resolveServerCompletionRouteMock.mockReturnValue({ type: 'local' })
})

afterEach(() => {
  selectedCharID.set(-1)
  vi.unstubAllGlobals()
})

describe('requestOllama profile provider options through requestChatDataMain', () => {
  it('uses local native Ollama profile URL, model, source, and thinking mode over conflicting flat fields', async () => {
    setDatabase(
      db({
        aiModel: 'ollama-hosted',
        ollamaURL: 'https://profile.ollama.example',
        ollamaModel: 'profile-local-model',
        ollamaModelSource: 'local',
        ollamaThinkingMode: 'high',
      }),
    )
    switchActiveDbDuringRoute({
      ollamaURL: 'https://flat.ollama.example',
      ollamaModel: 'flat-local-model',
      ollamaModelSource: 'cloud',
      ollamaThinkingMode: 'off',
    })

    const payload = await preview()

    expect(payload.url).toBe('https://profile.ollama.example/api/chat')
    expect(payload.model).toBe('profile-local-model')
    expect(payload.source).toBe('local')
    expect(payload.think).toBe('high')
    expect(payload.headers).toEqual({})
  })

  it('uses cloud native Ollama profile model, API key, source, and thinking mode over conflicting flat fields', async () => {
    setDatabase(
      db({
        aiModel: 'ollama-cloud',
        subModel: 'ollama-cloud',
        ollamaApiKey: 'sk-profile-cloud',
        ollamaRequestFormat: LLMFormat.Ollama,
        ollamaCloudModel: 'profile-cloud-model',
        ollamaModelSource: 'cloud',
        ollamaThinkingMode: 'medium',
      }),
    )
    switchActiveDbDuringRoute({
      aiModel: 'ollama-cloud',
      subModel: 'ollama-cloud',
      ollamaApiKey: 'sk-flat-cloud',
      ollamaRequestFormat: LLMFormat.OpenAICompatible,
      ollamaCloudModel: 'flat-cloud-model',
      ollamaModelSource: 'local',
      ollamaThinkingMode: 'off',
    })

    const payload = await preview()

    expect(payload.url).toBe('https://ollama.com/api/chat')
    expect(payload.model).toBe('profile-cloud-model')
    expect(payload.source).toBe('cloud')
    expect(payload.think).toBe('medium')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-cloud')
  })

  it('fails without falling back to flat db.ollamaURL when profile local URL is missing', async () => {
    setDatabase(
      db({
        aiModel: 'ollama-hosted',
        ollamaURL: '',
        ollamaModel: 'profile-missing-url-model',
      }),
    )
    switchActiveDbDuringRoute({
      ollamaURL: 'https://flat-required.ollama.example',
      ollamaModel: 'flat-required-model',
    })

    const result = await requestChatDataMain(makeRequest(), 'model')

    expect(result).toEqual({
      type: 'fail',
      result: 'options.ollama.baseUrl is required',
      noRetry: true,
    })
    expect(globalFetchMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('executes native Ollama tool calls and sends tool_name history in the follow-up request', async () => {
    setDatabase(
      db({
        aiModel: 'ollama-hosted',
        ollamaURL: 'http://localhost:11434',
        ollamaModel: 'llama3.1',
        ollamaThinkingMode: 'off',
      }),
    )
    callToolMock.mockResolvedValue([{ type: 'text', text: '22 C' }])
    fetchMock
      .mockResolvedValueOnce(
        ollamaOk({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                function: {
                  name: 'get_temperature',
                  arguments: { city: 'Seoul' },
                },
              },
            ],
          },
          done: true,
        }),
      )
      .mockResolvedValueOnce(
        ollamaOk({
          message: {
            role: 'assistant',
            content: 'It is 22 C in Seoul.',
          },
          done: true,
        }),
      )

    const result = await requestChatDataMain(
      {
        ...makeRequest(),
        previewBody: false,
        tools: [
          {
            name: 'get_temperature',
            description: 'Get the current temperature for a city',
            inputSchema: {
              type: 'object',
              properties: {
                city: { type: 'string' },
              },
              required: ['city'],
            },
          },
        ],
      },
      'model',
    )

    expect(result).toEqual({
      type: 'success',
      result: 'It is 22 C in Seoul.',
      model: 'ollama-hosted',
    })
    expect(callToolMock).toHaveBeenCalledWith('get_temperature', { city: 'Seoul' })
    expect(resolveServerCompletionRouteMock).not.toHaveBeenCalled()

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(firstBody.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_temperature',
          description: 'Get the current temperature for a city',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string' },
            },
            required: ['city'],
          },
        },
      },
    ])

    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(secondBody.messages).toEqual([
      { role: 'user', content: 'hello ollama' },
      {
        role: 'assistant',
        thinking: '',
        content: '',
        tool_calls: [
          {
            function: {
              name: 'get_temperature',
              arguments: { city: 'Seoul' },
            },
          },
        ],
      },
      { role: 'tool', tool_name: 'get_temperature', content: '22 C' },
    ])
  })

  it('keeps native Ollama Cloud tool credentials in the server-owned proxy', async () => {
    setDatabase(
      db({
        aiModel: 'ollama-cloud',
        subModel: 'ollama-cloud',
        ollamaApiKey: 'sk-browser-must-not-send',
        ollamaRequestFormat: LLMFormat.Ollama,
        ollamaCloudModel: 'cloud-tool-model',
        ollamaThinkingMode: 'off',
      }),
    )
    callToolMock.mockResolvedValue([{ type: 'text', text: '22 C' }])
    fetchMock
      .mockResolvedValueOnce(
        ollamaOk({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'get_temperature', arguments: { city: 'Seoul' } } }],
          },
          done: true,
        }),
      )
      .mockResolvedValueOnce(
        ollamaOk({
          message: { role: 'assistant', content: 'It is 22 C in Seoul.' },
          done: true,
        }),
      )

    const result = await requestChatDataMain(
      {
        ...makeRequest(),
        chatId: 'chat-cloud',
        previewBody: false,
        tools: [
          {
            name: 'get_temperature',
            description: 'Get the current temperature for a city',
            inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
          },
        ],
      },
      'model',
    )

    expect(result).toEqual({ type: 'success', result: 'It is 22 C in Seoul.', model: 'ollama-cloud' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetchMock.mock.calls) {
      const parsedUrl = new URL(String(url))
      expect(parsedUrl.pathname).toBe('/api/v1/generate/completion')
      expect(parsedUrl.searchParams.get('operation')).toBe('ollama-cloud-tool')
      expect(parsedUrl.searchParams.get('protocol')).toBe('native')
      expect(parsedUrl.searchParams.get('staticModel')).toBe('ollama-cloud')
      expect(parsedUrl.searchParams.get('chatId')).toBe('chat-cloud')
      expect(new Headers(init.headers).get('risu-auth')).toBe('browser-auth-token')
      expect(JSON.stringify(init)).not.toContain('sk-browser-must-not-send')
      expect(new Headers(init.headers).get('authorization')).toBeNull()
    }
  })

  it('keeps OpenAI-compatible Ollama Cloud tool rounds behind the server-owned proxy', async () => {
    setDatabase(
      db({
        aiModel: 'ollama-cloud',
        subModel: 'ollama-cloud',
        ollamaApiKey: 'sk-openai-browser-must-not-send',
        ollamaRequestFormat: LLMFormat.OpenAICompatible,
        ollamaCloudModel: 'cloud-openai-model',
      }),
    )
    callToolMock.mockResolvedValue([{ type: 'text', text: 'tool result' }])
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{"query":"weather"}' },
                  },
                ],
              },
            },
          ],
        }),
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ choices: [{ message: { role: 'assistant', content: 'OpenAI proxy result' } }] }),
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })

    const result = await requestChatDataMain(
      {
        ...makeRequest(),
        previewBody: false,
        tools: [{ name: 'lookup', description: 'Lookup data', inputSchema: { type: 'object' } }],
      },
      'model',
    )

    expect(result).toMatchObject({ type: 'success', result: expect.stringContaining('OpenAI proxy result') })
    expect(callToolMock).toHaveBeenCalledWith('lookup', { query: 'weather' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url, options] of fetchMock.mock.calls) {
      const parsedUrl = new URL(String(url))
      expect(parsedUrl.pathname).toBe('/api/v1/generate/completion')
      expect(parsedUrl.searchParams.get('protocol')).toBe('openai-chat')
      expect(new Headers(options.headers).get('risu-auth')).toBe('browser-auth-token')
      expect(JSON.stringify(options)).not.toContain('sk-openai-browser-must-not-send')
    }
  })

  it('keeps Ollama Cloud Responses requests behind the server-owned proxy', async () => {
    setDatabase(
      db({
        aiModel: 'ollama-cloud',
        subModel: 'ollama-cloud',
        ollamaApiKey: 'sk-responses-browser-must-not-send',
        ollamaRequestFormat: LLMFormat.OpenAIResponseAPI,
        ollamaCloudModel: 'cloud-responses-model',
      }),
    )
    callToolMock.mockResolvedValue([{ type: 'text', text: 'responses tool result' }])
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          output: [
            { id: 'rs_responses_stale', type: 'reasoning', summary: [] },
            {
              id: 'fc_responses_stale',
              type: 'function_call',
              call_id: 'responses-call-1',
              name: 'lookup',
              arguments: '{"query":"weather"}',
            },
          ],
        }),
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'Responses proxy result' }] }],
        }),
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })

    const result = await requestChatDataMain(
      {
        ...makeRequest(),
        previewBody: false,
        tools: [{ name: 'lookup', description: 'Lookup data', inputSchema: { type: 'object' } }],
      },
      'model',
    )

    expect(result).toEqual({ type: 'success', result: 'Responses proxy result' })
    expect(callToolMock).toHaveBeenCalledWith('lookup', { query: 'weather' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url, options] of fetchMock.mock.calls) {
      const parsedUrl = new URL(String(url))
      expect(parsedUrl.searchParams.get('protocol')).toBe('openai-responses')
      expect(new Headers(options.headers).get('risu-auth')).toBe('browser-auth-token')
      expect(JSON.stringify(options)).not.toContain('sk-responses-browser-must-not-send')
    }
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1].body))
    expect(JSON.stringify(secondBody.input)).not.toMatch(/rs_responses_stale|fc_responses_stale/u)
    expect(secondBody.input).toContainEqual({
      type: 'function_call',
      call_id: 'responses-call-1',
      name: 'lookup',
      arguments: '{"query":"weather"}',
      status: 'completed',
    })
    expect(secondBody.input).toContainEqual({
      type: 'function_call_output',
      call_id: 'responses-call-1',
      output: 'responses tool result',
    })
  })

  it('keeps Anthropic-format Ollama Cloud tool rounds behind the server-owned proxy', async () => {
    setDatabase(
      db({
        aiModel: 'ollama-cloud',
        subModel: 'ollama-cloud',
        ollamaApiKey: 'sk-anthropic-browser-must-not-send',
        ollamaRequestFormat: LLMFormat.Anthropic,
        ollamaCloudModel: 'cloud-anthropic-model',
      }),
    )
    callToolMock.mockResolvedValue([{ type: 'text', text: 'anthropic tool result' }])
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          content: [{ type: 'tool_use', id: 'anthropic-call-1', name: 'lookup', input: { query: 'weather' } }],
        }),
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ content: [{ type: 'text', text: 'Anthropic proxy result' }] }),
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })

    const result = await requestChatDataMain(
      {
        ...makeRequest(),
        previewBody: false,
        tools: [{ name: 'lookup', description: 'Lookup data', inputSchema: { type: 'object' } }],
      },
      'model',
    )

    expect(result).toEqual({ type: 'success', result: 'Anthropic proxy result' })
    expect(callToolMock).toHaveBeenCalledWith('lookup', { query: 'weather' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url, options] of fetchMock.mock.calls) {
      const parsedUrl = new URL(String(url))
      expect(parsedUrl.searchParams.get('protocol')).toBe('anthropic')
      expect(new Headers(options.headers).get('risu-auth')).toBe('browser-auth-token')
      expect(JSON.stringify(options)).not.toContain('sk-anthropic-browser-must-not-send')
    }
  })

  it('preserves streaming across Anthropic-format Ollama Cloud tool rounds', async () => {
    setDatabase(
      db({
        aiModel: 'ollama-cloud',
        subModel: 'ollama-cloud',
        ollamaApiKey: 'sk-stream-browser-must-not-send',
        ollamaRequestFormat: LLMFormat.Anthropic,
        ollamaCloudModel: 'cloud-anthropic-stream-model',
        useStreaming: true,
        simplifiedToolUse: true,
      }),
    )
    callToolMock.mockResolvedValue([{ type: 'text', text: 'stream tool result' }])
    fetchMock
      .mockResolvedValueOnce(
        anthropicStream([
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: 'plan ', signature: '' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'carefully' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: 'sig-1' },
          },
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'stream-call-1', name: 'lookup', input: {} },
          },
          { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' } },
          { type: 'message_stop' },
        ]),
      )
      .mockResolvedValueOnce(
        anthropicStream([
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Streaming proxy result' } },
          { type: 'message_stop' },
        ]),
      )

    const result = await requestChatDataMain(
      {
        ...makeRequest(),
        previewBody: false,
        useStreaming: true,
        tools: [{ name: 'lookup', description: 'Lookup data', inputSchema: { type: 'object' } }],
      },
      'model',
    )

    expect(result.type).toBe('streaming')
    if (result.type !== 'streaming') throw new Error('expected streaming response')
    const reader = result.result.getReader()
    let last = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      last = value?.['0'] ?? last
    }
    expect(last).toBe('Streaming proxy result')
    expect(callToolMock).toHaveBeenCalledWith('lookup', { q: 'x' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const continuationWireBody = fetchMock.mock.calls[1][1].body
    const continuationBody = JSON.parse(
      continuationWireBody instanceof Uint8Array
        ? new TextDecoder().decode(continuationWireBody)
        : String(continuationWireBody),
    )
    expect(continuationBody.messages.at(-2)).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'plan carefully', signature: 'sig-1' },
        { type: 'tool_use', id: 'stream-call-1', name: 'lookup', input: { q: 'x' } },
      ],
    })
    for (const [url, options] of fetchMock.mock.calls) {
      expect(new URL(String(url)).searchParams.get('protocol')).toBe('anthropic')
      expect(new Headers(options.headers).get('risu-auth')).toBe('browser-auth-token')
      expect(JSON.stringify(options)).not.toContain('sk-stream-browser-must-not-send')
    }
  })
})
