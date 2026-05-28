// EC6 validator-needle carrier for character + character-order asset refs. In
// the real tree these are live validator calls in
// server/fastify/src/commands/characters.ts.
//
// Needles:
//   validateCharacterOrderLegacyImageRef(dataDir, entry.img
//   validateOptionalServerAssetRef(dataDir, value, label)
//   validateOptionalServerAssetRef(dataDir, entry.imgFile
//   validateCharacterOrderAssetRefs
//   'image' in record
//   validateOptionalServerAssetRef(dataDir, record.image
//   'emotionImages' in record
//   validateEmotionImageRefs(dataDir
//   'additionalAssets' in record
//   validateAssetTriples(dataDir
//   'ccAssets' in record
//   validateCcAssetRefs(dataDir
//   'vits' in record
//   validateVitsAssetRefs(dataDir
//   'prebuiltAssetExclude' in record
//   validateAssetIdList(dataDir
//   'gptSoVitsConfig' in record
//   validateGptSoVitsAssetRefs(dataDir
export const characterAssetValidatorNeedles = true
