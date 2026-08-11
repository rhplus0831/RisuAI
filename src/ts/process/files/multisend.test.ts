import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => {
  const databaseState = {
    db: {
      characters: [] as any[],
    },
  }

  const selectedCharID = {
    subscribe(run: (value: number) => void) {
      run(0)
      return () => {}
    },
  }

  const sendChatSpy = vi.fn(async () => {
    runTrustedWrite(() => {
      const currentChar = databaseState.db.characters[0]
      const currentChat = currentChar.chats[currentChar.chatPage]
      const latestMessage = currentChat.message.at(-1)
      currentChat.message.push({
        role: 'char',
        data: `translated:${latestMessage?.data ?? ''}`,
      })
    })
    return true
  })

  let runTrustedWrite = <T>(callback: () => T): T => callback()

  return {
    databaseState,
    selectedCharID,
    sendChatSpy,
    downloadFileSpy: vi.fn(),
    selectMultipleFileSpy: vi.fn(),
    postInlayAssetSpy: vi.fn(),
    addTextSpy: vi.fn(),
    similaritySearchSpy: vi.fn(),
    getDocumentSpy: vi.fn(),
    hydrateChatMessagesSpy: vi.fn(async () => {}),
    setRunTrustedWrite(fn: typeof runTrustedWrite) {
      runTrustedWrite = fn
    },
  }
})

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => testState.databaseState.db,
  setDatabase: vi.fn(),
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  captureChatBodyProjectionEpoch: () => 0,
  getResourceDatabase: () => testState.databaseState.db,
  isResourceDatabaseWriteActive: () => false,
  replaceResourceDatabase: (value: typeof testState.databaseState.db) => {
    testState.databaseState.db = value
  },
  setResourceDatabaseWriteGuardEnabled: vi.fn(),
  withResourceDatabaseWrite: <T>(callback: () => T): T => callback(),
}))

vi.mock('src/ts/storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'multisend-test-token',
}))

vi.mock('src/ts/stores.svelte', () => ({
  selectedCharID: testState.selectedCharID,
}))

vi.mock('src/ts/server/chatMessageHydration.svelte', () => ({
  hydrateChatMessages: testState.hydrateChatMessagesSpy,
}))

vi.mock('../index.svelte', () => ({
  sendChat: testState.sendChatSpy,
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  downloadFile: testState.downloadFileSpy,
}))

vi.mock('../memory/hypamemory', () => ({
  HypaProcesser: class {
    addText = testState.addTextSpy
    similaritySearch = testState.similaritySearchSpy
  },
}))

vi.mock('src/ts/util', () => ({
  BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
}))

vi.mock('src/ts/filePicker', () => ({
  selectMultipleFile: testState.selectMultipleFileSpy,
}))

vi.mock('src/ts/activeChatGenerationSettings', () => ({
  guardActiveChatGenerationSettingsForSend: vi.fn(() => ({ status: 'ok' })),
}))

vi.mock('./inlays', () => ({
  postInlayAsset: testState.postInlayAssetSpy,
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: testState.getDocumentSpy,
}))

vi.mock('pdfjs-dist/build/pdf.worker?worker&url', () => ({
  default: 'test-pdf-worker-url',
}))

import { postChatFile } from './multisend'
import { clearCachedServerCommandRevision } from '../../server/commands'
import { setResourceWriteGuardEnabled, withTrustedResourceWrite } from '../../server/resourceWriteGuard.svelte'

let consoleLogSpy: ReturnType<typeof vi.spyOn>

