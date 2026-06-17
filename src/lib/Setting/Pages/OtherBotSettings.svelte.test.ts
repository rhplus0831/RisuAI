import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function otherBotSettingsSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/lib/Setting/Pages/OtherBotSettings.svelte'), 'utf8')
}

function extractFunctionBody(source: string, functionSignature: string): string {
  const functionStart = source.indexOf(functionSignature)
  expect(functionStart).toBeGreaterThanOrEqual(0)

  const bodyStart = source.indexOf('{', functionStart)
  expect(bodyStart).toBeGreaterThanOrEqual(0)

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]

    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(bodyStart + 1, index)
      }
    }
  }

  throw new Error(`Could not find the end of ${functionSignature}`)
}

describe('OtherBotSettings settings media upload wiring', () => {
  it('routes all image upload buttons through the guarded settings media upload helper', () => {
    const source = otherBotSettingsSource()

    expect(source).toContain("from 'src/ts/server/settingsMediaAssetUpload'")
    expect(source).toContain('onclick={uploadNaiCharacterReferenceImage}')
    expect(source).toContain('onclick={uploadNaiI2IBaseImage}')
    expect(source).toContain('onclick={uploadWavespeedReferenceImage}')
  })

  it('selects a file before issuing an upload token and exits when no file is selected', () => {
    const source = otherBotSettingsSource()
    const uploadBody = extractFunctionBody(
      source,
      'async function uploadSettingsMediaAsset(target: SettingsMediaAssetUploadTarget): Promise<void>',
    )

    const fileSelectIndex = uploadBody.indexOf("const img = await selectSingleFile(['jpg', 'jpeg', 'png', 'webp'])")
    const noFileReturnIndex = uploadBody.indexOf('if (!img) {\n      return\n    }')
    const beginIndex = uploadBody.indexOf('const operation = beginSettingsMediaAssetUpload(target)')

    expect(fileSelectIndex).toBeGreaterThanOrEqual(0)
    expect(noFileReturnIndex).toBeGreaterThan(fileSelectIndex)
    expect(beginIndex).toBeGreaterThan(noFileReturnIndex)
  })

  it('checks freshness before and after saveAsset before writing the uploaded asset fields', () => {
    const source = otherBotSettingsSource()
    const uploadBody = extractFunctionBody(
      source,
      'async function uploadSettingsMediaAsset(target: SettingsMediaAssetUploadTarget): Promise<void>',
    )

    const firstFreshnessIndex = uploadBody.indexOf('if (!isCurrentSettingsMediaAssetUpload(operation)) return')
    const saveAssetIndex = uploadBody.indexOf('const saveId = await saveAsset(imageData)')
    const secondFreshnessIndex = uploadBody.indexOf(
      'if (!isCurrentSettingsMediaAssetUpload(operation)) return',
      firstFreshnessIndex + 1,
    )
    const applyFreshIndex = uploadBody.indexOf('const nextConfig = applyFreshSettingsMediaAssetUpload({')
    const writeConfigIndex = uploadBody.indexOf('writeSettingsMediaAssetUploadConfig(operation, nextConfig)')

    expect(firstFreshnessIndex).toBeGreaterThanOrEqual(0)
    expect(saveAssetIndex).toBeGreaterThan(firstFreshnessIndex)
    expect(secondFreshnessIndex).toBeGreaterThan(saveAssetIndex)
    expect(applyFreshIndex).toBeGreaterThan(secondFreshnessIndex)
    expect(writeConfigIndex).toBeGreaterThan(applyFreshIndex)
  })

  it('does not write uploaded save ids directly into provider draft fields', () => {
    const source = otherBotSettingsSource()

    expect(source).not.toContain('NAIImgConfigDraft.value.image = saveId')
    expect(source).not.toContain('NAIImgConfigDraft.value.character_image = saveId')
    expect(source).not.toContain('wavespeedImageDraft.value.reference_image = saveId')
  })
})

