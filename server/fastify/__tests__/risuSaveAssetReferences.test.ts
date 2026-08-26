import { describe, expect, it } from 'vitest'
import { buildRisuSaveAssetReport, summarizeRisuSaveAssetReport } from '../src/risuSave/assetReferences.js'
import type { PersistedAsset } from '../src/repository.js'

const CHAR_IMAGE = 'a'.repeat(64)
const NOTIFICATION_IMAGE = 'ab'.repeat(32)
const EMOTION = 'b'.repeat(64)
const ADDITIONAL = 'c'.repeat(64)
const VITS = 'd'.repeat(64)
const CC_ASSET = 'e'.repeat(64)
const USER_ICON = 'f'.repeat(64)
const CUSTOM_BACKGROUND = '1'.repeat(64)
const PERSONA_ICON = '2'.repeat(64)
const FOLDER_IMG = '3'.repeat(64)
const FOLDER_IMG_FILE = '4'.repeat(64)
const PRESET_IMAGE = '5'.repeat(64)
const MODULE_ASSET = '6'.repeat(64)
const PREBUILT_EXCLUDE = '7'.repeat(64)
const GPT_SOVITS_REF = '8'.repeat(64)
const MISSING = '9'.repeat(64)
const ORPHANED = '0'.repeat(64)
const CHAT_INLAY = 'a1'.repeat(32)

function asset(id: string): PersistedAsset {
  return { id, ext: 'png', size: 1, contentType: 'image/png' }
}

