/**
 * Strict persisted asset-owner vocabulary shared by portable save discovery
 * and legacy local-backup rewriting. Specialized shapes (VITS maps, CC asset
 * objects, GPT-SoVITS, chat/text inlays, and arbitrary plugin storage) use the
 * same top-level owners but retain their shape-specific handlers.
 *
 * Keep this catalog narrow: arbitrary JSON outside pluginCustomStorage must
 * not become an asset owner merely because it contains a sha256-looking value.
 */
export const ROOT_ASSET_REFERENCE_FIELDS = ['userIcon', 'customBackground'] as const

export const NESTED_ASSET_REFERENCE_FIELDS = [
  { owner: 'NAIImgConfig', fields: ['image', 'character_image'] },
  { owner: 'wavespeedImage', fields: ['reference_image'] },
] as const

export const COLLECTION_ASSET_IMAGE_OWNERS = ['botPresets', 'modelPresets', 'promptPresets'] as const

export const CHARACTER_ASSET_REFERENCE_FIELDS = ['image', 'notificationImage'] as const

export const CHARACTER_ASSET_TUPLE_FIELDS = ['emotionImages', 'additionalAssets'] as const

export const CHARACTER_ASSET_REFERENCE_LIST_FIELDS = ['prebuiltAssetExclude'] as const

export const CHARACTER_TEXT_INLAY_FIELDS = [
  'firstMessage',
  'backgroundHTML',
  'creatorNotes',
  'name',
  'nickname',
  'desc',
  'personality',
  'scenario',
  'exampleMessage',
] as const
