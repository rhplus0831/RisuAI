import * as fflate from 'fflate'
import { Packr, Unpackr } from 'msgpackr/index-no-eval'

export type RisuSaveEnvelopeKind =
  | 'legacy-raw'
  | 'legacy-compressed'
  | 'legacy-stream'
  | 'risusave-blocks'

export const LEGACY_RAW_HEADER = Uint8Array.from([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 7])
export const LEGACY_COMPRESSED_HEADER = Uint8Array.from([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8])
export const LEGACY_STREAM_HEADER = Uint8Array.from([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 9])
export const RISUSAVE_BLOCK_HEADER = new TextEncoder().encode('RISUSAVE\0')

export enum RisuSaveBlockType {
  CONFIG = 0,
  ROOT = 1,
  CHARACTER_WITH_CHAT = 2,
  CHAT = 3,
  BOTPRESET = 4,
  MODULES = 5,
  REMOTE = 6,
  CHARACTER_WITHOUT_CHAT = 7,
  ROOT_COMPONENT = 8,
  PLUGINS = 9,
  LOADOUTS = 10,
  PLUGIN_STORAGE = 11,
}

export interface RisuSaveBlockFixture {
  name: string
  type: RisuSaveBlockType
  data: string
  compression?: boolean
}

export interface InspectedRisuSaveBlock {
  name: string
  type: RisuSaveBlockType
  compression: boolean
  byteLength: number
  content: string | null
  unsupportedReference?: 'remote' | 'cache-only'
}

const packr = new Packr({ useRecords: false })
const unpackr = new Unpackr({
  int64AsType: 'number',
  useRecords: false,
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i += 1) {
    if (data[i] !== prefix[i]) return false
  }
  return true
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

export function classifyRisuSaveEnvelope(data: Uint8Array): RisuSaveEnvelopeKind | 'unknown' {
  if (startsWith(data, LEGACY_RAW_HEADER)) return 'legacy-raw'
  if (startsWith(data, LEGACY_COMPRESSED_HEADER)) return 'legacy-compressed'
  if (startsWith(data, LEGACY_STREAM_HEADER)) return 'legacy-stream'
  if (startsWith(data, RISUSAVE_BLOCK_HEADER)) return 'risusave-blocks'
  return 'unknown'
}

export function encodeLegacyFixtureEnvelope(
  payload: unknown,
  kind: Exclude<RisuSaveEnvelopeKind, 'risusave-blocks'>,
): Uint8Array {
  const encoded = packr.encode(payload)
  if (kind === 'legacy-raw') {
    return concatBytes([LEGACY_RAW_HEADER, encoded])
  }
  if (kind === 'legacy-compressed') {
    return concatBytes([LEGACY_COMPRESSED_HEADER, fflate.compressSync(encoded)])
  }
  return concatBytes([LEGACY_STREAM_HEADER, fflate.gzipSync(encoded)])
}

export function decodeLegacyFixtureEnvelope(data: Uint8Array): unknown {
  const kind = classifyRisuSaveEnvelope(data)
  if (kind === 'legacy-raw') {
    return unpackr.decode(data.subarray(LEGACY_RAW_HEADER.length))
  }
  if (kind === 'legacy-compressed') {
    return unpackr.decode(fflate.decompressSync(data.subarray(LEGACY_COMPRESSED_HEADER.length)))
  }
  if (kind === 'legacy-stream') {
    return unpackr.decode(fflate.gunzipSync(data.subarray(LEGACY_STREAM_HEADER.length)))
  }
  throw new Error(`Unsupported legacy fixture envelope: ${kind}`)
}

export function encodeRisuSaveBlockFixture(block: RisuSaveBlockFixture): Uint8Array {
  const name = encoder.encode(block.name)
  if (name.length > 255) {
    throw new Error(`RISUSAVE block name is too long: ${block.name}`)
  }
  const content = encoder.encode(block.data)
  const data = block.compression ? fflate.gzipSync(content) : content
  const result = new Uint8Array(2 + 1 + name.length + 4 + data.length)
  result[0] = block.type
  result[1] = block.compression ? 1 : 0
  result[2] = name.length
  result.set(name, 3)
  new DataView(result.buffer, result.byteOffset + 3 + name.length, 4).setUint32(
    0,
    data.length,
    true,
  )
  result.set(data, 7 + name.length)
  return result
}

export function encodeRisuSaveBlockFixtureEnvelope(blocks: RisuSaveBlockFixture[]): Uint8Array {
  return concatBytes([
    RISUSAVE_BLOCK_HEADER,
    ...blocks.map((block) => encodeRisuSaveBlockFixture(block)),
  ])
}

export function inspectRisuSaveBlockFixtureEnvelope(data: Uint8Array): InspectedRisuSaveBlock[] {
  if (classifyRisuSaveEnvelope(data) !== 'risusave-blocks') {
    throw new Error('Fixture is not a RISUSAVE block envelope')
  }
  const blocks: InspectedRisuSaveBlock[] = []
  let offset = RISUSAVE_BLOCK_HEADER.length
  const loadedNames = new Set<string>()

  while (offset < data.length) {
    if (offset + 7 > data.length) {
      throw new Error(`Malformed RISUSAVE block header at offset ${offset}`)
    }
    const type = data[offset] as RisuSaveBlockType
    const compression = data[offset + 1] === 1
    const nameLength = data[offset + 2]
    offset += 3

    if (offset + nameLength + 4 > data.length) {
      throw new Error(`Malformed RISUSAVE block name at offset ${offset}`)
    }
    const name = decoder.decode(data.subarray(offset, offset + nameLength))
    offset += nameLength

    const byteLength = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true)
    offset += 4
    if (offset + byteLength > data.length) {
      throw new Error(`Malformed RISUSAVE block data for ${name}`)
    }
    const blockData = data.subarray(offset, offset + byteLength)
    offset += byteLength

    const contentBytes = compression ? fflate.gunzipSync(blockData) : blockData
    loadedNames.add(name)
    blocks.push({
      name,
      type,
      compression,
      byteLength,
      content: decoder.decode(contentBytes),
      unsupportedReference: type === RisuSaveBlockType.REMOTE ? 'remote' : undefined,
    })
  }

  const root = blocks.find((block) => block.type === RisuSaveBlockType.ROOT && block.content)
  if (root?.content) {
    const parsedRoot = JSON.parse(root.content) as { __directory?: unknown }
    if (Array.isArray(parsedRoot.__directory)) {
      for (const name of parsedRoot.__directory) {
        if (typeof name === 'string' && !loadedNames.has(name)) {
          blocks.push({
            name,
            type: RisuSaveBlockType.REMOTE,
            compression: false,
            byteLength: 0,
            content: null,
            unsupportedReference: 'cache-only',
          })
        }
      }
    }
  }

  return blocks
}
