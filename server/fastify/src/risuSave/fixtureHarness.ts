import {
  RISUSAVE_BLOCK_HEADER,
  classifyRisuSaveEnvelope,
  decodeLegacyRisuSaveEnvelope,
  encodeLegacyRisuSaveEnvelope,
  type LegacyRisuSaveEnvelopeKind,
  type RisuSaveEnvelopeKind,
} from './legacyEnvelopeCodec.js'
import {
  decodeRisuSaveBlockEnvelope,
  encodeRisuSaveBlock,
  encodeRisuSaveBlockEnvelope,
  RisuSaveBlockType,
  type DecodedRisuSaveBlock,
  type EncodableRisuSaveBlock,
} from './blockCodec.js'

export {
  RISUSAVE_BLOCK_HEADER,
  classifyRisuSaveEnvelope,
  decodeRisuSaveBlockEnvelope,
  encodeRisuSaveBlock,
  encodeRisuSaveBlockEnvelope,
  decodeLegacyRisuSaveEnvelope,
  encodeLegacyRisuSaveEnvelope,
  RisuSaveBlockType,
  type DecodedRisuSaveBlock,
  type EncodableRisuSaveBlock,
  type LegacyRisuSaveEnvelopeKind,
  type RisuSaveEnvelopeKind,
}

export type RisuSaveBlockFixture = EncodableRisuSaveBlock
export type InspectedRisuSaveBlock = DecodedRisuSaveBlock

export function encodeLegacyFixtureEnvelope(payload: unknown, kind: LegacyRisuSaveEnvelopeKind): Uint8Array {
  return encodeLegacyRisuSaveEnvelope(payload, kind)
}

export function decodeLegacyFixtureEnvelope(data: Uint8Array): unknown {
  return decodeLegacyRisuSaveEnvelope(data)
}

export function encodeRisuSaveBlockFixture(block: RisuSaveBlockFixture): Uint8Array {
  return encodeRisuSaveBlock(block)
}

export function encodeRisuSaveBlockFixtureEnvelope(blocks: RisuSaveBlockFixture[]): Uint8Array {
  return encodeRisuSaveBlockEnvelope(blocks)
}

export function inspectRisuSaveBlockFixtureEnvelope(data: Uint8Array): InspectedRisuSaveBlock[] {
  return decodeRisuSaveBlockEnvelope(data).blocks
}
