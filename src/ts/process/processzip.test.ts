import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fflate from 'fflate'

const MAX_ASSET_SIZE_BYTES = 50 * 1024 * 1024
const ONE_MIB = 1024 * 1024

const globalApiState = vi.hoisted(() => ({
  saveAsset: vi.fn(async () => 'saved-hash-signal'),
  saveAssets: vi.fn(async (assets: readonly { data: Uint8Array }[]) =>
    assets.map((asset, index) => `saved-${index}-${asset.data.byteLength}-${asset.data[0] ?? 0}`),
  ),
  appendable: {
    nextId: 0,
    instances: [] as number[],
    appendCalls: [] as Array<{ id: number; byteLength: number; totalAfter: number }>,
    bufferReads: [] as Array<{ id: number; byteLength: number }>,
  },
}))

vi.mock('../globalApi.svelte', () => {
  class TestAppendableBuffer {
    deapended = 0
    readonly id: number
    #chunks: Uint8Array[] = []
    #byteLength = 0

    constructor() {
      this.id = ++globalApiState.appendable.nextId
      globalApiState.appendable.instances.push(this.id)
    }

    append(data: Uint8Array) {
      this.#chunks.push(data)
      this.#byteLength += data.byteLength
      globalApiState.appendable.appendCalls.push({
        id: this.id,
        byteLength: data.byteLength,
        totalAfter: this.#byteLength,
      })
    }

    get buffer(): Uint8Array {
      globalApiState.appendable.bufferReads.push({
        id: this.id,
        byteLength: this.#byteLength,
      })
      const output = new Uint8Array(this.#byteLength)
      let offset = 0
      for (const chunk of this.#chunks) {
        output.set(chunk, offset)
        offset += chunk.byteLength
      }
      return output
    }

    deappend(length: number) {
      const remaining = this.buffer.slice(length)
      this.#chunks = [remaining]
      this.#byteLength = remaining.byteLength
      this.deapended += length
    }

    slice(start: number, end: number) {
      return this.buffer.slice(start - this.deapended, end - this.deapended)
    }

    length() {
      return this.#byteLength + this.deapended
    }

    clear() {
      this.#chunks = []
      this.#byteLength = 0
      this.deapended = 0
    }
  }

  return {
    AppendableBuffer: TestAppendableBuffer,
    SERVER_ASSET_EXISTS_MAX_IDS: 1024,
    saveAsset: globalApiState.saveAsset,
    saveAssets: globalApiState.saveAssets,
  }
})

vi.mock('../alert', () => ({
  alertStore: {
    set: vi.fn(),
  },
}))

vi.mock('../characterCards', () => ({
  hubURL: 'https://example.invalid',
}))

vi.mock('../parser/parser.svelte', () => ({
  hasher: vi.fn(async (data: Uint8Array) => `hash-${data.byteLength}`),
}))

vi.mock('../util', () => ({
  asBuffer: (data: Uint8Array) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
}))

import { CharXImporter, CharXWriter } from './processzip'

const encoder = new TextEncoder()

function resetMocks() {
  globalApiState.saveAsset.mockClear()
  globalApiState.saveAssets.mockClear()
  globalApiState.saveAssets.mockImplementation(async (assets: readonly { data: Uint8Array }[]) =>
    assets.map((asset, index) => `saved-${index}-${asset.data.byteLength}-${asset.data[0] ?? 0}`),
  )
  globalApiState.appendable.nextId = 0
  globalApiState.appendable.instances = []
  globalApiState.appendable.appendCalls = []
  globalApiState.appendable.bufferReads = []
}

function writeUint16LE(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
}

function writeUint32LE(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
  target[offset + 2] = (value >>> 16) & 0xff
  target[offset + 3] = (value >>> 24) & 0xff
}

function storedLocalFile(
  name: string,
  data: Uint8Array,
  originalSize = data.byteLength,
  compressedSize = data.byteLength,
) {
  const nameBytes = encoder.encode(name)
  const output = new Uint8Array(30 + nameBytes.byteLength + data.byteLength)
  writeUint32LE(output, 0, 0x04034b50)
  writeUint16LE(output, 4, 20)
  writeUint16LE(output, 6, 0)
  writeUint16LE(output, 8, 0)
  writeUint32LE(output, 14, 0)
  writeUint32LE(output, 18, compressedSize)
  writeUint32LE(output, 22, originalSize)
  writeUint16LE(output, 26, nameBytes.byteLength)
  writeUint16LE(output, 28, 0)
  output.set(nameBytes, 30)
  output.set(data, 30 + nameBytes.byteLength)
  return output
}

function concatBytes(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function streamingZipChunks(entries: Array<{ name: string; chunks: Uint8Array[] }>) {
  const output: Uint8Array[] = []
  const zip = new fflate.Zip()
  zip.ondata = (err, data) => {
    if (err) {
      throw err
    }
    if (data.byteLength > 0) {
      output.push(data)
    }
  }

  for (const entry of entries) {
    const file = new fflate.ZipPassThrough(entry.name)
    zip.add(file)
    if (entry.chunks.length === 0) {
      file.push(new Uint8Array(), true)
      continue
    }
    for (let i = 0; i < entry.chunks.length; i++) {
      file.push(entry.chunks[i], i === entry.chunks.length - 1)
    }
  }

  zip.end()
  return output
}

function streamFromChunks(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })
}

