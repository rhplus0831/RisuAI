import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Chat, Database, Message, character } from '../../../src/ts/storage/database.svelte'
import { LLMFormat } from '../../../src/ts/model/types'
import { runPromptContextAgent, type PromptContextAgentInput } from '../src/prompt/contextAgent.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'

beforeAll(() => {
  bootPromptVariables()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    name: 'Chat',
    note: '',
    localLore: [],
    message: [
      { role: 'user', data: 'Remember the lighthouse promise.' },
      { role: 'char', data: 'I will keep the lantern lit.' },
    ] as Message[],
    ...overrides,
  } as unknown as Chat
}

function makeCharacter(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'char-tess',
    utilityBot: false,
    chatPage: 0,
    desc: 'A careful keeper of promises.',
    personality: '',
    scenario: '',
    globalLore: [],
    chats: [makeChat()],
    ...overrides,
  } as unknown as character
}

function makeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    currentChar: 0,
    characters: [makeCharacter()],
    username: 'User',
    mainPrompt: 'Agent context:\n{{agent}}',
    agentContextEnabled: true,
    agentContextPrompt: 'Find only the facts needed for the next reply.',
    agentContextMaxOutput: 1200,
    agentContextMaxToolRounds: 1,
    aiModel: 'ollama-hosted',
    ollamaURL: 'http://localhost:11434',
    ollamaModel: 'llama3.1',
    ollamaModelSource: 'local',
    ollamaThinkingMode: 'off',
    maxResponse: 256,
    temperature: 80,
    ...overrides,
  } as unknown as Database
}

function inputFor(database: Database): PromptContextAgentInput {
  const currentChar = database.characters[0]
  const currentChat = currentChar.chats[0]
  return {
    database,
    currentChar,
    currentChat,
    selectedCharID: 0,
    chatPage: 0,
    ctx: { database, selectedCharID: 0, chatPage: 0 },
    signal: new AbortController().signal,
  }
}

describe('runPromptContextAgent with Ollama', () => {
  it('runs native Ollama tool calls and feeds tool results back to the model', async () => {
    const database = makeDatabase()
    const bodies: Array<Record<string, unknown>> = []

    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      bodies.push(body)
      if (bodies.length === 1) {
        return ok({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: 'get_chat_tail',
                  arguments: { limit: 2 },
                },
              },
            ],
          },
          done: true,
        })
      }
      return ok({
        model: 'llama3.1',
        message: { role: 'assistant', content: 'The lighthouse promise is relevant.' },
        done: true,
      })
    })

    const result = await runPromptContextAgent(inputFor(database))

    expect(result).toMatchObject({
      skipped: false,
      provider: 'ollama',
      model: 'llama3.1',
      text: 'The lighthouse promise is relevant.',
      toolCalls: 1,
    })
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toMatchObject({
      model: 'llama3.1',
      stream: false,
      tools: expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          function: expect.objectContaining({ name: 'get_chat_tail' }),
        }),
      ]),
    })
    expect(bodies[1].tools).toBeUndefined()
    expect(bodies[1].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          tool_calls: [
            {
              type: 'function',
              function: { name: 'get_chat_tail', arguments: { limit: 2 } },
            },
          ],
        }),
        expect.objectContaining({
          role: 'tool',
          tool_name: 'get_chat_tail',
          content: expect.stringContaining('lighthouse promise'),
        }),
      ]),
    )
  })

  it('uses the native Ollama Cloud chat endpoint and API key when that route is selected', async () => {
    const database = makeDatabase({
      aiModel: 'ollama-cloud',
      ollamaURL: '',
      ollamaApiKey: 'sk-ollama-cloud',
      ollamaRequestFormat: LLMFormat.Ollama,
      ollamaCloudModel: 'gpt-oss:20b',
      ollamaModelSource: 'cloud',
    } as Partial<Database>)
    const captured: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = []

    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      })
      return ok({
        model: 'gpt-oss:20b',
        message: { role: 'assistant', content: 'Cloud context ready.' },
        done: true,
      })
    })

    const result = await runPromptContextAgent(inputFor(database))

    expect(result).toMatchObject({
      skipped: false,
      provider: 'ollama',
      model: 'gpt-oss:20b',
      text: 'Cloud context ready.',
    })
    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('https://ollama.com/api/chat')
    expect(captured[0].headers.authorization).toBe('Bearer sk-ollama-cloud')
    expect(captured[0].body.model).toBe('gpt-oss:20b')
  })
})
