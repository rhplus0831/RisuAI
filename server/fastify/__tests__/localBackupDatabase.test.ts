import { describe, expect, it } from 'vitest'
import type { PersistedAsset } from '../src/repository.js'
import {
  normalizeLegacyLocalBackupImportDatabase,
  prepareLegacyLocalBackupExportDatabase,
} from '../src/risuSave/localBackupDatabase.js'

const ASSET_ID = 'a'.repeat(64)
const ASSET_PATH = `assets/${ASSET_ID}.png`
const NON_ASSET_PATH = 'assets/not-a-server-id.png'

const asset: PersistedAsset = {
  id: ASSET_ID,
  ext: 'png',
  size: 123,
  contentType: 'image/png',
}

function databaseWithKnownReferences(reference: string): Record<string, unknown> {
  const inlay = `before {{inlay::${reference}}} after`
  return {
    userIcon: reference,
    customBackground: reference,
    NAIImgConfig: {
      image: reference,
      character_image: reference,
      base64image: ASSET_ID,
    },
    wavespeedImage: {
      reference_image: reference,
      reference_base64image: ASSET_ID,
    },
    personas: [{ icon: reference }],
    characterOrder: [{ img: reference, imgFile: reference }],
    botPresets: [{ image: reference }],
    modelPresets: [{ image: reference }],
    promptPresets: [{ image: reference }],
    modules: [{ assets: [['module file', reference, 'png']] }],
    characters: [
      {
        image: reference,
        notificationImage: reference,
        emotionImages: [['happy', reference]],
        additionalAssets: [['manual', reference, 'png']],
        chats: [{ message: [{ data: inlay }] }],
        ccAssets: [{ uri: reference }],
        vits: { files: { model: reference, config: reference } },
        prebuiltAssetExclude: [reference],
        gptSoVitsConfig: { ref_audio_data: { assetId: reference } },
        firstMessage: inlay,
        backgroundHTML: inlay,
        creatorNotes: inlay,
        name: inlay,
        nickname: inlay,
        desc: inlay,
        personality: inlay,
        scenario: inlay,
        exampleMessage: inlay,
        alternateGreetings: [inlay, 42],
        systemPrompt: ASSET_ID,
      },
    ],
    pluginCustomStorage: {
      plugin: {
        direct: reference,
        nested: [{ retained: reference, ignored: NON_ASSET_PATH }],
      },
    },
    unrelatedJson: { rawAssetId: ASSET_ID },
  }
}

describe('legacy local-backup database asset-reference rewriting', () => {
  it('rewrites every supported durable reference for original-Risu export without touching unrelated strings', () => {
    const database = databaseWithKnownReferences(ASSET_ID)
    const prepared = prepareLegacyLocalBackupExportDatabase(database, [asset])

    expect(prepared).toEqual(databaseWithKnownReferences(ASSET_PATH))
    expect(database).toEqual(databaseWithKnownReferences(ASSET_ID))
  })

  it('canonicalizes every supported original-Risu reference on import without touching unrelated strings', () => {
    const normalized = normalizeLegacyLocalBackupImportDatabase(databaseWithKnownReferences(ASSET_PATH))

    expect(normalized).toEqual(databaseWithKnownReferences(ASSET_ID))
  })

  it('applies custom record aliases in newly covered nested fields', () => {
    const customPath = 'assets/custom-backup-record.png'
    const normalized = normalizeLegacyLocalBackupImportDatabase(
      {
        NAIImgConfig: { character_image: customPath },
        characters: [{ firstMessage: `{{inlayed::${customPath}}}` }],
        pluginCustomStorage: { plugin: [{ asset: customPath }] },
        unrelated: customPath,
      },
      new Map([[customPath, ASSET_ID]]),
    )

    expect(normalized).toEqual({
      NAIImgConfig: { character_image: ASSET_ID },
      characters: [{ firstMessage: `{{inlayed::${ASSET_ID}}}` }],
      pluginCustomStorage: { plugin: [{ asset: ASSET_ID }] },
      unrelated: customPath,
    })
  })
})
