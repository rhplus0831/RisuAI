import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { risuSaveFixtureCases } from '../__fixtures__/risuSave/fixtures.js'
import { classifyRisuSaveEnvelope, inspectRisuSaveBlockFixtureEnvelope } from '../src/risuSave/fixtureHarness.js'
import {
  decodeRisuSaveBlockEnvelope,
  encodeRisuSaveBlockEnvelope,
  RisuSaveBlockType,
} from '../src/risuSave/blockCodec.js'
import { decodeLegacyRisuSaveEnvelope, encodeLegacyRisuSaveEnvelope } from '../src/risuSave/legacyEnvelopeCodec.js'
import {
  RISUSAVE_INCOMPLETE_BLOCKS_ERROR,
  UnsupportedGroupCharactersError,
  decodeRisuSaveImportSnapshot,
} from '../src/risuSave/importSnapshot.js'
import {
  buildRisuSaveExportBlocks,
  encodeRepositoryRisuSaveBlockExport,
  encodeRepositoryRisuSaveLegacyExport,
} from '../src/risuSave/exportSnapshot.js'
import { writePersistedWithMessages } from '../src/repository.js'
import { openDatabase } from '../src/db.js'

const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-risu-export-'))
  dataDirs.push(dataDir)
  return dataDir
}

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

