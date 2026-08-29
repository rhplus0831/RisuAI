import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/db.js'
import { SQLITE_BACKUP_EXCLUDED_TABLES, SQLITE_BACKUP_TABLES } from '../src/repository.js'
import {
  CHARACTER_ASSET_REFERENCE_FIELDS,
  CHARACTER_ASSET_REFERENCE_LIST_FIELDS,
  CHARACTER_ASSET_TUPLE_FIELDS,
  CHARACTER_TEXT_INLAY_FIELDS,
  COLLECTION_ASSET_IMAGE_OWNERS,
  NESTED_ASSET_REFERENCE_FIELDS,
  ROOT_ASSET_REFERENCE_FIELDS,
} from '../src/risuSave/assetOwnerCatalog.js'
import { RisuSaveBlockType } from '../src/risuSave/blockCodec.js'
import {
  LEGACY_COMPRESSED_HEADER,
  LEGACY_RAW_HEADER,
  LEGACY_STREAM_HEADER,
  RISUSAVE_BLOCK_HEADER,
  classifyRisuSaveEnvelope,
  type RisuSaveEnvelopeKind,
} from '../src/risuSave/legacyEnvelopeCodec.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

type CodecPolicy = {
  import: 'accepted' | 'skipped-with-report' | 'unsupported-reference'
  export: 'emitted' | 'import-only'
}

const BLOCK_POLICY = {
  [RisuSaveBlockType.CONFIG]: { import: 'accepted', export: 'emitted' },
  [RisuSaveBlockType.ROOT]: { import: 'accepted', export: 'emitted' },
  [RisuSaveBlockType.CHARACTER_WITH_CHAT]: { import: 'accepted', export: 'emitted' },
  [RisuSaveBlockType.CHAT]: { import: 'skipped-with-report', export: 'import-only' },
  [RisuSaveBlockType.BOTPRESET]: { import: 'accepted', export: 'emitted' },
  [RisuSaveBlockType.MODULES]: { import: 'accepted', export: 'emitted' },
  [RisuSaveBlockType.REMOTE]: { import: 'unsupported-reference', export: 'import-only' },
  [RisuSaveBlockType.CHARACTER_WITHOUT_CHAT]: { import: 'accepted', export: 'import-only' },
  [RisuSaveBlockType.ROOT_COMPONENT]: { import: 'accepted', export: 'import-only' },
  [RisuSaveBlockType.PLUGINS]: { import: 'accepted', export: 'emitted' },
  [RisuSaveBlockType.LOADOUTS]: { import: 'accepted', export: 'emitted' },
  [RisuSaveBlockType.PLUGIN_STORAGE]: { import: 'accepted', export: 'emitted' },
} satisfies Record<RisuSaveBlockType, CodecPolicy>

const ENVELOPE_POLICY = {
  'legacy-raw': { decode: 'supported', encode: 'supported' },
  'legacy-compressed': { decode: 'supported', encode: 'supported' },
  'legacy-stream': { decode: 'supported', encode: 'supported' },
  'risusave-blocks': { decode: 'supported', encode: 'supported' },
} satisfies Record<RisuSaveEnvelopeKind, { decode: 'supported'; encode: 'supported' }>

const ASSET_CATALOG_POLICY = {
  ROOT_ASSET_REFERENCE_FIELDS: 'root scalar references',
  NESTED_ASSET_REFERENCE_FIELDS: 'nested settings scalar references',
  COLLECTION_ASSET_IMAGE_OWNERS: 'preset image references',
  CHARACTER_ASSET_REFERENCE_FIELDS: 'character scalar references',
  CHARACTER_ASSET_TUPLE_FIELDS: 'character tuple references',
  CHARACTER_ASSET_REFERENCE_LIST_FIELDS: 'character list references',
  CHARACTER_TEXT_INLAY_FIELDS: 'character text inlay references',
} as const

const SPECIALIZED_ASSET_OWNER_POLICY = [
  {
    owner: 'personas.icon',
    discovery: 'readArray(root.personas)',
    rewrite: 'readRecords(database.personas)',
  },
  {
    owner: 'characterOrder.img/imgFile',
    discovery: 'readArray(root.characterOrder)',
    rewrite: 'readRecords(database.characterOrder)',
  },
  {
    owner: 'modules.assets',
    discovery: 'readArray(root.modules)',
    rewrite: 'readRecords(database.modules)',
  },
  { owner: 'characters.chats', discovery: 'addChatInlayReferences', rewrite: 'rewriteChatInlayReferences' },
  { owner: 'characters.ccAssets', discovery: 'addCcAssetReferences', rewrite: 'rewriteCcAssetReferences' },
  { owner: 'characters.vits', discovery: 'addVitsReferences', rewrite: 'rewriteVitsReferences' },
  {
    owner: 'characters.gptSoVitsConfig',
    discovery: 'addGptSoVitsReference',
    rewrite: 'rewriteGptSoVitsReference',
  },
  {
    owner: 'characters.alternateGreetings',
    discovery: 'addCharacterTextInlayReferences',
    rewrite: 'rewriteCharacterTextInlayReferences',
  },
  {
    owner: 'pluginCustomStorage',
    discovery: 'collectDeepAssetReferenceSources',
    rewrite: 'rewriteDeepAssetReferences',
  },
] as const

