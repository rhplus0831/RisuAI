import { randomUUID } from 'node:crypto'
import { ValidationError } from '../repository.js'
import { normalizeScriptDefinitionCollection } from '../commands/scriptDefinitions.js'

type JsonRecord = Record<string, unknown>

const DEFAULT_SD_DATA: [string, string][] = [
  ['always', 'solo, 1girl'],
  ['negative', ''],
  ["|character's appearance", ''],
  ['current situation', ''],
  ["$character's pose", ''],
  ["$character's emotion", ''],
  ['current location', ''],
]

export interface RealmAssetSource {
  kind: 'resource' | 'bytes'
  id?: string
  bytes?: Buffer
  fileName?: string
  contentType?: string
}

export type RealmAssetStore = (source: RealmAssetSource) => Promise<string>

export class LowLevelAccessImportError extends ValidationError {
  constructor() {
    super('Character import requires low-level-access confirmation')
    this.name = 'LowLevelAccessImportError'
  }
}

export async function convertRealmCharacterCard(
  card: unknown,
  options: {
    mainImageId?: string
    storeAsset: RealmAssetStore
    allowLowLevelAccess?: boolean
    assetDict?: Record<string, string>
  },
): Promise<JsonRecord> {
  const root = readRecord(card, 'card')
  const spec = root.spec
  if (spec !== 'chara_card_v2' && spec !== 'chara_card_v3') {
    throw new ValidationError('Realm card must be chara_card_v2 or chara_card_v3')
  }

  const data = readRecord(root.data, 'card.data')
  const extensions = readOptionalRecord(data.extensions) ?? {}
  const risuExt = readOptionalRecord(extensions.risuai)
  if (risuExt?.lowLevelAccess && !options.allowLowLevelAccess) {
    throw new LowLevelAccessImportError()
  }

  let image = options.mainImageId
  let notificationImage = ''
  const emotions: [string, string][] = []
  const additionalAssets: [string, string, string][] = []
  const ccAssets: Array<{ type: string; uri: string; name: string; ext: string }> = []
  let vits: JsonRecord | null = null

  if (spec === 'chara_card_v2' && risuExt) {
    for (const entry of readArray(risuExt.emotions)) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') {
        continue
      }
      emotions.push([
        entry[0],
        await storeRisuV2Asset(entry[1], options.storeAsset, {
          assetDict: options.assetDict,
          defaultFileName: 'emotion.png',
        }),
      ])
    }

    for (const entry of readArray(risuExt.additionalAssets)) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') {
        continue
      }
      const fileName = typeof entry[2] === 'string' ? entry[2] : ''
      additionalAssets.push([
        entry[0],
        await storeRisuV2Asset(entry[1], options.storeAsset, {
          assetDict: options.assetDict,
          defaultFileName: fileName,
        }),
        fileName,
      ])
    }

    if (typeof risuExt.notificationImage === 'string' && risuExt.notificationImage) {
      notificationImage = await storeRisuV2Asset(risuExt.notificationImage, options.storeAsset, {
        assetDict: options.assetDict,
        defaultFileName: 'notification.png',
      })
    }

    const vitsFiles = readOptionalRecord(risuExt.vits)
    if (vitsFiles) {
      const files: JsonRecord = {}
      for (const [fileName, value] of Object.entries(vitsFiles)) {
        if (typeof value !== 'string') continue
        files[fileName] = await storeRisuV2Asset(value, options.storeAsset, {
          assetDict: options.assetDict,
          defaultFileName: fileName,
        })
      }
      if (Object.keys(files).length > 0) {
        vits = {
          name: 'Imported VITS',
          files,
          id: randomUUID().replace(/-/g, ''),
        }
      }
    }
  }

  if (spec === 'chara_card_v3') {
    for (const asset of readArray(data.assets)) {
      const record = readOptionalRecord(asset)
      if (!record) continue
      const uri = typeof record.uri === 'string' ? record.uri : ''
      const fileName = typeof record.name === 'string' ? record.name : ''
      const ext = typeof record.ext === 'string' ? record.ext : 'unknown'
      let assetId = ''

      if (uri === 'ccdefault:') {
        if (!image) continue
        assetId = image
      } else if (uri.startsWith('data:')) {
        assetId = await storeDataUri(uri, options.storeAsset, fileName)
      } else if (uri.startsWith('__asset:') || uri.startsWith('embeded://')) {
        const key = uri.startsWith('__asset:') ? uri.replace('__asset:', '') : uri.replace('embeded://', '')
        assetId = options.assetDict?.[key] ?? ''
        if (!assetId) {
          throw new ValidationError(`Embedded card asset not found: ${key}`)
        }
      } else {
        continue
      }

      const type = typeof record.type === 'string' ? record.type : 'asset'
      if (type === 'emotion') {
        emotions.push([fileName, assetId])
      } else if (type === 'x-risu-asset') {
        additionalAssets.push([fileName, assetId, ext])
      } else if (type === 'x-risu-notification-image') {
        notificationImage = assetId
      } else if (type === 'icon' && fileName === 'main') {
        image = assetId
      } else {
        ccAssets.push({ type, uri: assetId, name: fileName, ext })
      }
    }
  }

  const converted = convertCharbook(readOptionalRecord(data.character_book))

  const passthroughExtensions = cloneJson(extensions)
  delete passthroughExtensions.risuai
  delete passthroughExtensions.depth_prompt

  const character: JsonRecord = {
    name: readString(data.name),
    firstMessage: readString(data.first_mes),
    desc: readString(data.description),
    notes: '',
    chats: [
      {
        id: randomUUID(),
        message: [],
        note: '',
        name: 'Chat 1',
        localLore: [],
      },
    ],
    chatPage: 0,
    image,
    notificationImage: notificationImage || readString(risuExt?.notificationImage),
    emotionImages: emotions,
    bias: readTupleArray(risuExt?.bias),
    globalLore: converted.lorebook,
    viewScreen: readViewScreen(risuExt?.viewScreen),
    chaId: randomUUID(),
    sdData: readSdData(risuExt?.sdData),
    utilityBot: risuExt?.utilityBot === true,
    customscript: readArray(risuExt?.customScripts),
    exampleMessage: readString(data.mes_example),
    creatorNotes: readString(data.creator_notes),
    systemPrompt: readString(data.system_prompt),
    postHistoryInstructions: '',
    alternateGreetings: readStringArray(data.alternate_greetings),
    tags: readStringArray(data.tags),
    creator: readString(data.creator),
    characterVersion: String(data.character_version ?? ''),
    personality: readString(data.personality),
    scenario: readString(data.scenario),
    firstMsgIndex: -1,
    removedQuotes: false,
    loreSettings: converted.loreSettings,
    loreExt: converted.loreExt,
    additionalData: {
      tag: readStringArray(data.tags),
      creator: readString(data.creator),
      character_version: data.character_version,
    },
    additionalAssets,
    replaceGlobalNote: readString(data.post_history_instructions),
    backgroundHTML: risuExt?.backgroundHTML,
    license: risuExt?.license,
    triggerscript: readArray(risuExt?.triggerscript),
    private: risuExt?.private === true,
    customNotificationMessage: readString(risuExt?.customNotificationMessage),
    additionalText: readString(risuExt?.additionalText),
    virtualscript: '',
    extentions: passthroughExtensions,
    largePortrait: typeof risuExt?.largePortrait === 'boolean' ? risuExt.largePortrait : !risuExt,
    lorePlus: risuExt?.lorePlus === true,
    inlayViewScreen: risuExt?.inlayViewScreen === true,
    newGenData: risuExt?.newGenData,
    vits,
    ttsMode: vits ? 'vits' : 'normal',
    imported: true,
    source: readStringArray(data.source).length > 0 ? readStringArray(data.source) : readStringArray(risuExt?.source),
    ccAssets,
    lowLevelAccess: risuExt?.lowLevelAccess === true,
    defaultVariables: readString(risuExt?.defaultVariables),
    chatFolders: [],
    prebuiltAssetCommand: readString(risuExt?.prebuiltAssetCommand),
    prebuiltAssetExclude: readStringArray(risuExt?.prebuiltAssetExclude),
    prebuiltAssetStyle: readString(risuExt?.prebuiltAssetStyle),
  }

  if (spec === 'chara_card_v3') {
    character.group_only_greetings = readStringArray(data.group_only_greetings)
    character.nickname = readString(data.nickname)
    character.creation_date = typeof data.creation_date === 'number' ? data.creation_date : 0
    character.modification_date = typeof data.modification_date === 'number' ? data.modification_date : 0
  }

  normalizeScriptDefinitionCollection({ characters: [character] })

  return character
}

