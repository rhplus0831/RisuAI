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
