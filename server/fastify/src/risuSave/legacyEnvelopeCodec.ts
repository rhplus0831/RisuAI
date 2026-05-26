import * as fflate from 'fflate'
import { Packr, Unpackr } from 'msgpackr/index-no-eval'

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

const packr = new Packr({ useRecords: false })
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
  const encoded = packr.encode(payload)
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
