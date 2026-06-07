import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => {
  const DBState = {
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
      const currentChar = DBState.db.characters[0]
      const currentChat = currentChar.chats[currentChar.chatPage]
      const latestMessage = currentChat.message.at(-1)
      currentChat.message.push({
        role: 'char',
        data: `translated:${latestMessage?.data ?? ''}`,
      })
    })
  })

  let runTrustedWrite = <T>(callback: () => T): T => callback()

  return {
    DBState,
    selectedCharID,
    sendChatSpy,
    downloadFileSpy: vi.fn(),
    selectMultipleFileSpy: vi.fn(),
    postInlayAssetSpy: vi.fn(),
    addTextSpy: vi.fn(),
    similaritySearchSpy: vi.fn(),
    getDocumentSpy: vi.fn(),
    setRunTrustedWrite(fn: typeof runTrustedWrite) {
      runTrustedWrite = fn
    },
  }
})

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: vi.fn(),
  setDatabase: vi.fn(),
}))

vi.mock('src/ts/storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'multisend-test-token',
}))

vi.mock('src/ts/stores.svelte', () => ({
  DBState: testState.DBState,
  selectedCharID: testState.selectedCharID,
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
  selectMultipleFile: testState.selectMultipleFileSpy,
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
import {
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
} from '../../server/projectionWriteGuard.svelte'

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

async function waitForMessageCommands(
  calls: CapturedFetch[],
  expected: number,
): Promise<CapturedFetch[]> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const matches = calls.filter(
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
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

function resetChatState() {
  testState.DBState.db = {
    characters: [
      {
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
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
  stubCommandFetch()
  testState.setRunTrustedWrite(withTrustedServerProjectionWrite)
  resetChatState()
  testState.sendChatSpy.mockClear()
  testState.downloadFileSpy.mockReset()
  testState.selectMultipleFileSpy.mockReset()
  testState.postInlayAssetSpy.mockReset()
  testState.addTextSpy.mockReset()
  testState.similaritySearchSpy.mockReset()
  testState.similaritySearchSpy.mockResolvedValue(['matched segment'])
  testState.getDocumentSpy.mockReset()
  mockPdfDocument()
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  consoleLogSpy.mockRestore()
  setServerProjectionWriteGuardEnabled(false)
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

    expect(testState.addTextSpy).toHaveBeenCalledWith([
      'alpha file content',
      'beta file content',
    ])
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
    setServerProjectionWriteGuardEnabled(true)
    expect(() => {
      testState.DBState.db.characters[0].chats[0].message.push({ role: 'user', data: 'raw' })
    }).toThrow(/read-only server projection/)

    const results = await postChatFile({
      name: 'dialogue.po',
      data: textBytes(makePoFile(2)),
    })

    expect(results).toEqual([{ type: 'void' }])
    expect(testState.sendChatSpy).toHaveBeenCalledTimes(2)
    const commands = await waitForMessageCommands(calls, 2)
    expect(commands[0].body.messages.map((message: any) => message.data)).toEqual(['line 0'])
    expect(commands[1].body.messages.map((message: any) => message.data)).toEqual([
      'line 0',
      'translated:line 0',
      'line 1',
    ])
    expect(testState.downloadFileSpy).toHaveBeenCalledTimes(1)
    expect(testState.downloadFileSpy.mock.calls[0][1]).toContain('"translated:line 1"')
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
