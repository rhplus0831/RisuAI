import { writable } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import { BILINGUAL_TRANSLATION_CLASS, bilingualInterleave } from './bilingualInterleave'

vi.mock('../storage/database.svelte', () => ({
  appVer: '1234.5.67',
  getCurrentCharacter: () => ({}),
  getDatabase: () => ({ customQuotes: false, hideAllImages: false }),
  reapplyPendingPresetProjections: () => {},
}))

vi.mock('../globalApi.svelte', () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
}))

vi.mock('../stores.svelte', () => ({
  CurrentTriggerIdStore: writable(null),
  selIdState: { selId: 0 },
  selectedCharID: writable(0),
}))

vi.mock('../process/modules', () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModules: () => [],
}))

vi.mock('../process/scripts', () => ({
  processScriptFull: async (_char: unknown, data: string) => ({ data, emoChanged: false }),
}))

import { ParseMarkdown, trimMarkdown } from '../parser/parser.svelte'

describe('bilingual interleave rendered markup', () => {
  it('keeps the translated-line styling class through markdown and DOMPurify', async () => {
    const composite = bilingualInterleave('**Original**', '*Translated*')
    const rendered = trimMarkdown(await ParseMarkdown(composite, null, 'notrim', -1, { chatRole: 'char' }))
    const root = document.createElement('div')
    root.innerHTML = rendered

    const translated = root.querySelector(`.${BILINGUAL_TRANSLATION_CLASS}`)
    expect(translated).not.toBeNull()
    expect(translated?.querySelector('em')?.textContent).toBe('Translated')
    expect(root.querySelector('strong')?.textContent).toBe('Original')
  })
})
