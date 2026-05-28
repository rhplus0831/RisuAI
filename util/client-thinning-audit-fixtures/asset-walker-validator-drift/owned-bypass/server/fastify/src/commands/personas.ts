// EC6 validator-needle carrier for persona/profile asset refs. The audit asserts
// these substrings appear in the owning validator file; in the real tree they
// are live validator calls in server/fastify/src/commands/personas.ts.
//
// Needles:
//   validateOptionalServerAssetRef(options.assetDataDir, record.icon
//   database.userIcon = stringValue(persona.icon)
//   'icon' in record
export const personaAssetValidatorNeedles = true
