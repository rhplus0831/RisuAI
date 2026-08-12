import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const baselineState = vi.hoisted(() => ({
  uuidCounter: 0,
}))

vi.mock('uuid', () => ({
  v4: () => `baseline-generated-${baselineState.uuidCounter++}`,
}))

vi.mock('@mlc-ai/web-tokenizers', () => ({
  Tokenizer: {
    fromJSON: async () => ({ encode: (text: string) => (text.length === 0 ? [] : text.split(/\s+/)) }),
    fromSentencePiece: async () => ({ encode: (text: string) => (text.length === 0 ? [] : text.split(/\s+/)) }),
  },
}))

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/process/tts.ts', () => ({
  sayTTS: async () => undefined,
}))

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/process/inlayScreen.ts', () => ({
  runInlayScreen: (_character: unknown, text: string) => ({ text }),
}))

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/process/stableDiff.ts', () => ({
  stableDiff: async () => undefined,
  generateAIImage: async () => undefined,
}))

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/process/prereroll.ts', () => ({
  addRerolls: () => undefined,
  Prereroll: () => null,
  PreUnreroll: () => null,
}))

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/process/files/inlays.ts', () => ({
  getInlayAsset: async () => null,
  supportsInlayImage: () => false,
  writeInlayImage: async () => undefined,
}))

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts', () => ({
  runLuaEditTrigger: async (_character: unknown, _mode: string, content: unknown) => content,
  runScripted: async (_code: string, args: { chat?: unknown }) => ({
    res: undefined,
    stopSending: false,
    additonalSysPrompt: undefined,
    chat: args.chat,
  }),
  runLuaButtonTrigger: async () => undefined,
}))

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/process/triggers.ts', () => ({
  runTrigger: async () => null,
}))

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/process/modules.ts', () => ({
  moduleUpdate: () => undefined,
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModules: () => [],
  getModuleRegexScripts: () => [],
  getModuleToggles: () => '',
  getModuleTriggers: () => [],
}))

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/process/scripts.ts', () => ({
  processScript: async (_character: unknown, data: string) => data,
  processScriptFull: async (_character: unknown, data: string) => ({ data, emoChanged: false }),
  risuChatParser: (data: string) => data,
  resetScriptCache: () => undefined,
}))

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/parser/parser.svelte.ts', () => ({
  assetRegex: /$^/g,
  risuChatParser: (data: string) => data,
  risuEscape: (data: string) => data,
  risuUnescape: (data: string) => data,
}))

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/process/mcp/mcp.ts', () => ({
  getTools: async () => [],
  callTool: async () => ({ content: [] }),
  decodeToolCall: async () => null,
  encodeToolCall: () => '',
}))

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/process/transformers.ts', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>()
  return { ...actual, runImageEmbedding: async () => [{ generated_text: 'compat caption' }] }
})

vi.mock('/home/codex/risu-baseline-71c476e9c/src/ts/process/memory/hypav3.ts', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>()
  return {
    ...actual,
    hypaMemoryV3: async () => ({
      currentTokens: 0,
      chats: [],
    }),
  }
})

import { get } from 'svelte/store'
import { processMultiCommand } from '/home/codex/risu-baseline-71c476e9c/src/ts/process/command.ts'
import {
  abortChat,
  chatProcessStage,
  doingChat,
  sendChat,
} from '/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts'
import { getDatabase, setDatabase } from '/home/codex/risu-baseline-71c476e9c/src/ts/storage/database.svelte.ts'
import { selectedCharID } from '/home/codex/risu-baseline-71c476e9c/src/ts/stores.svelte.ts'
import { isTokenizerUrl, serveTokenizerFetch } from '../../src/ts/process/__fixtures__/mocks/tokenizerFetch'
import { FIXTURE_ASSISTANT_ID, MULTISEND_COMMAND, createFixtureDatabase, providerReply } from './fixture'
import { captureProviderRequest, normalizeTranscript, openAiMockResponse } from './normalize'
import { compatCells, type CapturedProviderRequest, type CompatCellArtifact, type CompatSideArtifact } from './types'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const OUTPUT_PATH = process.env.COMPAT_HARNESS_BASELINE_OUTPUT

describe('Original-Risu compatibility harness baseline runner', () => {
  const cells: CompatCellArtifact[] = []
  let originalFetch: typeof globalThis.fetch
  let providerRequests: CapturedProviderRequest[] = []
  let activeScenario: ReturnType<typeof compatCells>[number] | undefined
  let restoreConsole: (() => void) | undefined

  beforeAll(() => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    restoreConsole = () => {
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'))
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (isTokenizerUrl(url)) return serveTokenizerFetch(url)
      if (url === OPENAI_ENDPOINT) {
        if (!activeScenario) throw new Error('Provider request arrived without an active compatibility cell')
        const captured = captureProviderRequest(input, init)
        providerRequests.push(captured)
        const reply = providerReply(activeScenario.scenario, providerRequests.length - 1)
        return openAiMockResponse(reply, captured.body.stream === true)
      }
      throw new Error(`Unexpected baseline fetch: ${url}`)
    }) as typeof globalThis.fetch
  })

  afterAll(async () => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
    if (!OUTPUT_PATH) throw new Error('COMPAT_HARNESS_BASELINE_OUTPUT is required')
    const artifact: CompatSideArtifact = {
      schemaVersion: 1,
      side: 'baseline',
      baselineCommit: '71c476e9c86263fe907105b011ca4dde0a619d66',
      boundary:
        'Baseline exported sendChat pipeline with real prompt assembly, OpenAI adapter, response handling, and transcript mutation; private chat-screen action preludes are emulated.',
      cells,
    }
    await mkdir(dirname(OUTPUT_PATH), { recursive: true })
    await writeFile(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
    restoreConsole?.()
  })

  it.each(compatCells())('$id', async (cell) => {
    activeScenario = cell
    providerRequests = []
    baselineState.uuidCounter = 0
    doingChat.set(false)
    abortChat.set(false)
    chatProcessStage.set(0)
    selectedCharID.set(0)
    setDatabase(createFixtureDatabase(cell.transport, cell.useSayNothing) as never)

    const database = getDatabase()
    const chat = database.characters[0].chats[0]
    let completed = false
    let error: string | undefined
    try {
      switch (cell.scenario) {
        case 'send':
          if (cell.useSayNothing && chat.message.at(-1)?.role !== 'user') {
            chat.message.push({ role: 'user', data: '*says nothing*', name: null })
          }
          completed = await sendChat(-1)
          break
        case 'regenerate':
          while (chat.message.at(-1)?.role !== 'user') chat.message.pop()
          completed = await sendChat(-1)
          break
        case 'continue':
          if (cell.useSayNothing && chat.message.at(-1)?.role !== 'user') {
            chat.message.push({ role: 'user', data: '*says nothing*', name: null })
          }
          completed = await sendChat(-1, { continue: true })
          break
        case 'multisend':
          await processMultiCommand(MULTISEND_COMMAND)
          completed = providerRequests.length === 2
          break
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    } finally {
      doingChat.set(false)
    }

    expect(get(doingChat)).toBe(false)
    cells.push({
      ...cell,
      execution: {
        completed,
        providerCallCount: providerRequests.length,
        ...(error ? { error } : {}),
      },
      persistedTranscript: normalizeTranscript(chat.message as unknown[]),
      providerRequests: structuredClone(providerRequests),
    })
    activeScenario = undefined

    if (cell.scenario === 'regenerate') {
      expect(chat.message.some((message) => message.chatId === FIXTURE_ASSISTANT_ID)).toBe(false)
    }
  })
})
