import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { risuSaveFixtureCases } from '../__fixtures__/risuSave/fixtures.js'
import {
  classifyRisuSaveEnvelope,
  inspectRisuSaveBlockFixtureEnvelope,
} from '../src/risuSave/fixtureHarness.js'
import {
  decodeRisuSaveBlockEnvelope,
  encodeRisuSaveBlockEnvelope,
  RisuSaveBlockType,
} from '../src/risuSave/blockCodec.js'
import {
  decodeLegacyRisuSaveEnvelope,
  encodeLegacyRisuSaveEnvelope,
} from '../src/risuSave/legacyEnvelopeCodec.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const harnessSource = readFileSync(path.join(here, '../src/risuSave/fixtureHarness.ts'), 'utf8')
const legacyCodecSource = readFileSync(
  path.join(here, '../src/risuSave/legacyEnvelopeCodec.ts'),
  'utf8',
)
const blockCodecSource = readFileSync(path.join(here, '../src/risuSave/blockCodec.ts'), 'utf8')

describe('server .risu fixture harness', () => {
  it('keeps codec helpers server-safe and detached from browser storage modules', () => {
    for (const source of [harnessSource, legacyCodecSource, blockCodecSource]) {
      expect(source).not.toContain('localforage')
      expect(source).not.toContain('@tauri-apps')
      expect(source).not.toContain('database.svelte')
      expect(source).not.toContain('globalApi.svelte')
      expect(source).not.toContain('CompressionStream')
      expect(source).not.toContain('DecompressionStream')
    }
  })

  it('loads every fixture case as non-empty bytes', () => {
    expect(risuSaveFixtureCases.length).toBeGreaterThanOrEqual(8)
    for (const fixture of risuSaveFixtureCases) {
      expect(fixture.bytes).toBeInstanceOf(Uint8Array)
      expect(fixture.bytes.length, fixture.name).toBeGreaterThan(0)
    }
  })

  it('classifies legacy raw, compressed, stream, block, and malformed envelopes', () => {
    for (const fixture of risuSaveFixtureCases) {
      expect(classifyRisuSaveEnvelope(fixture.bytes), fixture.name).toBe(fixture.expectedEnvelope)
    }
  })

  it('pins expected decoded shapes for legacy envelope fixtures', () => {
    const legacyFixtures = risuSaveFixtureCases.filter((fixture) =>
      fixture.expectedEnvelope.startsWith('legacy-'),
    )
    expect(legacyFixtures).toHaveLength(3)

    for (const fixture of legacyFixtures) {
      expect(decodeLegacyRisuSaveEnvelope(fixture.bytes), fixture.name).toEqual(
        fixture.expectedDecodedShape,
      )
    }
  })

  it('encodes legacy envelopes that round-trip through the production codec', () => {
    const payload = { version: 1, characters: [{ chaId: 'encoded-char', name: 'Encoded' }] }
    const kinds = ['legacy-raw', 'legacy-compressed', 'legacy-stream'] as const

    for (const kind of kinds) {
      const encoded = encodeLegacyRisuSaveEnvelope(payload, kind)
      expect(classifyRisuSaveEnvelope(encoded), kind).toBe(kind)
      expect(decodeLegacyRisuSaveEnvelope(encoded), kind).toEqual(payload)
    }
  })

  it('rejects non-legacy envelopes in the production legacy codec', () => {
    const unknown = risuSaveFixtureCases.find(
      (fixture) => fixture.name === 'malformed-unknown-envelope',
    )
    expect(unknown).toBeDefined()
    expect(() => decodeLegacyRisuSaveEnvelope(unknown!.bytes)).toThrow(
      /Unsupported legacy \.risu envelope: unknown/,
    )

    const blockEnvelope = risuSaveFixtureCases.find(
      (fixture) => fixture.name === 'risusave-blocks-basic',
    )
    expect(blockEnvelope).toBeDefined()
    expect(() => decodeLegacyRisuSaveEnvelope(blockEnvelope!.bytes)).toThrow(
      /Unsupported legacy \.risu envelope: risusave-blocks/,
    )
  })

  it('pins expected block families for RISUSAVE block fixtures', () => {
    const blockFixtures = risuSaveFixtureCases.filter(
      (fixture) => fixture.expectedEnvelope === 'risusave-blocks' && !fixture.malformed,
    )
    expect(blockFixtures.length).toBeGreaterThanOrEqual(3)

    for (const fixture of blockFixtures) {
      const blocks = inspectRisuSaveBlockFixtureEnvelope(fixture.bytes)
      expect(
        blocks.map((block) => ({
          name: block.name,
          type: block.type,
          unsupportedReference: block.unsupportedReference,
        })),
        fixture.name,
      ).toEqual(fixture.expectedBlocks)
    }
  })

  it('decodes RISUSAVE block fixtures through the production block codec', () => {
    const fixture = risuSaveFixtureCases.find((item) => item.name === 'risusave-blocks-basic')
    expect(fixture).toBeDefined()

    const decoded = decodeRisuSaveBlockEnvelope(fixture!.bytes)
    expect(decoded.unsupportedReferences).toEqual([])
    expect(decoded.blocks.map((block) => [block.name, block.type])).toEqual([
      ['root', RisuSaveBlockType.ROOT],
      ['preset', RisuSaveBlockType.BOTPRESET],
      ['modules', RisuSaveBlockType.MODULES],
      ['loadouts', RisuSaveBlockType.LOADOUTS],
      ['plugins', RisuSaveBlockType.PLUGINS],
      ['pluginStorage', RisuSaveBlockType.PLUGIN_STORAGE],
      ['fixture-char', RisuSaveBlockType.CHARACTER_WITH_CHAT],
      ['config', RisuSaveBlockType.CONFIG],
    ])
    expect(JSON.parse(decoded.blocks.find((block) => block.name === 'modules')!.content!)).toEqual([
      { id: 'module-a', name: 'Module A' },
    ])
  })

  it('encodes RISUSAVE block envelopes that round-trip through the production codec', () => {
    const blocks = [
      {
        name: 'root',
        type: RisuSaveBlockType.ROOT,
        data: JSON.stringify({ version: 1, __directory: ['preset', 'root-component'] }),
      },
      {
        name: 'preset',
        type: RisuSaveBlockType.BOTPRESET,
        data: JSON.stringify([{ id: 'preset-a', name: 'Preset A' }]),
        compression: true,
      },
      {
        name: 'root-component',
        type: RisuSaveBlockType.ROOT_COMPONENT,
        data: JSON.stringify({ key: 'customRootField', data: { enabled: true } }),
      },
    ]

    const encoded = encodeRisuSaveBlockEnvelope(blocks)
    expect(classifyRisuSaveEnvelope(encoded)).toBe('risusave-blocks')

    const decoded = decodeRisuSaveBlockEnvelope(encoded)
    expect(decoded.unsupportedReferences).toEqual([])
    expect(
      decoded.blocks.map((block) => ({
        name: block.name,
        type: block.type,
        compression: block.compression,
        content: block.content,
      })),
    ).toEqual([
      {
        name: 'root',
        type: RisuSaveBlockType.ROOT,
        compression: false,
        content: blocks[0].data,
      },
      {
        name: 'preset',
        type: RisuSaveBlockType.BOTPRESET,
        compression: true,
        content: blocks[1].data,
      },
      {
        name: 'root-component',
        type: RisuSaveBlockType.ROOT_COMPONENT,
        compression: false,
        content: blocks[2].data,
      },
    ])
  })

  it('represents remote and cache-only blocks as unsupported server decode inputs', () => {
    const unsupported = risuSaveFixtureCases.filter((fixture) =>
      fixture.expectedBlocks?.some((block) => block.unsupportedReference),
    )
    expect(unsupported.map((fixture) => fixture.name)).toEqual([
      'risusave-remote-reference',
      'risusave-cache-only-reference',
    ])

    for (const fixture of unsupported) {
      const { blocks, unsupportedReferences } = decodeRisuSaveBlockEnvelope(fixture.bytes)
      expect(
        blocks.some((block) => block.unsupportedReference),
        fixture.name,
      ).toBe(true)
      expect(unsupportedReferences, fixture.name).toEqual(
        fixture.expectedBlocks
          ?.filter((block) => block.unsupportedReference)
          .map((block) => ({
            name: block.name,
            type: RisuSaveBlockType.REMOTE,
            kind: block.unsupportedReference,
          })),
      )
    }
  })

  it('keeps malformed fixture cases available for later decoder rejection tests', () => {
    const unknown = risuSaveFixtureCases.find(
      (fixture) => fixture.name === 'malformed-unknown-envelope',
    )
    expect(unknown).toBeDefined()
    expect(classifyRisuSaveEnvelope(unknown!.bytes)).toBe('unknown')

    const truncated = risuSaveFixtureCases.find(
      (fixture) => fixture.name === 'malformed-truncated-block',
    )
    expect(truncated).toBeDefined()
    expect(() => decodeRisuSaveBlockEnvelope(truncated!.bytes)).toThrow(
      /Malformed RISUSAVE block/,
    )
  })
})