async function storeRisuV2Asset(
  value: string,
  storeAsset: RealmAssetStore,
  options: { assetDict?: Record<string, string>; defaultFileName?: string },
): Promise<string> {
  if (value.startsWith('__asset:')) {
    const key = value.replace('__asset:', '')
    const assetId = options.assetDict?.[key]
    if (!assetId) {
      throw new ValidationError(`Embedded card asset not found: ${key}`)
    }
    return assetId
  }
  return storeAsset({
    kind: 'resource',
    id: value,
    fileName: options.defaultFileName || 'asset.png',
  })
}

async function storeDataUri(uri: string, storeAsset: RealmAssetStore, fileName: string): Promise<string> {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri)
  if (!match || match[2] !== ';base64') {
    throw new ValidationError('Only base64 data URI card assets are supported')
  }
  return storeAsset({
    kind: 'bytes',
    bytes: Buffer.from(match[3], 'base64'),
    fileName,
    contentType: match[1] || undefined,
  })
}

function convertCharbook(charbook: JsonRecord | null): {
  lorebook: JsonRecord[]
  loreSettings?: JsonRecord
  loreExt?: unknown
} {
  if (!charbook) return { lorebook: [] }

  const lorebook: JsonRecord[] = []
  const loreSettings =
    typeof charbook.recursive_scanning === 'boolean' &&
    typeof charbook.scan_depth === 'number' &&
    typeof charbook.token_budget === 'number'
      ? {
          tokenBudget: charbook.token_budget,
          scanDepth: charbook.scan_depth,
          recursiveScanning: charbook.recursive_scanning,
          fullWordMatching: readOptionalRecord(charbook.extensions)?.risu_fullWordMatching === true,
        }
      : undefined
  const loreExt = charbook.extensions

  for (const entry of readArray(charbook.entries)) {
    const book = readOptionalRecord(entry)
    if (!book) continue
    const keys = readStringArray(book.keys)
    const secondaryKeys = readStringArray(book.secondary_keys)
    let content = readString(book.content)
    const extensions = cloneJson(readOptionalRecord(book.extensions) ?? {})

    if (
      extensions.useProbability === true &&
      typeof extensions.probability === 'number' &&
      extensions.probability !== 100
    ) {
      content = `@@probability ${extensions.probability}\n${content}`
      delete extensions.useProbability
      delete extensions.probability
    }
    if (extensions.position === 4 && typeof extensions.depth === 'number' && typeof extensions.role === 'number') {
      const role = ['system', 'user', 'assistant'][extensions.role] ?? 'system'
      content = `@@depth ${extensions.depth}\n@@role ${role}\n${content}`
      delete extensions.position
      delete extensions.depth
      delete extensions.role
    }
    if (typeof extensions.delay === 'number' && extensions.delay > 0) {
      content = `@@activate_only_after ${extensions.delay}\n${content}`
      delete extensions.delay
    }
    if (extensions.match_whole_words === true) {
      content = `@@match_full_word\n${content}`
      delete extensions.match_whole_words
    } else if (extensions.match_whole_words === false) {
      content = `@@match_partial_word\n${content}`
      delete extensions.match_whole_words
    }

    lorebook.push({
      id: randomUUID(),
      key: keys.join(', '),
      secondkey: secondaryKeys.join(', '),
      insertorder: typeof book.insertion_order === 'number' ? book.insertion_order : 0,
      comment: readString(book.name) || readString(book.comment),
      content,
      mode: readString(book.mode) || 'normal',
      alwaysActive: book.constant === true,
      selective: book.selective === true,
      extentions: {
        ...extensions,
        risu_case_sensitive: book.case_sensitive === true,
      },
      activationPercent: extensions.risu_activationPercent,
      loreCache: extensions.risu_loreCache ?? null,
      useRegex: book.use_regex === true,
      folder: book.folder,
    })
  }

  return { lorebook, loreSettings, loreExt }
}

function readRecord(value: unknown, label: string): JsonRecord {
  const record = readOptionalRecord(value)
  if (!record) throw new ValidationError(`${label} must be an object`)
  return record
}

function readOptionalRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readStringArray(value: unknown): string[] {
  return readArray(value).filter((entry): entry is string => typeof entry === 'string')
}

function readTupleArray(value: unknown): [string, number][] {
  return readArray(value).filter(
    (entry): entry is [string, number] =>
      Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number',
  )
}

function readSdData(value: unknown): [string, string][] {
  const tuples = readArray(value).filter(
    (entry): entry is [string, string] =>
      Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string',
  )
  return tuples.length > 0 ? tuples : cloneJson(DEFAULT_SD_DATA)
}

function readViewScreen(value: unknown): 'none' | 'emotion' | 'imggen' {
  return value === 'emotion' || value === 'imggen' ? value : 'none'
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