describe('server .risu fixture harness', () => {
  it('classifies legacy raw, compressed, stream, block, and malformed envelopes', () => {
    for (const fixture of risuSaveFixtureCases) {
      expect(classifyRisuSaveEnvelope(fixture.bytes), fixture.name).toBe(fixture.expectedEnvelope)
    }
  })

  it('pins expected decoded shapes for legacy envelope fixtures', () => {
    const legacyFixtures = risuSaveFixtureCases.filter((fixture) => fixture.expectedEnvelope.startsWith('legacy-'))
    expect(legacyFixtures).toHaveLength(3)

    for (const fixture of legacyFixtures) {
      expect(decodeLegacyRisuSaveEnvelope(fixture.bytes), fixture.name).toEqual(fixture.expectedDecodedShape)
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
    const unknown = risuSaveFixtureCases.find((fixture) => fixture.name === 'malformed-unknown-envelope')
    expect(unknown).toBeDefined()
    expect(() => decodeLegacyRisuSaveEnvelope(unknown!.bytes)).toThrow(/Unsupported legacy \.risu envelope: unknown/)

    const blockEnvelope = risuSaveFixtureCases.find((fixture) => fixture.name === 'risusave-blocks-basic')
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
    const unknown = risuSaveFixtureCases.find((fixture) => fixture.name === 'malformed-unknown-envelope')
    expect(unknown).toBeDefined()
    expect(classifyRisuSaveEnvelope(unknown!.bytes)).toBe('unknown')

    const truncated = risuSaveFixtureCases.find((fixture) => fixture.name === 'malformed-truncated-block')
    expect(truncated).toBeDefined()
    expect(() => decodeRisuSaveBlockEnvelope(truncated!.bytes)).toThrow(/Malformed RISUSAVE block/)
  })

  it('normalizes decoded legacy envelopes into current import snapshots', () => {
    const fixture = risuSaveFixtureCases.find((item) => item.name === 'legacy-raw-basic')
    expect(fixture).toBeDefined()

    const decoded = decodeRisuSaveImportSnapshot(fixture!.bytes)

    expect(decoded.envelope).toBe('legacy-raw')
    expect(decoded.unsupportedReferences).toEqual([])
    expect(decoded.database.characters).toHaveLength(1)
    expect(decoded.database.characterOrder).toEqual(['fixture-char'])
    expect(decoded.database.currentChar).toBe(0)
    expect(decoded.database.botPresets).toEqual([
      {
        id: 'preset-a',
        name: 'Preset A',
        localNetworkMode: false,
        localNetworkTimeoutSec: 600,
      },
    ])
    expect(decoded.database.botPresetsId).toBe(0)

    const character = (decoded.database.characters as unknown[])[0] as Record<string, unknown>
    expect(character.chaId).toBe('fixture-char')
    expect(character.chats).toHaveLength(1)
    const chat = (character.chats as Array<Record<string, unknown>>)[0]
    expect(chat.id).toEqual(expect.any(String))
    expect(chat.id).not.toBe('')
    expect(chat.message).toEqual([])
    expect(decoded.database.loreBook).toEqual([
      expect.objectContaining({ id: 'default-global-lorebook', name: 'My First LoreBook', data: [] }),
    ])
  })

  it('assembles and normalizes RISUSAVE block envelopes into import snapshots', () => {
    const fixture = risuSaveFixtureCases.find((item) => item.name === 'risusave-blocks-basic')
    expect(fixture).toBeDefined()

    const decoded = decodeRisuSaveImportSnapshot(fixture!.bytes)

    expect(decoded.envelope).toBe('risusave-blocks')
    expect(decoded.unsupportedReferences).toEqual([])
    expect(decoded.database.version).toBe(1)
    expect(decoded.database.__directory).toBeUndefined()
    expect(decoded.database.botPresets).toEqual([
      {
        id: 'preset-a',
        name: 'Preset A',
        localNetworkMode: false,
        localNetworkTimeoutSec: 600,
      },
    ])
    expect(decoded.database.modules).toEqual([{ id: 'module-a', name: 'Module A', description: '' }])
    expect(decoded.database.loadouts).toEqual([
      {
        id: 'loadout-a',
        name: 'Loadout A',
        lastUsed: expect.any(Number),
        favorite: false,
        characterIds: [],
        modules: [],
        globalVariables: {},
        presetName: '',
        modelPresetId: '',
        modelPresetName: '',
        promptPresetId: '',
        promptPresetName: '',
        personaId: '',
      },
    ])
    expect(decoded.database.plugins).toEqual([{ id: 'plugin-a', name: 'Plugin A' }])
    expect(decoded.database.pluginCustomStorage).toEqual({ 'plugin-a:key': { enabled: true } })
    expect(decoded.database.characterOrder).toEqual(['fixture-char'])
  })

  it('applies root-component blocks as validated top-level fields', () => {
    const encoded = encodeRisuSaveBlockEnvelope([
      {
        name: 'root',
        type: RisuSaveBlockType.ROOT,
        data: JSON.stringify({ version: 1, __directory: ['root-component'] }),
      },
      {
        name: 'root-component',
        type: RisuSaveBlockType.ROOT_COMPONENT,
        data: JSON.stringify({ key: 'customRootField', data: { enabled: true } }),
      },
    ])

    expect(decodeRisuSaveImportSnapshot(encoded).database).toMatchObject({
      version: 1,
      customRootField: { enabled: true },
    })
  })

  it('reports explicit remote references but rejects missing directory blocks', () => {
    const remote = risuSaveFixtureCases.find((item) => item.name === 'risusave-remote-reference')
    const cacheOnly = risuSaveFixtureCases.find((item) => item.name === 'risusave-cache-only-reference')
    expect(remote).toBeDefined()
    expect(cacheOnly).toBeDefined()

    expect(decodeRisuSaveImportSnapshot(remote!.bytes).unsupportedReferences).toEqual([
      { name: 'remote-char', type: RisuSaveBlockType.REMOTE, kind: 'remote' },
    ])
    expect(() => decodeRisuSaveImportSnapshot(cacheOnly!.bytes)).toThrow(RISUSAVE_INCOMPLETE_BLOCKS_ERROR)
  })

  it('rejects a block save truncated exactly after a complete block', () => {
    const blocks = [
      {
        name: 'root',
        type: RisuSaveBlockType.ROOT,
        data: JSON.stringify({ version: 1, __directory: ['preset', 'modules', 'config'] }),
      },
      {
        name: 'preset',
        type: RisuSaveBlockType.BOTPRESET,
        data: JSON.stringify([]),
      },
      {
        name: 'modules',
        type: RisuSaveBlockType.MODULES,
        data: JSON.stringify([{ id: 'module-a', name: 'Module A' }]),
      },
      {
        name: 'config',
        type: RisuSaveBlockType.CONFIG,
        data: JSON.stringify({ version: 1 }),
      },
    ]
    const complete = encodeRisuSaveBlockEnvelope(blocks)
    const boundary = encodeRisuSaveBlockEnvelope(blocks.slice(0, 2)).byteLength
    const truncated = complete.slice(0, boundary)

    expect(decodeRisuSaveBlockEnvelope(truncated).unsupportedReferences).toEqual([
      { name: 'modules', type: RisuSaveBlockType.REMOTE, kind: 'cache-only' },
      { name: 'config', type: RisuSaveBlockType.REMOTE, kind: 'cache-only' },
    ])
    expect(() => decodeRisuSaveImportSnapshot(truncated)).toThrow(RISUSAVE_INCOMPLETE_BLOCKS_ERROR)
  })

  it('rejects malformed decoded import rows', () => {
    const invalidMessage = encodeLegacyRisuSaveEnvelope({
      characters: [
        {
          chaId: 'bad-char',
          name: 'Bad',
          chats: [
            {
              id: 'bad-chat',
              name: 'Bad Chat',
              note: '',
              localLore: [],
              message: [{ role: 'system', data: 'nope', chatId: 'bad-message' }],
            },
          ],
        },
      ],
    })
    expect(() => decodeRisuSaveImportSnapshot(invalidMessage)).toThrow(/message\[0\]\.role must be user or char/)

    const invalidRootComponent = encodeRisuSaveBlockEnvelope([
      {
        name: 'root',
        type: RisuSaveBlockType.ROOT,
        data: JSON.stringify({ version: 1, __directory: ['bad-component'] }),
      },
      {
        name: 'bad-component',
        type: RisuSaveBlockType.ROOT_COMPONENT,
        data: JSON.stringify({ key: '', data: true }),
      },
    ])
    expect(() => decodeRisuSaveImportSnapshot(invalidRootComponent)).toThrow(
      /bad-component block key must be a non-empty string/,
    )
  })

  it('rejects group characters before import normalization can remove them', () => {
    const encoded = encodeLegacyRisuSaveEnvelope({
      characters: [
        {
          type: 'group',
          chaId: 'legacy-group-a',
          name: 'Legacy Party',
          chats: [{ id: 'group-chat-a', message: [{ role: 'user', data: 'keep me' }] }],
        },
      ],
    })

    try {
      decodeRisuSaveImportSnapshot(encoded)
      throw new Error('Expected group import rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedGroupCharactersError)
      expect(error).toMatchObject({
        count: 1,
        groups: [{ id: 'legacy-group-a', name: 'Legacy Party' }],
      })
      expect((error as Error).message).toContain('active database was not changed')
    }
  })

  it('exports repository snapshots as legacy .risu envelopes', () => {
    const dataDir = makeDataDir()
    const assetId = 'a'.repeat(64)
    const database = {
      version: 1,
      characters: [
        {
          chaId: 'export-char',
          name: 'Export Character',
          image: assetId,
          chats: [
            {
              id: 'export-chat',
              name: 'Export Chat',
              note: '',
              localLore: [],
              message: [{ role: 'user', data: 'hello', chatId: 'export-message' }],
            },
          ],
        },
      ],
      characterOrder: ['export-char'],
      botPresets: [{ id: 'preset-a', name: 'Preset A' }],
      modules: [{ id: 'module-a', name: 'Module A' }],
      loadouts: [{ id: 'loadout-a', name: 'Loadout A' }],
      plugins: [{ id: 'plugin-a', name: 'Plugin A' }],
      pluginCustomStorage: { 'plugin-a:key': { assetId } },
    }
    const db = openDatabase(dataDir)
    try {
      writePersistedWithMessages(db, dataDir, {
        _version: 1,
        database,
        assets: [{ id: assetId, ext: 'png', size: 12, contentType: 'image/png' }],
      })

      const encoded = encodeRepositoryRisuSaveLegacyExport(db, dataDir, 'legacy-raw')
      const decoded = decodeRisuSaveImportSnapshot(encoded)

      expect(decoded.envelope).toBe('legacy-raw')
      expect(decoded.unsupportedReferences).toEqual([])
      expect(decoded.database.characters).toHaveLength(1)
      expect((decoded.database.characters as Array<Record<string, unknown>>)[0].image).toBe(assetId)
      expect(decoded.database.pluginCustomStorage).toEqual({ 'plugin-a:key': { assetId } })
    } finally {
      db.close()
    }
  })

  it('exports repository snapshots as RISUSAVE block envelopes', () => {
    const dataDir = makeDataDir()
    const assetId = 'b'.repeat(64)
    const db = openDatabase(dataDir)
    try {
      writePersistedWithMessages(db, dataDir, {
        _version: 1,
        database: {
          version: 1,
          selectedCharID: 0,
          characters: [
            {
              chaId: 'block-export-char',
              name: 'Block Export Character',
              image: assetId,
              chats: [],
            },
          ],
          botPresets: [{ id: 'preset-a', name: 'Preset A' }],
          modules: [{ id: 'module-a', name: 'Module A' }],
          loadouts: [{ id: 'loadout-a', name: 'Loadout A' }],
          plugins: [{ id: 'plugin-a', name: 'Plugin A' }],
          pluginCustomStorage: { 'plugin-a:key': { assetId } },
        },
        assets: [{ id: assetId, ext: 'webp', size: 44, contentType: 'image/webp' }],
      })

      const encoded = encodeRepositoryRisuSaveBlockExport(db, dataDir, {
        compression: true,
      })
      const blocks = decodeRisuSaveBlockEnvelope(encoded)
      const decoded = decodeRisuSaveImportSnapshot(encoded)

      expect(blocks.unsupportedReferences).toEqual([])
      expect(
        blocks.blocks.map((block) => ({
          name: block.name,
          type: block.type,
          compression: block.compression,
        })),
      ).toEqual([
        { name: 'root', type: RisuSaveBlockType.ROOT, compression: true },
        { name: 'preset', type: RisuSaveBlockType.BOTPRESET, compression: true },
        { name: 'modules', type: RisuSaveBlockType.MODULES, compression: true },
        { name: 'loadouts', type: RisuSaveBlockType.LOADOUTS, compression: true },
        { name: 'plugins', type: RisuSaveBlockType.PLUGINS, compression: true },
        { name: 'pluginStorage', type: RisuSaveBlockType.PLUGIN_STORAGE, compression: true },
        {
          name: 'block-export-char',
          type: RisuSaveBlockType.CHARACTER_WITH_CHAT,
          compression: true,
        },
        { name: 'config', type: RisuSaveBlockType.CONFIG, compression: true },
      ])
      expect(JSON.parse(blocks.blocks[0].content!).__directory).toEqual([
        'preset',
        'modules',
        'loadouts',
        'plugins',
        'pluginStorage',
        'block-export-char',
        'config',
      ])
      expect((decoded.database.characters as Array<Record<string, unknown>>)[0].image).toBe(assetId)
      expect(decoded.database.pluginCustomStorage).toEqual({ 'plugin-a:key': { assetId } })
    } finally {
      db.close()
    }
  })

  it('rejects repository export when no persisted database exists', () => {
    const dataDir = makeDataDir()
    expect(() => encodeRepositoryRisuSaveLegacyExport(openDatabase(dataDir), dataDir)).toThrow(
      /database payload missing/,
    )
  })

  it('validates block export inputs before encoding', () => {
    expect(() =>
      buildRisuSaveExportBlocks({
        characters: [{ name: 'Missing stable id', chats: [] }],
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
      }),
    ).toThrow(/character\.chaId must be a non-empty string/)
  })
})
