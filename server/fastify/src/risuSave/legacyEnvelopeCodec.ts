import * as fflate from 'fflate'
import { Unpackr } from 'msgpackr/index-no-eval'

export type RisuSaveEnvelopeKind =
  | 'legacy-raw'
  | 'legacy-compressed'
  | 'legacy-stream'
  | 'risusave-blocks'

export type LegacyRisuSaveEnvelopeKind = Exclude<RisuSaveEnvelopeKind, 'risusave-blocks'>

export const LEGACY_RAW_HEADER = Uint8Array.from([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 7])
export const LEGACY_COMPRESSED_HEADER = Uint8Array.from([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8])
export const LEGACY_STREAM_HEADER = Uint8Array.from([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 9])
export const RISUSAVE_BLOCK_HEADER = new TextEncoder().encode('RISUSAVE\0')

const unpackr = new Unpackr({
  int64AsType: 'number',
  useRecords: false,
})

export function startsWithBytes(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i += 1) {
    if (data[i] !== prefix[i]) return false
  }
  return true
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
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
  if (startsWithBytes(data, LEGACY_RAW_HEADER)) return 'legacy-raw'
  if (startsWithBytes(data, LEGACY_COMPRESSED_HEADER)) return 'legacy-compressed'
  if (startsWithBytes(data, LEGACY_STREAM_HEADER)) return 'legacy-stream'
  if (startsWithBytes(data, RISUSAVE_BLOCK_HEADER)) return 'risusave-blocks'
  return 'unknown'
}

export function encodeLegacyRisuSaveEnvelope(
  payload: unknown,
  kind: LegacyRisuSaveEnvelopeKind = 'legacy-raw',
): Uint8Array {
  const encoded = encodeMsgpackJson(payload)
  if (kind === 'legacy-raw') {
    return concatBytes([LEGACY_RAW_HEADER, encoded])
  }
  if (kind === 'legacy-compressed') {
    return concatBytes([LEGACY_COMPRESSED_HEADER, fflate.compressSync(encoded)])
  }
  return concatBytes([LEGACY_STREAM_HEADER, fflate.gzipSync(encoded)])
}

export function decodeLegacyRisuSaveEnvelope(data: Uint8Array): unknown {
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
  throw new Error(`Unsupported legacy .risu envelope: ${kind}`)
}

const msgpackEncoder = new TextEncoder()

function encodeMsgpackJson(value: unknown): Uint8Array {
  const chunks: Uint8Array[] = []
  writeMsgpackValue(chunks, value)
  return concatBytes(chunks)
}

function writeMsgpackValue(chunks: Uint8Array[], value: unknown): void {
  if (value === null) {
    chunks.push(Uint8Array.from([0xc0]))
    return
  }
  if (typeof value === 'boolean') {
    chunks.push(Uint8Array.from([value ? 0xc3 : 0xc2]))
    return
  }
  if (typeof value === 'number') {
    writeMsgpackNumber(chunks, value)
    return
  }
  if (typeof value === 'string') {
    writeMsgpackString(chunks, value)
    return
  }
  if (Array.isArray(value)) {
    writeMsgpackArray(chunks, value)
    return
  }
  if (value && typeof value === 'object') {
    writeMsgpackObject(chunks, value as Record<string, unknown>)
    return
  }
  throw new Error('Legacy .risu payload must be JSON-serializable')
}

function writeMsgpackNumber(chunks: Uint8Array[], value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error('Legacy .risu payload numbers must be finite')
  }
  if (Number.isInteger(value)) {
    if (value >= 0 && value <= 0x7f) {
      chunks.push(Uint8Array.from([value]))
      return
    }
    if (value < 0 && value >= -32) {
      chunks.push(Uint8Array.from([0xe0 | (value + 32)]))
      return
    }
    if (value >= 0 && value <= 0xff) {
      chunks.push(Uint8Array.from([0xcc, value]))
      return
    }
    if (value >= 0 && value <= 0xffff) {
      chunks.push(withUintHeader(0xcd, value, 2))
      return
    }
    if (value >= 0 && value <= 0xffffffff) {
      chunks.push(withUintHeader(0xce, value, 4))
      return
    }
    if (value >= -0x80 && value < 0) {
      chunks.push(Uint8Array.from([0xd0, value & 0xff]))
      return
    }
    if (value >= -0x8000 && value < 0) {
      chunks.push(withIntHeader(0xd1, value, 2))
      return
    }
    if (value >= -0x80000000 && value < 0) {
      chunks.push(withIntHeader(0xd2, value, 4))
      return
    }
  }

  const bytes = new Uint8Array(9)
  bytes[0] = 0xcb
  new DataView(bytes.buffer).setFloat64(1, value, false)
  chunks.push(bytes)
}

function writeMsgpackString(chunks: Uint8Array[], value: string): void {
  const encoded = msgpackEncoder.encode(value)
  const length = encoded.length
  if (length <= 31) {
    chunks.push(Uint8Array.from([0xa0 | length]), encoded)
    return
  }
  if (length <= 0xff) {
    chunks.push(Uint8Array.from([0xd9, length]), encoded)
    return
  }
  if (length <= 0xffff) {
    chunks.push(withUintHeader(0xda, length, 2), encoded)
    return
  }
  chunks.push(withUintHeader(0xdb, length, 4), encoded)
}

function writeMsgpackArray(chunks: Uint8Array[], value: unknown[]): void {
  const length = value.length
  if (length <= 15) {
    chunks.push(Uint8Array.from([0x90 | length]))
  } else if (length <= 0xffff) {
    chunks.push(withUintHeader(0xdc, length, 2))
  } else {
    chunks.push(withUintHeader(0xdd, length, 4))
  }
  for (const item of value) {
    writeMsgpackValue(chunks, item)
  }
}

function writeMsgpackObject(chunks: Uint8Array[], value: Record<string, unknown>): void {
  const entries = Object.entries(value).filter((entry) => entry[1] !== undefined)
  const length = entries.length
  if (length <= 15) {
    chunks.push(Uint8Array.from([0x80 | length]))
  } else if (length <= 0xffff) {
    chunks.push(withUintHeader(0xde, length, 2))
  } else {
    chunks.push(withUintHeader(0xdf, length, 4))
  }
  for (const [key, entryValue] of entries) {
    writeMsgpackString(chunks, key)
    writeMsgpackValue(chunks, entryValue)
  }
}

function withUintHeader(type: number, value: number, byteLength: 2 | 4): Uint8Array {
  const bytes = new Uint8Array(1 + byteLength)
  bytes[0] = type
  if (byteLength === 2) {
    new DataView(bytes.buffer).setUint16(1, value, false)
  } else {
    new DataView(bytes.buffer).setUint32(1, value, false)
  }
  return bytes
}

function withIntHeader(type: number, value: number, byteLength: 2 | 4): Uint8Array {
  const bytes = new Uint8Array(1 + byteLength)
  bytes[0] = type
  if (byteLength === 2) {
    new DataView(bytes.buffer).setInt16(1, value, false)
  } else {
    new DataView(bytes.buffer).setInt32(1, value, false)
  }
  return bytes
}
