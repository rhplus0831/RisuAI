import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RPCToolCallImageAudioContent } from './mcplib'

const pdfMocks = vi.hoisted(() => ({
  convertPdfToImages: vi.fn(),
}))

vi.mock('src/ts/process/dynamicutils/pdf.js', () => ({
  convertPdfToImages: pdfMocks.convertPdfToImages,
}))

import {
  clearFileSystemDirectoryHandleForTests,
  FILESYSTEM_BASE64_ENCODE_CHUNK_BYTES,
  FILESYSTEM_PDF_MAX_INPUT_BYTES,
  FILESYSTEM_PDF_MAX_PAGES,
  FILESYSTEM_SEARCH_CONTENT_MAX_FILE_BYTES,
  FileSystemClient,
} from './filesystemclient'

type TestFileHandle = FileSystemFileHandle & {
  getFile: ReturnType<typeof vi.fn>
}

type TestDirectoryHandle = FileSystemDirectoryHandle & {
  getFileHandle: ReturnType<typeof vi.fn>
  getDirectoryHandle: ReturnType<typeof vi.fn>
}

type TestEntry = File | FileSystemDirectoryHandle

function fileHandle(file: File): TestFileHandle {
  return {
    kind: 'file',
    name: file.name,
    getFile: vi.fn(async () => file),
  } as unknown as TestFileHandle
}

function directoryHandle(entries: Record<string, TestEntry>): TestDirectoryHandle {
  const handle = {
    kind: 'directory',
    name: 'workspace',
    getFileHandle: vi.fn(async (name: string) => {
      const entry = entries[name]
      if (!entry || (entry as FileSystemDirectoryHandle).kind === 'directory') {
        throw new DOMException(`File not found: ${name}`, 'NotFoundError')
      }
      return fileHandle(entry as File)
    }),
    getDirectoryHandle: vi.fn(async (name: string) => {
      const entry = entries[name]
      if (!entry || (entry as FileSystemDirectoryHandle).kind !== 'directory') {
        throw new DOMException(`Directory not found: ${name}`, 'NotFoundError')
      }
      return entry as FileSystemDirectoryHandle
    }),
    entries: async function* () {
      for (const [name, entry] of Object.entries(entries)) {
        if ((entry as FileSystemDirectoryHandle).kind === 'directory') {
          yield [name, entry as FileSystemDirectoryHandle] as [string, FileSystemHandle]
        } else {
          yield [name, fileHandle(entry as File)] as [string, FileSystemHandle]
        }
      }
    },
  }
  return handle as unknown as TestDirectoryHandle
}

function clientWithDirectory(entries: Record<string, TestEntry>) {
  const client = new FileSystemClient()
  ;(client as unknown as { directoryHandle: FileSystemDirectoryHandle }).directoryHandle = directoryHandle(entries)
  return client
}

type ImageToolContent = RPCToolCallImageAudioContent & { type: 'image' }

function bytes(length: number): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(length)
  for (let i = 0; i < output.length; i += 1) {
    output[i] = i % 251
  }
  return output
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

function textContent(result: Awaited<ReturnType<FileSystemClient['callTool']>>) {
  return result
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
}

beforeEach(() => {
  clearFileSystemDirectoryHandleForTests()
  pdfMocks.convertPdfToImages.mockReset()
})

