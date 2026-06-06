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
    const currentChar = DBState.db.characters[0]
    const currentChat = currentChar.chats[currentChar.chatPage]
    const latestMessage = currentChat.message.at(-1)
    currentChat.message.push({
      role: 'char',
      data: `translated:${latestMessage?.data ?? ''}`,
    })
  })

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
  }
})

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: vi.fn(),
  setDatabase: vi.fn(),
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

let consoleLogSpy: ReturnType<typeof vi.spyOn>

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
})