interface CapturedFetch {
  url: string
  method: string
  body: any
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url.startsWith('/api/v1/commands/chats/') && url.endsWith('/messages')) {
        return jsonResponse({
          revision: 11,
          event: { type: 'messages.replaced', revision: 11, resource: 'chat' },
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForMessageCommands(calls: CapturedFetch[], expected: number): Promise<CapturedFetch[]> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const matches = calls.filter(
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'POST',
    )
    if (matches.length >= expected) return matches
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`expected ${expected} message commands; saw ${JSON.stringify(calls)}`)
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function makePoFile(entryCount: number): string {
  return Array.from({ length: entryCount }, (_unused, index) => {
    return `msgid "line ${index}"\nmsgstr ""\n`
  }).join('\n')
}

const finalEntrySeparatorFixtures = [
  {
    description: 'with a trailing blank separator',
    source: 'msgid "final with separator"\nmsgstr ""\n\n',
    expected: 'translated:final with separator',
  },
  {
    description: 'without a trailing separator',
    source: 'msgid "final without separator"\nmsgstr ""',
    expected: 'translated:final without separator',
  },
] as const

const extractedNoteMarkerFixtures = [
  { marker: '#. Note =', note: 'singular context' },
  { marker: '#. Notes =', note: 'plural context' },
] as const

function resetChatState() {
  testState.databaseState.db = {
    characters: [
      {
        chaId: 'char-1',
        chatPage: 0,
        chats: [
          {
            id: 'chat-1',
            message: [],
          },
        ],
      },
    ],
  }
}

function fileBlockBase64(matches: string[]): string {
  let message = ''
  for (let i = 0; i < matches.length; i++) {
    message += '\n' + matches[i]
    if (i > 5) break
  }
  return Buffer.from(`<File>\n${message}\n</File>\n`).toString('base64')
}

function mockPdfDocument(pageTexts: string[] = ['pdf extracted text']) {
  testState.getDocumentSpy.mockImplementation(() => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn(async () => ({
        getTextContent: vi.fn(async () => ({
          items: pageTexts.map((str) => ({ str })),
        })),
      })),
    }),
  }))
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
  stubCommandFetch()
  testState.setRunTrustedWrite(withTrustedResourceWrite)
  resetChatState()
  testState.sendChatSpy.mockClear()
  testState.downloadFileSpy.mockReset()
  testState.selectMultipleFileSpy.mockReset()
  testState.postInlayAssetSpy.mockReset()
  testState.addTextSpy.mockReset()
  testState.similaritySearchSpy.mockReset()
  testState.similaritySearchSpy.mockResolvedValue(['matched segment'])
  testState.getDocumentSpy.mockReset()
  testState.hydrateChatMessagesSpy.mockReset()
  testState.hydrateChatMessagesSpy.mockResolvedValue(undefined)
  mockPdfDocument()
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  consoleLogSpy.mockRestore()
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('postChatFile file-send handling', () => {
  it('M22: translates every entry in a .po file longer than 100 lines', async () => {
    const entryCount = 125

    const results = await postChatFile({
      name: 'dialogue.po',
      data: textBytes(makePoFile(entryCount)),
    })

    expect(results).toEqual([{ type: 'void' }])
    expect(testState.sendChatSpy).toHaveBeenCalledTimes(entryCount)
    expect(testState.downloadFileSpy).toHaveBeenCalledTimes(1)

    const [downloadName, translatedPo] = testState.downloadFileSpy.mock.calls[0]
    expect(downloadName).toBe('translated.po')
    expect(translatedPo).toContain('msgid "line 0"')
    expect(translatedPo).toContain('msgid "line 124"')
    expect(translatedPo).toContain('"translated:line 124"')
    expect(translatedPo.match(/^msgstr ""$/gm)).toHaveLength(entryCount)
  })

  it.each(finalEntrySeparatorFixtures)('flushes the final PO entry $description', async ({ source, expected }) => {
    const results = await postChatFile({
      name: 'final-entry.po',
      data: textBytes(source),
    })

    expect(results).toEqual([{ type: 'void' }])
    expect(testState.sendChatSpy).toHaveBeenCalledTimes(1)
    expect(testState.downloadFileSpy).toHaveBeenCalledTimes(1)
    expect(testState.downloadFileSpy.mock.calls[0][1]).toContain(`"${expected}"`)
  })

  it.each(extractedNoteMarkerFixtures)(
    'removes $marker and sends its extracted note value to the model',
    async ({ marker, note }) => {
      const results = await postChatFile({
        name: 'notes.po',
        data: textBytes(`${marker} ${note}\nmsgid "source text"\nmsgstr ""`),
      })

      expect(results).toEqual([{ type: 'void' }])
      const userMessage = testState.databaseState.db.characters[0].chats[0].message.find(
        (message: any) => message.role === 'user',
      )
      expect(userMessage?.data).toBe(`Note: ${note}\nsource text`)
      expect(userMessage?.data).not.toContain(marker)
    },
  )

  it('exports the assistant adjacent to the exact accepted user message instead of the last row', async () => {
    testState.sendChatSpy.mockImplementationOnce(async () => {
      const messages = testState.databaseState.db.characters[0].chats[0].message
      messages.push({ role: 'char', data: 'owned translation' })
      messages.push({ role: 'user', data: 'unrelated source', chatId: 'unrelated-user' })
      messages.push({ role: 'char', data: 'unrelated last result', chatId: 'unrelated-assistant' })
      return true
    })

    const results = await postChatFile({
      name: 'exact-result.po',
      data: textBytes('msgid "source text"\nmsgstr ""'),
    })

    expect(results).toEqual([{ type: 'void' }])
    const translatedPo = testState.downloadFileSpy.mock.calls[0][1]
    expect(translatedPo).toContain('"owned translation"')
    expect(translatedPo).not.toContain('unrelated last result')
  })

  it('forces guarded hydration when the accepted assistant projection is missing', async () => {
    testState.sendChatSpy.mockResolvedValueOnce(true)
    testState.hydrateChatMessagesSpy.mockImplementationOnce(async () => {
      const messages = testState.databaseState.db.characters[0].chats[0].message
      const acceptedIndex = messages.findIndex((message: any) => message.role === 'user')
      messages.splice(acceptedIndex + 1, 0, { role: 'char', data: 'authoritative translation' })
    })

    const results = await postChatFile({
      name: 'reconciled-result.po',
      data: textBytes('msgid "source text"\nmsgstr ""'),
    })

    expect(testState.hydrateChatMessagesSpy).toHaveBeenCalledWith('chat-1', { force: true, strict: true })
    expect(results).toEqual([{ type: 'void' }])
    expect(testState.downloadFileSpy.mock.calls[0][1]).toContain('"authoritative translation"')
  })

  it('suppresses success and download when generation resolves false', async () => {
    testState.sendChatSpy.mockResolvedValueOnce(false)

    const results = await postChatFile({
      name: 'failed-generation.po',
      data: textBytes('msgid "source text"\nmsgstr ""'),
    })

    expect(results).toEqual([])
    expect(testState.hydrateChatMessagesSpy).not.toHaveBeenCalled()
    expect(testState.downloadFileSpy).not.toHaveBeenCalled()
  })

  it('suppresses success and download when no exact adjacent assistant exists after hydration', async () => {
    testState.sendChatSpy.mockImplementationOnce(async () => {
      const messages = testState.databaseState.db.characters[0].chats[0].message
      messages.push({ role: 'user', data: 'intervening source', chatId: 'intervening-user' })
      messages.push({ role: 'char', data: 'unowned translation', chatId: 'unowned-assistant' })
      return true
    })

    const results = await postChatFile({
      name: 'unowned-result.po',
      data: textBytes('msgid "source text"\nmsgstr ""'),
    })

    expect(testState.hydrateChatMessagesSpy).toHaveBeenCalledWith('chat-1', { force: true, strict: true })
    expect(results).toEqual([])
    expect(testState.downloadFileSpy).not.toHaveBeenCalled()
  })

  it('L52: postChatFile logs nothing for .po, PDF, XML, and text files', async () => {
    await postChatFile({
      name: 'dialogue.po',
      data: textBytes(makePoFile(2)),
    })
    await postChatFile({
      name: 'notes.txt',
      data: textBytes('alpha\nbeta\n'),
    })
    await postChatFile({
      name: 'nodes.xml',
      data: textBytes('<root><item>alpha</item><item>beta</item></root>'),
    })
    await postChatFile({
      name: 'paper.pdf',
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]),
    })

    expect(consoleLogSpy).not.toHaveBeenCalled()
  })

  it('L53: passes raw PDF bytes to pdfjs and preserves the text result shape', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])

    const results = await postChatFile({
      name: 'paper.pdf',
      data: pdfBytes,
    })

    expect(testState.getDocumentSpy).toHaveBeenCalledTimes(1)
    expect(testState.getDocumentSpy.mock.calls[0][0]).toMatchObject({
      data: pdfBytes,
    })
    expect(testState.getDocumentSpy.mock.calls[0][0].data).toBe(pdfBytes)
    expect(testState.addTextSpy).toHaveBeenCalledWith(['pdf extracted text'])
    expect(results).toEqual([
      {
        type: 'text',
        data: fileBlockBase64(['matched segment']),
        name: 'paper.pdf',
      },
    ])
  })

  it('L49: awaits async text ingestion so .txt content reaches the File block', async () => {
    let resolveAddTextStarted: () => void = () => {}
    let releaseAddText: () => void = () => {}
    const addTextStarted = new Promise<void>((resolve) => {
      resolveAddTextStarted = resolve
    })
    const addTextRelease = new Promise<void>((resolve) => {
      releaseAddText = resolve
    })
    let indexedTexts: string[] = []

    testState.addTextSpy.mockImplementation(async (texts: string[]) => {
      resolveAddTextStarted()
      await addTextRelease
      indexedTexts = [...texts]
    })
    testState.similaritySearchSpy.mockImplementation(async () => indexedTexts)

    const resultPromise = postChatFile({
      name: 'notes.txt',
      data: textBytes('alpha file content\n\nbeta file content\n'),
    })

    await addTextStarted
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(testState.similaritySearchSpy).not.toHaveBeenCalled()

    releaseAddText()
    const results = await resultPromise

    expect(testState.addTextSpy).toHaveBeenCalledWith(['alpha file content', 'beta file content'])
    expect(testState.similaritySearchSpy).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(1)
    const result = results?.[0]
    if (result?.type !== 'text') throw new Error('expected text attachment result')
    const fileBlock = Buffer.from(result.data, 'base64').toString('utf8')
    expect(fileBlock).toContain('<File>\n')
    expect(fileBlock).toContain('alpha file content')
    expect(fileBlock).toContain('beta file content')
    expect(result.name).toBe('notes.txt')
  })

  it('L36: .po transcript writes persist through scoped commands under the guard', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    const results = await postChatFile({
      name: 'dialogue.po',
      data: textBytes(makePoFile(2)),
    })

    expect(results).toEqual([{ type: 'void' }])
    expect(testState.sendChatSpy).toHaveBeenCalledTimes(2)
    const commands = await waitForMessageCommands(calls, 2)
    expect(commands.map((command) => command.body.message.data)).toEqual(['line 0', 'line 1'])
    expect(testState.downloadFileSpy).toHaveBeenCalledTimes(1)
    expect(testState.downloadFileSpy.mock.calls[0][1]).toContain('"translated:line 1"')
  })

  it('L36: .po translation stops without a result when send switches the active chat', async () => {
    testState.databaseState.db.characters[0].chats.push({
      id: 'chat-2',
      message: [],
    })
    testState.sendChatSpy.mockImplementationOnce(async () => {
      const currentChar = testState.databaseState.db.characters[0]
      const currentChat = currentChar.chats[currentChar.chatPage]
      const latestMessage = currentChat.message.at(-1)
      currentChat.message.push({
        role: 'char',
        data: `translated:${latestMessage?.data ?? ''}`,
      })
      currentChar.chatPage = 1
      return true
    })

    const results = await postChatFile({
      name: 'dialogue.po',
      data: textBytes(makePoFile(2)),
    })

    expect(results).toEqual([])
    expect(testState.sendChatSpy).toHaveBeenCalledTimes(1)
    expect(testState.databaseState.db.characters[0].chats[0].message.map((message: any) => message.data)).toEqual([
      'line 0',
      'translated:line 0',
    ])
    expect(testState.databaseState.db.characters[0].chats[1].message).toEqual([])
    expect(testState.downloadFileSpy).not.toHaveBeenCalled()
  })

  it('L36: picker cancellation and picker errors resolve without uncaught rejection', async () => {
    testState.selectMultipleFileSpy.mockResolvedValueOnce([])

    await expect(postChatFile('translate attachments')).resolves.toEqual([])

    testState.selectMultipleFileSpy.mockRejectedValueOnce(new Error('picker failed'))

    await expect(postChatFile('translate attachments')).resolves.toEqual([])
    expect(testState.selectMultipleFileSpy).toHaveBeenCalledTimes(2)
    expect(testState.sendChatSpy).not.toHaveBeenCalled()
    expect(testState.downloadFileSpy).not.toHaveBeenCalled()
  })

  it('L36: .po processing errors resolve without uncaught rejection', async () => {
    testState.sendChatSpy.mockRejectedValueOnce(new Error('send failed'))

    await expect(
      postChatFile({
        name: 'dialogue.po',
        data: textBytes(makePoFile(1)),
      }),
    ).resolves.toEqual([])

    expect(testState.sendChatSpy).toHaveBeenCalledTimes(1)
    expect(testState.downloadFileSpy).not.toHaveBeenCalled()
  })
})