describe('RISUSAVE asset reference walker', () => {
  it('walks known server asset fields and compares repository metadata', () => {
    const report = buildRisuSaveAssetReport(
      {
        userIcon: USER_ICON,
        customBackground: CUSTOM_BACKGROUND,
        personas: [{ id: 'persona-a', icon: PERSONA_ICON }],
        characterOrder: [
          'char-a',
          {
            id: 'folder-a',
            name: 'Folder',
            data: ['char-a'],
            img: FOLDER_IMG,
            imgFile: FOLDER_IMG_FILE,
          },
        ],
        botPresets: [{ id: 'preset-a', image: PRESET_IMAGE }],
        modules: [{ id: 'module-a', assets: [['module asset', MODULE_ASSET, 'png']] }],
        characters: [
          {
            chaId: 'char-a',
            image: CHAR_IMAGE,
            notificationImage: NOTIFICATION_IMAGE,
            emotionImages: [['happy', EMOTION]],
            additionalAssets: [['manual', ADDITIONAL, 'png']],
            chats: [
              {
                id: 'chat-a',
                message: [
                  {
                    chatId: 'message-a',
                    role: 'user',
                    data: `look {{inlayeddata::${CHAT_INLAY}}}`,
                  },
                ],
              },
            ],
            vits: { id: 'vits-a', files: { model: VITS } },
            ccAssets: [{ type: 'icon', uri: CC_ASSET, name: 'main', ext: 'png' }],
            prebuiltAssetExclude: [PREBUILT_EXCLUDE],
            gptSoVitsConfig: { ref_audio_data: { fileName: 'ref.wav', assetId: GPT_SOVITS_REF } },
          },
          {
            chaId: 'char-b',
            image: MISSING,
          },
        ],
      },
      [
        asset(CHAR_IMAGE),
        asset(NOTIFICATION_IMAGE),
        asset(EMOTION),
        asset(ADDITIONAL),
        asset(VITS),
        asset(CC_ASSET),
        asset(USER_ICON),
        asset(CUSTOM_BACKGROUND),
        asset(PERSONA_ICON),
        asset(FOLDER_IMG),
        asset(FOLDER_IMG_FILE),
        asset(PRESET_IMAGE),
        asset(MODULE_ASSET),
        asset(PREBUILT_EXCLUDE),
        asset(GPT_SOVITS_REF),
        asset(CHAT_INLAY),
        asset(ORPHANED),
      ],
    )

    expect(summarizeRisuSaveAssetReport(report)).toEqual({
      referencedCount: 17,
      missingCount: 1,
      orphanedCount: 1,
    })
    expect(report.referenced).toContainEqual({
      id: NOTIFICATION_IMAGE,
      paths: ['database.characters[0].notificationImage'],
    })
    expect(report.missing).toEqual([
      {
        id: MISSING,
        paths: ['database.characters[1].image'],
      },
    ])
    expect(report.orphaned).toEqual([asset(ORPHANED)])
  })

  it('deduplicates repeated ids while preserving every known reference path', () => {
    const report = buildRisuSaveAssetReport(
      {
        userIcon: USER_ICON,
        personas: [{ id: 'persona-a', icon: USER_ICON }],
        characters: [{ chaId: 'char-a', image: USER_ICON, notificationImage: USER_ICON }],
      },
      [asset(USER_ICON)],
    )

    expect(report.referenced).toEqual([
      {
        id: USER_ICON,
        paths: [
          'database.characters[0].image',
          'database.characters[0].notificationImage',
          'database.personas[0].icon',
          'database.userIcon',
        ],
      },
    ])
    expect(summarizeRisuSaveAssetReport(report)).toEqual({
      referencedCount: 1,
      missingCount: 0,
      orphanedCount: 0,
    })
  })

  it('accepts legacy local asset paths that the Fastify client can read', () => {
    const report = buildRisuSaveAssetReport(
      {
        customBackground: `assets/${CUSTOM_BACKGROUND}.webp`,
        userIcon: `assets/${USER_ICON}.png`,
      },
      [asset(USER_ICON), asset(CUSTOM_BACKGROUND)],
    )

    expect(report.referenced).toEqual([
      {
        id: CUSTOM_BACKGROUND,
        paths: ['database.customBackground'],
      },
      {
        id: USER_ICON,
        paths: ['database.userIcon'],
      },
    ])
    expect(summarizeRisuSaveAssetReport(report)).toEqual({
      referencedCount: 2,
      missingCount: 0,
      orphanedCount: 0,
    })
  })

  it('walks nested image settings, split presets, character text inlays, and plugin storage', () => {
    const report = buildRisuSaveAssetReport(
      {
        NAIImgConfig: {
          image: CHAR_IMAGE,
          character_image: `assets/${EMOTION}.png`,
          base64image: 'data:image/png;base64,ignored',
        },
        wavespeedImage: { reference_image: ADDITIONAL, reference_base64image: 'ignored-inline-data' },
        modelPresets: [{ image: VITS }],
        promptPresets: [{ image: CC_ASSET }],
        characters: [
          {
            firstMessage: `{{inlay::${USER_ICON}}}`,
            alternateGreetings: [`{{inlayed::${CUSTOM_BACKGROUND}}}`],
            backgroundHTML: `{{inlayeddata::${PERSONA_ICON}}}`,
            creatorNotes: `{{inlay::${FOLDER_IMG}}}`,
            desc: `{{inlay::${FOLDER_IMG_FILE}}}`,
          },
        ],
        pluginCustomStorage: {
          'plugin-a': { nested: [{ retained: `assets/${MODULE_ASSET}.webp` }] },
        },
      },
      [
        asset(CHAR_IMAGE),
        asset(EMOTION),
        asset(ADDITIONAL),
        asset(VITS),
        asset(CC_ASSET),
        asset(USER_ICON),
        asset(CUSTOM_BACKGROUND),
        asset(PERSONA_ICON),
        asset(FOLDER_IMG),
        asset(FOLDER_IMG_FILE),
        asset(MODULE_ASSET),
      ],
    )

    expect(summarizeRisuSaveAssetReport(report)).toEqual({
      referencedCount: 11,
      missingCount: 0,
      orphanedCount: 0,
    })
    expect(report.referenced).toContainEqual({
      id: MODULE_ASSET,
      paths: ['database.pluginCustomStorage["plugin-a"]["nested"][0]["retained"]'],
    })
    expect(report.referenced).toContainEqual({
      id: USER_ICON,
      paths: ['database.characters[0].firstMessage.inlay'],
    })
  })

  it('ignores non-server asset strings instead of recursively over-including arbitrary JSON', () => {
    const report = buildRisuSaveAssetReport(
      {
        customBackground: 'assets/not-a-server-id.png',
        unrelatedJson: { arbitrary: CHAR_IMAGE },
        characters: [
          {
            chaId: 'char-a',
            image: '',
            emotionImages: [['happy', 'http://example.test/happy.png']],
            additionalAssets: [['manual', '-', 'png']],
            ccAssets: [{ type: 'icon', uri: 'data:image/png;base64,abc', name: 'main', ext: 'png' }],
          },
        ],
      },
      [asset(USER_ICON), asset(CHAR_IMAGE)],
    )

    expect(report.referenced).toEqual([])
    expect(summarizeRisuSaveAssetReport(report)).toEqual({
      referencedCount: 0,
      missingCount: 0,
      orphanedCount: 2,
    })
  })
})