afterEach(() => {
  clearFileSystemDirectoryHandleForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('FileSystem MCP read caps', () => {
  it('v4-L35: encodes capped base64 reads in chunks instead of spreading the whole file', async () => {
    const payload = bytes(FILESYSTEM_BASE64_ENCODE_CHUNK_BYTES * 4 + 10)
    const readLimit = FILESYSTEM_BASE64_ENCODE_CHUNK_BYTES * 3 + 9
    const btoaChunks: number[] = []
    vi.stubGlobal(
      'btoa',
      vi.fn((value: string) => {
        btoaChunks.push(value.length)
        expect(value.length).toBeLessThanOrEqual(FILESYSTEM_BASE64_ENCODE_CHUNK_BYTES)
        return Buffer.from(value, 'binary').toString('base64')
      }),
    )

    const client = clientWithDirectory({
      'large.png': new File([payload], 'large.png', { type: 'image/png' }),
    })
    const result = await client.callTool('fs_read_file', {
      path: 'large.png',
      limit: readLimit,
    })

    const image = result.find((item): item is ImageToolContent => item.type === 'image')
    expect(image?.type).toBe('image')
    expect(base64ToBytes(image!.data)).toEqual(payload.slice(0, readLimit))
    expect(btoaChunks.length).toBeGreaterThan(1)
    expect(Math.max(...btoaChunks)).toBe(FILESYSTEM_BASE64_ENCODE_CHUNK_BYTES)
    expect(textContent(result)).toContain('Content truncated')
  })

  it('L48: passes PDF page/output caps and honors the requested limit', async () => {
    const controller = new AbortController()
    pdfMocks.convertPdfToImages.mockResolvedValue([
      'data:image/jpeg;base64,' + 'a'.repeat(40),
      'data:image/jpeg;base64,' + 'b'.repeat(40),
    ])
    const client = clientWithDirectory({
      'report.pdf': new File([new Uint8Array([1, 2, 3, 4])], 'report.pdf', {
        type: 'application/pdf',
      }),
    })

    const result = await client.callTool('fs_read_file', {
      path: 'report.pdf',
      limit: 80,
      signal: controller.signal,
    })

    expect(pdfMocks.convertPdfToImages).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.objectContaining({
        maxPages: FILESYSTEM_PDF_MAX_PAGES,
        maxOutputBytes: 80,
        signal: controller.signal,
      }),
    )
    const images = result.filter((item) => item.type === 'image')
    expect(images).toHaveLength(1)
    expect(textContent(result)).toContain('PDF rendering capped')
  })

  it('L48: rejects PDFs above the input byte cap before reading bytes', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0))
    const largePdf = {
      name: 'huge.pdf',
      type: 'application/pdf',
      size: FILESYSTEM_PDF_MAX_INPUT_BYTES + 1,
      arrayBuffer,
    } as unknown as File
    const client = clientWithDirectory({
      'huge.pdf': largePdf,
    })

    const result = await client.callTool('fs_read_file', { path: 'huge.pdf' })

    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(pdfMocks.convertPdfToImages).not.toHaveBeenCalled()
    expect(textContent(result)).toContain('PDF is too large to render')
  })

  it('L48: honors AbortSignal before starting PDF byte reads', async () => {
    const controller = new AbortController()
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(4))
    const pdfFile = {
      name: 'cancel.pdf',
      type: 'application/pdf',
      size: 4,
      arrayBuffer,
    } as unknown as File
    const client = new FileSystemClient()
    const handle = {
      kind: 'directory',
      name: 'workspace',
      getFileHandle: vi.fn(async () => ({
        kind: 'file',
        name: 'cancel.pdf',
        getFile: vi.fn(async () => {
          controller.abort(new Error('cancelled pdf read'))
          return pdfFile
        }),
      })),
    } as unknown as FileSystemDirectoryHandle
    ;(client as unknown as { directoryHandle: FileSystemDirectoryHandle }).directoryHandle = handle

    const result = await client.callTool('fs_read_file', {
      path: 'cancel.pdf',
      signal: controller.signal,
    })

    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(pdfMocks.convertPdfToImages).not.toHaveBeenCalled()
    expect(textContent(result)).toContain('cancelled pdf read')
  })

  it('v4-L35: skips oversized files before content-search text reads', async () => {
    const largeText = vi.fn(async () => 'needle')
    const smallText = vi.fn(async () => 'needle')
    const largeFile = {
      name: 'large.txt',
      type: 'text/plain',
      size: FILESYSTEM_SEARCH_CONTENT_MAX_FILE_BYTES + 1,
      text: largeText,
    } as unknown as File
    const smallFile = {
      name: 'small.txt',
      type: 'text/plain',
      size: 32,
      text: smallText,
    } as unknown as File
    const client = clientWithDirectory({
      'large.txt': largeFile,
      'small.txt': smallFile,
    })

    const result = await client.callTool('fs_search_files', { content: 'needle' })
    const text = textContent(result)

    expect(largeText).not.toHaveBeenCalled()
    expect(smallText).toHaveBeenCalledTimes(1)
    expect(text).toContain('Found 1 matches')
    expect(text).toContain('small.txt')
    expect(text).toContain('Skipped 1 file(s) larger than')
    expect(text).toContain('large.txt')
  })
})
