import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/lib/Setting/Pages/BotSettings.svelte'), 'utf8')

describe('BotSettings icon action names', () => {
  it.each([
    'aria-label={`${language.add}: ${language.customStopWords}`}',
    'aria-label={`${language.remove}: ${language.customStopWords} ${i + 1}`}',
    'aria-label={`${language.add}: Bias`}',
    'aria-label={`${language.remove}: Bias ${i + 1}`}',
    'aria-label={`${language.export}: Bias`}',
    'aria-label={`${language.import}: Bias`}',
    'aria-label={`${language.add}: ${language.additionalParams}`}',
    'aria-label={`${language.remove}: ${language.additionalParams} ${i + 1}`}',
    'aria-label={`${language.import}: ${language.icon}`}',
  ])('keeps %s on its icon action', (label) => {
    expect(source).toContain(label)
  })
})

describe('BotSettings direct slider names', () => {
  it('keeps every direct slider named for its parameter in each mutually exclusive model section', () => {
    const sliderTags = source.match(/<SliderInput\b[\s\S]*?\/>/g) ?? []

    expect(sliderTags).toHaveLength(27)
    expect(sliderTags.every((tag) => tag.includes('ariaLabel={'))).toBe(true)

    const sections = [
      source.slice(
        source.indexOf("{#if getDatabase().aiModel === 'textgen_webui'"),
        source.indexOf('{:else if modelInfo.format === LLMFormat.NovelAI}'),
      ),
      source.slice(
        source.indexOf('{:else if modelInfo.format === LLMFormat.NovelAI}'),
        source.indexOf('{:else if modelInfo.format === LLMFormat.NovelList}'),
      ),
      source.slice(
        source.indexOf('{:else if modelInfo.format === LLMFormat.NovelList}'),
        source.indexOf('      <!-- Standard parameters come from SettingRenderer. -->'),
      ),
    ]

    expect(sections.map((section) => section.match(/<SliderInput\b[\s\S]*?\/>/g)?.length)).toEqual([7, 13, 7])
    for (const section of sections) {
      const labels = Array.from(section.matchAll(/ariaLabel=\{([^}]+)\}/g), (match) => match[1])
      expect(new Set(labels).size).toBe(labels.length)
    }
  })
})

describe('BotSettings direct form control names', () => {
  it.each(['TextInput', 'TextAreaInput', 'NumberInput', 'SelectInput', 'SecretInput'])(
    'keeps every direct %s named for its visible setting',
    (componentName) => {
      const tags = source.match(new RegExp(`<${componentName}\\b[\\s\\S]*?(?:\\/>|</${componentName}>)`, 'g')) ?? []

      expect(tags.length).toBeGreaterThan(0)
      expect(tags.filter((tag) => !tag.includes('ariaLabel='))).toEqual([])
    },
  )
})

describe('BotSettings pending prompt persistence', () => {
  it('registers its 250ms prompt draft with the lifecycle flusher and forwards keepalive transport options', () => {
    expect(source).toContain('registerPendingBridgePatchFlusher(')
    expect(source).toContain('flushPendingPromptFieldPatch(options: ServerCommandTransportOptions = {})')
    expect(source).toContain('options.keepalive,')
    expect(source).toContain('unregisterPendingPromptFieldFlush()')
  })

  it('flushes prompt rows before staging and durably dispatching the owner enable toggle', () => {
    const toggleStart = source.indexOf('async function setSelectedPromptTemplateEnabled')
    const toggleEnd = source.indexOf('function currentPromptPresetIconUploadTarget', toggleStart)
    const toggleSource = source.slice(toggleStart, toggleEnd)

    expect(toggleSource).toContain('flushPendingPromptTemplatePatches()')
    expect(toggleSource).toContain("path: '/prompt-items/enable'")
    expect(toggleSource).toContain('promptTemplateOwnerMutationKey(ownerId)')
    expect(toggleSource).toContain('dispatchDurableMutation(outbox, intent')
    expect(toggleSource.indexOf('flushPendingPromptTemplatePatches()')).toBeLessThan(
      toggleSource.indexOf('setSelectedPromptPresetTemplateProjection(enabled)'),
    )
  })
})
