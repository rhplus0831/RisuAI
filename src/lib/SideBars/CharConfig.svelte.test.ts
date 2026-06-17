import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function charConfigSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/lib/SideBars/CharConfig.svelte'), 'utf8')
}

function sourceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle)
  const end = source.indexOf(endNeedle, start + startNeedle.length)

  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)

  return source.slice(start, end)
}

describe('CharConfig character TTS media callback freshness contracts', () => {
  it('routes VITS and GPT-SoVITS media buttons through guarded helper functions', () => {
    const source = charConfigSource()

    expect(source).toContain("from 'src/ts/server/characterTtsAssetUpload'")
    expect(source).toContain("import { registerOnnxModelFromFile } from 'src/ts/process/transformers'")
    expect(source).toContain('async function registerVitsModelFromEditor()')
    expect(source).toContain('async function uploadGptSoVitsReferenceAudioFromEditor()')
    expect(source).toContain('onclick={registerVitsModelFromEditor}')
    expect(source).toContain('onclick={uploadGptSoVitsReferenceAudioFromEditor}')
    expect(source).not.toContain('onclick={async () => {\n          const model = await registerOnnxModel()')
    expect(source).not.toContain("import { registerOnnxModel } from 'src/ts/process/transformers'")
  })

  it('selects VITS files before issuing a token and guards registration before final apply', () => {
    const source = charConfigSource()
    const body = sourceBetween(
      source,
      'async function registerVitsModelFromEditor()',
      'async function uploadGptSoVitsReferenceAudioFromEditor()',
    )

    expect(body.indexOf("const selected = (await selectSingleFile(['zip']))")).toBeLessThan(
      body.indexOf('const operation = beginCharacterTtsAssetUpload(target)'),
    )
    expect(body).toContain('if (!selected) return')
    expect(body).toContain('if (!isCurrentEditorTtsAssetUpload(operation)) return')
    expect(body).toContain('const model = await registerOnnxModelFromFile(selected, {')
    expect(body).toContain('shouldContinue: () => isCurrentEditorTtsAssetUpload(operation)')
    expect(body).toContain('applyFreshCharacterVitsModelRegistration({')
    expect(body).toContain('character.vits = nextModel')
    expect(body).toContain('clearCharacterTtsAssetUpload(operation)')
    expect(body).not.toContain('character.vits = model')
  })

  it('selects GPT-SoVITS audio before issuing a token and guards saveAsset before final apply', () => {
    const source = charConfigSource()
    const body = sourceBetween(
      source,
      'async function uploadGptSoVitsReferenceAudioFromEditor()',
      'function clearOrRotateCharacterImage()',
    )

    expect(body.indexOf("const audio = (await selectSingleFile(['wav', 'ogg', 'aac', 'mp3']))")).toBeLessThan(
      body.indexOf('const operation = beginCharacterTtsAssetUpload(target)'),
    )
    expect(body).toContain('if (!audio) return')
    expect(body).toContain('if (!isCurrentEditorTtsAssetUpload(operation)) return')
    expect(body).toContain('const saveId = await saveAsset(audio.data)')
    expect(body).toContain('applyFreshCharacterGptSoVitsReferenceAudioUpload({')
    expect(body).toContain('character.gptSoVitsConfig.ref_audio_data = nextRefAudioData')
    expect(body).toContain('clearCharacterTtsAssetUpload(operation)')
    expect(body).not.toContain('character.gptSoVitsConfig.ref_audio_data = {\n              fileName: audio.name')
  })
})
