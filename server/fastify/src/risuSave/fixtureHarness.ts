import * as fflate from 'fflate'
import {
  RISUSAVE_BLOCK_HEADER,
  classifyRisuSaveEnvelope,
  concatBytes,
  decodeLegacyRisuSaveEnvelope,
  encodeLegacyRisuSaveEnvelope,
  type LegacyRisuSaveEnvelopeKind,
  type RisuSaveEnvelopeKind,
} from './legacyEnvelopeCodec.js'

export {
  RISUSAVE_BLOCK_HEADER,
  classifyRisuSaveEnvelope,
  decodeLegacyRisuSaveEnvelope,
  encodeLegacyRisuSaveEnvelope,
  type LegacyRisuSaveEnvelopeKind,
  type RisuSaveEnvelopeKind,
}

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

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeLegacyFixtureEnvelope(
  payload: unknown,
  kind: LegacyRisuSaveEnvelopeKind,
): Uint8Array {
  return encodeLegacyRisuSaveEnvelope(payload, kind)
}

export function decodeLegacyFixtureEnvelope(data: Uint8Array): unknown {
  return decodeLegacyRisuSaveEnvelope(data)
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
