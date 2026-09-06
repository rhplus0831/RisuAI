import { RISUSAVE_BLOCK_HEADER, classifyRisuSaveEnvelope, type RisuSaveEnvelopeKind } from './legacyEnvelopeCodec.js'
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
  RisuSaveBlockType,
  type DecodedRisuSaveBlock,
  type EncodableRisuSaveBlock,
  type RisuSaveEnvelopeKind,
}

export type RisuSaveBlockFixture = EncodableRisuSaveBlock
export type InspectedRisuSaveBlock = DecodedRisuSaveBlock

export function encodeRisuSaveBlockFixtureEnvelope(blocks: RisuSaveBlockFixture[]): Uint8Array {
  return encodeRisuSaveBlockEnvelope(blocks)
}

export function inspectRisuSaveBlockFixtureEnvelope(data: Uint8Array): InspectedRisuSaveBlock[] {
  return decodeRisuSaveBlockEnvelope(data).blocks
}
