// Minimal fixture for the EC6 asset walker validator drift rule. The audit
// extracts every collector call inside collectRisuSaveAssetReferences and
// requires a matching entry in the audit's ASSET_WALKER_OWNERS table, plus the
// owner's validator needles in the owning validator file. This walker mirrors
// the real server/fastify/src/risuSave/assetReferences.ts so collected fields
// equal the owner table exactly.

type Found = Map<string, Set<string>>

function collectRisuSaveAssetReferences(database: unknown): unknown[] {
  const found: Found = new Map<string, Set<string>>()
  const root = readRecord(database)
  if (!root) return []

  addReference(found, root.userIcon, 'database.userIcon')
  addReference(found, root.customBackground, 'database.customBackground')

  readArray(root.personas).forEach((persona, index) => {
    const record = readRecord(persona)
    if (!record) return
    addReference(found, record.icon, `database.personas[${index}].icon`)
  })

  readArray(root.characterOrder).forEach((entry, index) => {
    const record = readRecord(entry)
    if (!record) return
    addReference(found, record.img, `database.characterOrder[${index}].img`)
    addReference(found, record.imgFile, `database.characterOrder[${index}].imgFile`)
  })

  readArray(root.botPresets).forEach((preset, index) => {
    const record = readRecord(preset)
    if (!record) return
    addReference(found, record.image, `database.botPresets[${index}].image`)
  })

  readArray(root.modules).forEach((module, index) => {
    const record = readRecord(module)
    if (!record) return
    addTupleReferences(found, record.assets, `database.modules[${index}].assets`)
  })

  readArray(root.characters).forEach((character, index) => {
    const record = readRecord(character)
    if (!record) return
    const prefix = `database.characters[${index}]`
    addReference(found, record.image, `${prefix}.image`)
    addTupleReferences(found, record.emotionImages, `${prefix}.emotionImages`)
    addTupleReferences(found, record.additionalAssets, `${prefix}.additionalAssets`)
    addCcAssetReferences(found, record.ccAssets, `${prefix}.ccAssets`)
    addVitsReferences(found, record.vits, `${prefix}.vits.files`)
    addReferenceList(found, record.prebuiltAssetExclude, `${prefix}.prebuiltAssetExclude`)
    addGptSoVitsReference(found, record.gptSoVitsConfig, `${prefix}.gptSoVitsConfig`)
  })

  return [...found.entries()]
}

// Collector + reader stubs. The audit only reads the AST of the calls above, so
// these bodies are intentionally inert.
function addReference(_f: Found, _v: unknown, _l: string): void {}
function addTupleReferences(_f: Found, _v: unknown, _l: string): void {}
function addCcAssetReferences(_f: Found, _v: unknown, _l: string): void {}
function addVitsReferences(_f: Found, _v: unknown, _l: string): void {}
function addReferenceList(_f: Found, _v: unknown, _l: string): void {}
function addGptSoVitsReference(_f: Found, _v: unknown, _l: string): void {}
function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export { collectRisuSaveAssetReferences }
