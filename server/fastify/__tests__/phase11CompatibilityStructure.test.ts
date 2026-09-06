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
} from '../src/risuSave/legacyEnvelopeCodec.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const ASSET_CATALOG_NAMES = [
  'ROOT_ASSET_REFERENCE_FIELDS',
  'NESTED_ASSET_REFERENCE_FIELDS',
  'COLLECTION_ASSET_IMAGE_OWNERS',
  'CHARACTER_ASSET_REFERENCE_FIELDS',
  'CHARACTER_ASSET_TUPLE_FIELDS',
  'CHARACTER_ASSET_REFERENCE_LIST_FIELDS',
  'CHARACTER_TEXT_INLAY_FIELDS',
] as const

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
    expect([
      classifyRisuSaveEnvelope(LEGACY_RAW_HEADER),
      classifyRisuSaveEnvelope(LEGACY_COMPRESSED_HEADER),
      classifyRisuSaveEnvelope(LEGACY_STREAM_HEADER),
      classifyRisuSaveEnvelope(RISUSAVE_BLOCK_HEADER),
    ]).toEqual(['legacy-raw', 'legacy-compressed', 'legacy-stream', 'risusave-blocks'])

    // These numeric tags are persisted in portable save blocks.
    expect(
      Object.fromEntries(Object.entries(RisuSaveBlockType).filter(([, value]) => typeof value === 'number')),
    ).toEqual({
      CONFIG: 0,
      ROOT: 1,
      CHARACTER_WITH_CHAT: 2,
      CHAT: 3,
      BOTPRESET: 4,
      MODULES: 5,
      REMOTE: 6,
      CHARACTER_WITHOUT_CHAT: 7,
      ROOT_COMPONENT: 8,
      PLUGINS: 9,
      LOADOUTS: 10,
      PLUGIN_STORAGE: 11,
    })
  })

  it('keeps every declarative asset-owner catalog entry shared by discovery and legacy rewriting', () => {
    const catalogSource = readRepoFile('server/fastify/src/risuSave/assetOwnerCatalog.ts')
    const discoverySource = readRepoFile('server/fastify/src/risuSave/assetReferences.ts')
    const rewriteSource = readRepoFile('server/fastify/src/risuSave/localBackupDatabase.ts')
    const exportedCatalogNames = [...catalogSource.matchAll(/export const ([A-Z][A-Z_]+)/g)]
      .map((match) => match[1])
      .sort()

    expect(exportedCatalogNames).toEqual([...ASSET_CATALOG_NAMES].sort())
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
