// EC6 validator-needle carrier for the display settings command. In the real
// tree these are live validator calls in server/fastify/src/routes/commands.ts.
//
// Needles:
//   validateSettingsAssetRefs(dataDir, patch)
//   'customBackground' in patch
//   validateOptionalServerAssetRef(dataDir, patch.customBackground, 'customBackground')
export const settingsAssetValidatorNeedles = true
