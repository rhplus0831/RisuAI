import * as fflate from 'fflate'
import { RISUSAVE_BLOCK_HEADER, classifyRisuSaveEnvelope, concatBytes } from './legacyEnvelopeCodec.js'
import { gunzipBounded } from './boundedInflate.js'
import { assertExpandedSizeWithinLimit, type ExpandedSizeLimitOptions } from './importLimits.js'

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

export type RisuSaveUnsupportedReferenceKind = 'remote' | 'cache-only'

export interface EncodableRisuSaveBlock {
  name: string
  type: RisuSaveBlockType
  data: string
  compression?: boolean
}

export interface DecodedRisuSaveBlock {
  name: string
  type: RisuSaveBlockType
  compression: boolean
  byteLength: number
  content: string | null
  unsupportedReference?: RisuSaveUnsupportedReferenceKind
}

export interface RisuSaveBlockDecodeResult {
  blocks: DecodedRisuSaveBlock[]
  unsupportedReferences: Array<{
    name: string
    type: RisuSaveBlockType.REMOTE
    kind: RisuSaveUnsupportedReferenceKind
  }>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const RISUSAVE_BLOCK_NAME_MAX_BYTES = 255
export const RISUSAVE_BLOCK_MAX_COUNT = 65_536
// A valid export normally has one directory entry per resource block. This
// generous ceiling prevents a small ROOT block from expanding into an
// unbounded synthetic block list while remaining far above realistic saves.
export const RISUSAVE_BLOCK_DIRECTORY_MAX_ENTRIES = 65_536

export function encodeRisuSaveBlock(block: EncodableRisuSaveBlock): Uint8Array {
  const name = encoder.encode(block.name)
  if (name.length > RISUSAVE_BLOCK_NAME_MAX_BYTES) {
    throw new Error(`RISUSAVE block name is too long: ${block.name}`)
  }
  const content = encoder.encode(block.data)
  const blockData = block.compression ? fflate.gzipSync(content) : content
  const result = new Uint8Array(2 + 1 + name.length + 4 + blockData.length)
  result[0] = block.type
  result[1] = block.compression ? 1 : 0
  result[2] = name.length
  result.set(name, 3)
  new DataView(result.buffer, result.byteOffset + 3 + name.length, 4).setUint32(0, blockData.length, true)
  result.set(blockData, 7 + name.length)
  return result
}

export function encodeRisuSaveBlockEnvelope(blocks: EncodableRisuSaveBlock[]): Uint8Array {
  return concatBytes([RISUSAVE_BLOCK_HEADER, ...blocks.map((block) => encodeRisuSaveBlock(block))])
}

export function decodeRisuSaveBlockEnvelope(
  data: Uint8Array,
  options: ExpandedSizeLimitOptions = {},
): RisuSaveBlockDecodeResult {
  if (classifyRisuSaveEnvelope(data) !== 'risusave-blocks') {
    throw new Error('Unsupported RISUSAVE block envelope')
  }

  const blocks: DecodedRisuSaveBlock[] = []
  const loadedNames = new Set<string>()
  let offset = RISUSAVE_BLOCK_HEADER.length
  let expandedBytes = 0
  let blockCount = 0

  while (offset < data.length) {
    blockCount += 1
    if (blockCount > RISUSAVE_BLOCK_MAX_COUNT) {
      throw new Error(`RISUSAVE envelope exceeds ${RISUSAVE_BLOCK_MAX_COUNT} blocks`)
    }
    if (offset + 7 > data.length) {
      throw new Error(`Malformed RISUSAVE block header at offset ${offset}`)
    }

    const type = data[offset] as RisuSaveBlockType
    const compressionMarker = data[offset + 1]
    if (compressionMarker !== 0 && compressionMarker !== 1) {
      throw new Error(`Invalid RISUSAVE block compression marker at offset ${offset + 1}`)
    }
    const compression = compressionMarker === 1
    const nameLength = data[offset + 2]
    offset += 3

    if (offset + nameLength + 4 > data.length) {
      throw new Error(`Malformed RISUSAVE block name at offset ${offset}`)
    }

    const name = decoder.decode(data.subarray(offset, offset + nameLength))
    offset += nameLength
    if (loadedNames.has(name)) {
      throw new Error(`RISUSAVE envelope contains a duplicate block name: ${name}`)
    }

    const byteLength = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true)
    offset += 4
    if (offset + byteLength > data.length) {
      throw new Error(`Malformed RISUSAVE block data for ${name}`)
    }

    const rawBlockData = data.subarray(offset, offset + byteLength)
    offset += byteLength
    // Streaming bounded inflate each compressed block expands
    // against the budget the previous blocks left over, so the cumulative cap
    // is enforced *while* a block inflates rather than after it materialized.
    const remainingBudget: ExpandedSizeLimitOptions =
      options.maxExpandedBytes !== undefined ? { maxExpandedBytes: options.maxExpandedBytes - expandedBytes } : {}
    const contentBytes = compression ? gunzipBounded(rawBlockData, remainingBudget) : rawBlockData
    expandedBytes += contentBytes.byteLength
    assertExpandedSizeWithinLimit(expandedBytes, options)

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

  appendCacheOnlyDirectoryReferences(blocks, loadedNames)

  return {
    blocks,
    unsupportedReferences: blocks
      .filter(
        (
          block,
        ): block is DecodedRisuSaveBlock & {
          type: RisuSaveBlockType.REMOTE
          unsupportedReference: RisuSaveUnsupportedReferenceKind
        } => block.type === RisuSaveBlockType.REMOTE && !!block.unsupportedReference,
      )
      .map((block) => ({
        name: block.name,
        type: block.type,
        kind: block.unsupportedReference,
      })),
  }
}

function appendCacheOnlyDirectoryReferences(blocks: DecodedRisuSaveBlock[], loadedNames: Set<string>): void {
  const root = blocks.find((block) => block.type === RisuSaveBlockType.ROOT && block.content)
  if (!root?.content) return

  const parsedRoot = JSON.parse(root.content) as { __directory?: unknown }
  if (!Array.isArray(parsedRoot.__directory)) return
  if (parsedRoot.__directory.length > RISUSAVE_BLOCK_DIRECTORY_MAX_ENTRIES) {
    throw new Error(`RISUSAVE block directory exceeds ${RISUSAVE_BLOCK_DIRECTORY_MAX_ENTRIES} entries`)
  }

  for (const name of parsedRoot.__directory) {
    if (typeof name !== 'string' || loadedNames.has(name)) continue
    if (encoder.encode(name).byteLength > RISUSAVE_BLOCK_NAME_MAX_BYTES) {
      throw new Error(`RISUSAVE directory block name exceeds ${RISUSAVE_BLOCK_NAME_MAX_BYTES} bytes`)
    }
    loadedNames.add(name)
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
