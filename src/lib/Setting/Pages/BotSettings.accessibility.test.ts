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
