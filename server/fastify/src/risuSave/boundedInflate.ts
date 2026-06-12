import * as fflate from 'fflate'
import { assertExpandedSizeWithinLimit, type ExpandedSizeLimitOptions } from './importLimits.js'

/**
 * Streaming bounded inflate for untrusted `.risu` payloads.
 *
 * The sync decoders (`fflate.gunzipSync` / `decompressSync`) materialize the
 * full expanded payload before any size check can run, so a small compressed
 * upload can force a multi-GB allocation. These helpers drive fflate's
 * streaming `Gunzip` / `Decompress` instead and enforce the expanded-size cap
 * from the `ondata` accumulator, aborting the inflate as soon as the cumulative
 * output crosses the limit. Output bytes are identical to the sync decoders for
 * within-limit payloads; only the oversize failure mode changes (throws during
 * inflate instead of after full materialization).
 */

/**
 * Input slice size for the streaming push loop. fflate emits the output of each
 * push before accepting the next, so the worst-case allocation past the cap is
 * one push's expansion (deflate tops out around 1032:1 — ~4 MiB for a 4 KiB
 * push) instead of the whole payload.
 */
const INFLATE_PUSH_CHUNK_BYTES = 4096

interface InflateStream {
  push(data: Uint8Array, final: boolean): void
}

function inflateBounded(
  data: Uint8Array,
  createStream: (ondata: fflate.FlateStreamHandler) => InflateStream,
  syncFallback: (data: Uint8Array) => Uint8Array,
  options: ExpandedSizeLimitOptions | undefined,
  label: string,
): Uint8Array {
  if (data.length === 0) {
    // The streaming classes accept an empty final push silently; the sync
    // decoders raise their canonical malformed-input error. Zero bytes cannot
    // expand, so delegating keeps the error behavior identical.
    return syncFallback(data)
  }
  const chunks: Uint8Array[] = []
  let expandedBytes = 0
  const stream = createStream((chunk) => {
    if (chunk.length === 0) return
    expandedBytes += chunk.byteLength
    assertExpandedSizeWithinLimit(expandedBytes, options, label)
    chunks.push(chunk)
  })
  for (let offset = 0; offset < data.length; offset += INFLATE_PUSH_CHUNK_BYTES) {
    const end = Math.min(offset + INFLATE_PUSH_CHUNK_BYTES, data.length)
    stream.push(data.subarray(offset, end), end === data.length)
  }

  if (chunks.length === 1) return chunks[0]
  const result = new Uint8Array(expandedBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/** Bounded streaming `gunzipSync` replacement (gzip member). */
export function gunzipBounded(
  data: Uint8Array,
  options: ExpandedSizeLimitOptions = {},
  label = 'Expanded .risu payload',
): Uint8Array {
  return inflateBounded(
    data,
    (ondata) => new fflate.Gunzip(ondata),
    (empty) => fflate.gunzipSync(empty),
    options,
    label,
  )
}

/** Bounded streaming `decompressSync` replacement (gzip/zlib/raw auto-detect). */
export function decompressBounded(
  data: Uint8Array,
  options: ExpandedSizeLimitOptions = {},
  label = 'Expanded .risu payload',
): Uint8Array {
  return inflateBounded(
    data,
    (ondata) => new fflate.Decompress(ondata),
    (empty) => fflate.decompressSync(empty),
    options,
    label,
  )
}