function repeatedChunks(count: number, size = ONE_MIB) {
  const chunk = new Uint8Array(size)
  chunk.fill(7)
  return Array.from({ length: count }, () => chunk)
}

function appendedTotalsByBuffer() {
  const totals = new Map<number, number>()
  for (const call of globalApiState.appendable.appendCalls) {
    totals.set(call.id, (totals.get(call.id) ?? 0) + call.byteLength)
  }
  return totals
}

beforeEach(resetMocks)

describe('CharXImporter stream caps', () => {
  it('M21: skips a known oversized CharX asset before allocating a buffer', async () => {
    const cardJson = '{"spec":"chara_card_v3","data":{"name":"Known"}}'
    const zipData = concatBytes([
      storedLocalFile('assets/huge.bin', new Uint8Array(), MAX_ASSET_SIZE_BYTES + 1, 0),
      storedLocalFile('card.json', encoder.encode(cardJson)),
    ])
    const importer = new CharXImporter()

    await importer.parse(zipData)
    await importer.done()

    expect(importer.excludedFiles).toEqual(['assets/huge.bin'])
    expect(importer.cardData).toBe(cardJson)
    expect(globalApiState.appendable.instances).toHaveLength(1)
    expect(appendedTotalsByBuffer().get(globalApiState.appendable.instances[0])).toBe(
      encoder.encode(cardJson).byteLength,
    )
    expect(globalApiState.saveAssets).not.toHaveBeenCalled()
  })

  it('M21: abandons an unknown-size CharX asset mid-stream and discards partial bytes', async () => {
    const oversizedChunkCount = 52
    const chunks = streamingZipChunks([
      {
        name: 'assets/huge.bin',
        chunks: repeatedChunks(oversizedChunkCount),
      },
    ])
    const importer = new CharXImporter()

    await importer.parse(streamFromChunks(chunks))
    await importer.done()

    const appendedTotals = [...appendedTotalsByBuffer().values()]
    expect(importer.excludedFiles).toEqual(['assets/huge.bin'])
    expect(importer.assets).toEqual({})
    expect(Object.keys(importer.assetBuffers)).toEqual([])
    expect(globalApiState.saveAssets).not.toHaveBeenCalled()
    expect(appendedTotals).toHaveLength(1)
    expect(appendedTotals[0]).toBeLessThan(oversizedChunkCount * ONE_MIB)
    expect(appendedTotals[0]).toBeLessThanOrEqual(MAX_ASSET_SIZE_BYTES)
    expect(globalApiState.appendable.bufferReads).toEqual([])
  }, 15_000)

  it('M21: ignores completion callbacks after terminating an oversized CharX asset', async () => {
    const afterAsset = new Uint8Array([9, 8, 7, 6])
    const chunks = streamingZipChunks([
      {
        name: 'assets/huge.bin',
        chunks: repeatedChunks(52),
      },
      {
        name: 'assets/after.png',
        chunks: [afterAsset],
      },
    ])
    const importer = new CharXImporter()

    await importer.parse(streamFromChunks(chunks))
    await importer.done()

    const appendedTotals = appendedTotalsByBuffer()
    const oversizedBufferId = [...appendedTotals.entries()].find(([, total]) => total > afterAsset.byteLength)?.[0]
    expect(oversizedBufferId).toBeDefined()
    expect(importer.excludedFiles).toEqual(['assets/huge.bin'])
    expect(importer.assets).toEqual({
      'assets/after.png': 'saved-0-4-9',
    })
    expect(globalApiState.saveAssets).toHaveBeenCalledTimes(1)
    expect(globalApiState.saveAssets.mock.calls[0][0]).toEqual([{ data: afterAsset }])
    expect(globalApiState.appendable.bufferReads.map((read) => read.id)).not.toContain(oversizedBufferId)
  }, 15_000)

  it('M21: preserves representative valid CharX import output', async () => {
    const cardJson = JSON.stringify({
      spec: 'chara_card_v3',
      data: {
        name: 'Valid',
        assets: [{ uri: '__asset:assets/main.png' }],
      },
    })
    const moduleData = new Uint8Array([4, 5, 6, 7])
    const mainAsset = new Uint8Array([1, 2, 3, 4])
    const extraAsset = new Uint8Array([9, 10, 11])
    const zipData = fflate.zipSync(
      {
        'card.json': encoder.encode(cardJson),
        'module.risum': moduleData,
        'ignored.json': encoder.encode('{"ignored":true}'),
        'assets/main.png': mainAsset,
        'assets/voice.bin': extraAsset,
      },
      { level: 0 },
    )
    const importer = new CharXImporter()

    await importer.parse(zipData)
    await importer.done()

    expect(importer.excludedFiles).toEqual([])
    expect(importer.cardData).toBe(cardJson)
    expect(importer.moduleData).toEqual(moduleData)
    expect(globalApiState.saveAssets).toHaveBeenCalledTimes(1)
    expect(globalApiState.saveAssets.mock.calls[0][0]).toEqual([{ data: mainAsset }, { data: extraAsset }])
    expect(importer.assets).toEqual({
      'assets/main.png': 'saved-0-4-1',
      'assets/voice.bin': 'saved-1-3-9',
    })
  })

  it('batches high-asset-count CharX imports at the server existence-probe capacity', async () => {
    const assetCount = 4_361
    const entries = Object.fromEntries(
      Array.from({ length: assetCount }, (_, index) => [`assets/${index}.png`, new Uint8Array([index & 0xff])]),
    )
    const importer = new CharXImporter()

    await importer.parse(fflate.zipSync(entries, { level: 0 }))
    await importer.done()

    expect(globalApiState.saveAssets.mock.calls.map(([assets]) => assets.length)).toEqual([1024, 1024, 1024, 1024, 265])
    expect(Object.keys(importer.assets)).toHaveLength(assetCount)
  })
})

describe('CharXWriter media cleanup', () => {
  it('L51: writeJpeg revokes the temporary object URL after decode and append', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:charx-jpeg')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const originalCreateElement = document.createElement.bind(document)
    const drawImage = vi.fn()
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          getContext: () => ({ drawImage }),
          toBlob: (cb: BlobCallback) => cb(new Blob(['jpeg-out'], { type: 'image/jpeg' })),
        } as unknown as HTMLCanvasElement
      }
      if (tag === 'img') {
        return {
          decode: vi.fn(async () => {}),
          height: 24,
          src: '',
          width: 32,
        } as unknown as HTMLImageElement
      }
      return originalCreateElement(tag)
    })
    const writer = new CharXWriter({
      buf: undefined as never,
      close: vi.fn(async () => {}),
      write: vi.fn(async () => {}),
    })

    try {
      await writer.writeJpeg(new Uint8Array([1, 2, 3]))

      expect(drawImage).toHaveBeenCalledTimes(1)
      expect(createUrl).toHaveBeenCalledTimes(1)
      expect(revokeUrl).toHaveBeenCalledWith('blob:charx-jpeg')
    } finally {
      createElement.mockRestore()
      createUrl.mockRestore()
      revokeUrl.mockRestore()
    }
  })
})