describe('OtherBotSettings NovelAI vibe import wiring', () => {
  it('routes NovelAI vibe imports through the freshness guard helper', () => {
    const source = otherBotSettingsSource()

    expect(source).toContain("from 'src/ts/server/naiVibeImport'")
    expect(source).toContain('async function importNaiVibeFile()')
    expect(source).toContain('onclick={importNaiVibeFile}')
    expect(source).toContain("selectSingleFile(['naiv4vibe'], { onFileSelected: beginImport })")
    expect(source).toContain('const vibeData = parseNaiVibeImport')
    expect(source).toContain('resolveFreshNaiVibeImportPatch')
  })

  it('issues the import token from onFileSelected and does not invalidate on canceled picker', () => {
    const source = otherBotSettingsSource()
    const importBody = extractFunctionBody(source, 'async function importNaiVibeFile(): Promise<void>')

    const targetIndex = importBody.indexOf('const target = captureNaiVibeImportTarget')
    const operationIndex = importBody.indexOf('let operation: NaiVibeImportOperation | null = null')
    const beginFunctionIndex = importBody.indexOf('const beginImport = () => {')
    const selectIndex = importBody.indexOf(
      "const selected = await selectSingleFile(['naiv4vibe'], { onFileSelected: beginImport })",
    )
    const noSelectedReturnIndex = importBody.indexOf('if (!selected) return')
    const beginAfterSelectedIndex = importBody.indexOf('beginImport()', selectIndex)

    expect(targetIndex).toBeGreaterThanOrEqual(0)
    expect(operationIndex).toBeGreaterThan(targetIndex)
    expect(beginFunctionIndex).toBeGreaterThan(operationIndex)
    expect(selectIndex).toBeGreaterThan(beginFunctionIndex)
    expect(noSelectedReturnIndex).toBeGreaterThan(selectIndex)
    expect(beginAfterSelectedIndex).toBeGreaterThan(noSelectedReturnIndex)
  })

  it('guards invalid-file alerts and applies only a narrow vibe patch', () => {
    const source = otherBotSettingsSource()
    const importBody = extractFunctionBody(source, 'async function importNaiVibeFile(): Promise<void>')

    const invalidIndex = importBody.indexOf('if (vibeData === null) {')
    const freshnessIndex = importBody.indexOf('if (isFreshNaiVibeImport(operation, currentNaiVibeImportFreshness()))')
    const alertIndex = importBody.indexOf("alertError('Invalid vibe file. Version must be 1.')")
    const patchIndex = importBody.indexOf('const patch = resolveFreshNaiVibeImportPatch({')
    const mergeIndex = importBody.indexOf('NAIImgConfigDraft.value = { ...NAIImgConfigDraft.value, ...patch }')

    expect(invalidIndex).toBeGreaterThanOrEqual(0)
    expect(freshnessIndex).toBeGreaterThan(invalidIndex)
    expect(alertIndex).toBeGreaterThan(freshnessIndex)
    expect(patchIndex).toBeGreaterThan(alertIndex)
    expect(mergeIndex).toBeGreaterThan(patchIndex)
    expect(importBody).not.toContain('NAIImgConfigDraft.value.vibe_data = vibeData')
    expect(importBody).not.toContain('NAIImgConfigDraft.value.reference_image_multiple = []')
    expect(importBody).not.toContain('NAIImgConfigDraft.value.width')
    expect(importBody).not.toContain('NAIImgConfigDraft.value.height')
    expect(importBody).not.toContain('NAIImgConfigDraft.value.sampler')
  })

  it('does not mix the vibe import slice with EasyPanel or separate-parameters imports', () => {
    const source = otherBotSettingsSource()
    const importBody = extractFunctionBody(source, 'async function importNaiVibeFile(): Promise<void>')

    expect(importBody).not.toContain('EasyPanel')
    expect(importBody).not.toContain('AllSeperateParameters')
    expect(importBody).not.toContain('seperate')
    expect(importBody).not.toContain('additional')
  })
})