describe('Phase 11 compatibility structure', () => {
  it('classifies every supported save envelope and every portable block type', () => {
    expect(Object.keys(ENVELOPE_POLICY).sort()).toEqual([
      'legacy-compressed',
      'legacy-raw',
      'legacy-stream',
      'risusave-blocks',
    ])
    expect([
      classifyRisuSaveEnvelope(LEGACY_RAW_HEADER),
      classifyRisuSaveEnvelope(LEGACY_COMPRESSED_HEADER),
      classifyRisuSaveEnvelope(LEGACY_STREAM_HEADER),
      classifyRisuSaveEnvelope(RISUSAVE_BLOCK_HEADER),
    ]).toEqual(['legacy-raw', 'legacy-compressed', 'legacy-stream', 'risusave-blocks'])

    const enumValues = Object.values(RisuSaveBlockType)
      .filter((value): value is number => typeof value === 'number')
      .sort((left, right) => left - right)
    const classifiedValues = Object.keys(BLOCK_POLICY)
      .map(Number)
      .sort((left, right) => left - right)
    expect(classifiedValues).toEqual(enumValues)
  })

  it('keeps every declarative asset-owner catalog entry shared by discovery and legacy rewriting', () => {
    const catalogSource = readRepoFile('server/fastify/src/risuSave/assetOwnerCatalog.ts')
    const discoverySource = readRepoFile('server/fastify/src/risuSave/assetReferences.ts')
    const rewriteSource = readRepoFile('server/fastify/src/risuSave/localBackupDatabase.ts')
    const exportedCatalogNames = [...catalogSource.matchAll(/export const ([A-Z][A-Z_]+)/g)]
      .map((match) => match[1])
      .sort()

    expect(exportedCatalogNames).toEqual(Object.keys(ASSET_CATALOG_POLICY).sort())
    for (const catalogName of exportedCatalogNames) {
      expect(discoverySource, `${catalogName} must be consumed by portable asset discovery`).toContain(catalogName)
      expect(rewriteSource, `${catalogName} must be consumed by legacy asset rewriting`).toContain(catalogName)
    }

    expect({
      ROOT_ASSET_REFERENCE_FIELDS,
      NESTED_ASSET_REFERENCE_FIELDS,
      COLLECTION_ASSET_IMAGE_OWNERS,
      CHARACTER_ASSET_REFERENCE_FIELDS,
      CHARACTER_ASSET_TUPLE_FIELDS,
      CHARACTER_ASSET_REFERENCE_LIST_FIELDS,
      CHARACTER_TEXT_INLAY_FIELDS,
    }).toEqual({
      ROOT_ASSET_REFERENCE_FIELDS: ['userIcon', 'customBackground'],
      NESTED_ASSET_REFERENCE_FIELDS: [
        { owner: 'NAIImgConfig', fields: ['image', 'character_image'] },
        { owner: 'wavespeedImage', fields: ['reference_image'] },
      ],
      COLLECTION_ASSET_IMAGE_OWNERS: ['botPresets', 'modelPresets', 'promptPresets'],
      CHARACTER_ASSET_REFERENCE_FIELDS: ['image', 'notificationImage'],
      CHARACTER_ASSET_TUPLE_FIELDS: ['emotionImages', 'additionalAssets'],
      CHARACTER_ASSET_REFERENCE_LIST_FIELDS: ['prebuiltAssetExclude'],
      CHARACTER_TEXT_INLAY_FIELDS: [
        'firstMessage',
        'backgroundHTML',
        'creatorNotes',
        'name',
        'nickname',
        'desc',
        'personality',
        'scenario',
        'exampleMessage',
      ],
    })
  })

  it('pins every specialized asset owner to both discovery and legacy rewrite handlers', () => {
    const discoverySource = readRepoFile('server/fastify/src/risuSave/assetReferences.ts')
    const rewriteSource = readRepoFile('server/fastify/src/risuSave/localBackupDatabase.ts')

    expect(new Set(SPECIALIZED_ASSET_OWNER_POLICY.map(({ owner }) => owner)).size).toBe(
      SPECIALIZED_ASSET_OWNER_POLICY.length,
    )
    for (const policy of SPECIALIZED_ASSET_OWNER_POLICY) {
      expect(discoverySource, `${policy.owner} must have a portable discovery owner`).toContain(policy.discovery)
      expect(rewriteSource, `${policy.owner} must have a legacy rewrite owner`).toContain(policy.rewrite)
    }
  })

  it('classifies every persisted table for backup inclusion or deliberate exclusion', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-phase11-tables-'))
    const db = openDatabase(dataDir)
    try {
      const liveTables = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
          .all() as Array<{ name: string }>
      ).map(({ name }) => name)
      const includedTables = [...SQLITE_BACKUP_TABLES]
      const excludedEntries = Object.entries(SQLITE_BACKUP_EXCLUDED_TABLES)
      const excludedTables = excludedEntries.map(([table]) => table)

      expect(includedTables.filter((table) => excludedTables.includes(table))).toEqual([])
      expect([...includedTables, ...excludedTables].sort()).toEqual(liveTables)
      expect(excludedEntries.filter(([, reason]) => reason.trim().length === 0)).toEqual([])
    } finally {
      db.close()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})

function readRepoFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, `file://${REPO_ROOT}/`)), 'utf8')
}
