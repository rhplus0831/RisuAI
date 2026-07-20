import { writable } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import {
  BILINGUAL_MUTED_CLASS,
  BILINGUAL_PAIR_CLASS,
  BILINGUAL_TRANSLATION_CLASS,
  bilingualInterleave,
  pruneEmptyBilingualPairs,
} from './bilingualInterleave'

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
  async function renderComposite(emphasize: 'original' | 'translation'): Promise<HTMLDivElement> {
    const composite = bilingualInterleave('**Original**', '*Translated*', { emphasize })
    const rendered = trimMarkdown(await ParseMarkdown(composite, null, 'notrim', -1, { chatRole: 'char' }))
    const root = document.createElement('div')
    root.innerHTML = rendered
    return root
  }

  it('keeps pair and muted classes with original-first DOM order through markdown and DOMPurify', async () => {
    const root = await renderComposite('original')
    const pair = root.querySelector(`.${BILINGUAL_PAIR_CLASS}`)
    const translated = pair?.querySelector(`.${BILINGUAL_TRANSLATION_CLASS}`)

    expect(pair).not.toBeNull()
    expect(translated).not.toBeNull()
    expect(translated?.classList.contains(BILINGUAL_MUTED_CLASS)).toBe(true)
    expect(pair?.children).toHaveLength(2)
    expect(pair?.children[0]?.querySelector('strong')?.textContent).toBe('Original')
    expect(pair?.children[1]).toBe(translated)
    expect(translated?.querySelector('em')?.textContent).toBe('Translated')
  })

  it('keeps translation-first DOM order and mutes only the original through markdown and DOMPurify', async () => {
    const root = await renderComposite('translation')
    const pair = root.querySelector(`.${BILINGUAL_PAIR_CLASS}`)
    const translated = pair?.querySelector(`.${BILINGUAL_TRANSLATION_CLASS}`)
    const muted = pair?.querySelector(`.${BILINGUAL_MUTED_CLASS}`)

    expect(pair).not.toBeNull()
    expect(pair?.children).toHaveLength(2)
    expect(pair?.children[0]).toBe(translated)
    expect(translated?.classList.contains(BILINGUAL_MUTED_CLASS)).toBe(false)
    expect(translated?.querySelector('em')?.textContent).toBe('Translated')
    expect(pair?.children[1]).toBe(muted)
    expect(muted?.querySelector('strong')?.textContent).toBe('Original')
  })

  it('defaults to original emphasis in the real render pipeline', async () => {
    const composite = bilingualInterleave('**Original**', '*Translated*')
    const rendered = trimMarkdown(await ParseMarkdown(composite, null, 'notrim', -1, { chatRole: 'char' }))
    const root = document.createElement('div')
    root.innerHTML = rendered

    const pair = root.querySelector(`.${BILINGUAL_PAIR_CLASS}`)
    const translated = root.querySelector(`.${BILINGUAL_TRANSLATION_CLASS}`)
    expect(translated).not.toBeNull()
    expect(translated?.classList.contains(BILINGUAL_MUTED_CLASS)).toBe(true)
    expect(pair?.children[0]?.querySelector('strong')?.textContent).toBe('Original')
    expect(translated?.querySelector('em')?.textContent).toBe('Translated')
  })
})

describe('pruneEmptyBilingualPairs', () => {
  function parsePruned(html: string): HTMLDivElement {
    const root = document.createElement('div')
    root.innerHTML = pruneEmptyBilingualPairs(html)
    return root
  }

  it('removes a pair when both wrapped sides are empty', () => {
    const root = parsePruned(`
      <div class="${BILINGUAL_PAIR_CLASS}">
        <div class="${BILINGUAL_TRANSLATION_CLASS}"><p> &nbsp; </p></div>
        <div class="${BILINGUAL_MUTED_CLASS}"><!-- consumed status data --></div>
      </div>
      <p>Following content</p>
    `)

    expect(root.querySelector(`.${BILINGUAL_PAIR_CLASS}`)).toBeNull()
    expect(root.textContent?.trim()).toBe('Following content')
  })

  it('removes only the empty side when the other side has text', () => {
    const root = parsePruned(`
      <div class="${BILINGUAL_PAIR_CLASS}">
        <div class="${BILINGUAL_TRANSLATION_CLASS}">Translated status</div>
        <div class="${BILINGUAL_MUTED_CLASS}"> &nbsp; </div>
      </div>
    `)
    const pair = root.querySelector(`.${BILINGUAL_PAIR_CLASS}`)

    expect(pair).not.toBeNull()
    expect(pair?.querySelector(`.${BILINGUAL_TRANSLATION_CLASS}`)?.textContent).toBe('Translated status')
    expect(pair?.querySelector(`.${BILINGUAL_MUTED_CLASS}`)).toBeNull()
  })

  it('keeps image-only sides that use background images', () => {
    const root = parsePruned(`
      <div class="${BILINGUAL_PAIR_CLASS}">
        <div class="${BILINGUAL_TRANSLATION_CLASS}">
          <div class="x-risu-image-container" style="background-image: url(translation.png)"></div>
        </div>
        <div class="${BILINGUAL_MUTED_CLASS}">
          <div class="x-risu-image-container" style="background-image: url(original.png)"></div>
        </div>
      </div>
    `)
    const pair = root.querySelector(`.${BILINGUAL_PAIR_CLASS}`)

    expect(pair).not.toBeNull()
    expect(pair?.querySelector(`.${BILINGUAL_TRANSLATION_CLASS}`)).not.toBeNull()
    expect(pair?.querySelector(`.${BILINGUAL_MUTED_CLASS}`)).not.toBeNull()
    expect(pair?.querySelectorAll('.x-risu-image-container')).toHaveLength(2)
  })

  it('keeps an original-emphasis pair when its bare original is empty but its translation is not', () => {
    const root = parsePruned(`
      <div class="${BILINGUAL_PAIR_CLASS}">
        <p class="consumed-original"> &nbsp; </p>
        <div class="${BILINGUAL_TRANSLATION_CLASS} ${BILINGUAL_MUTED_CLASS}">Translated status</div>
      </div>
    `)
    const pair = root.querySelector(`.${BILINGUAL_PAIR_CLASS}`)

    expect(pair).not.toBeNull()
    expect(pair?.querySelector('.consumed-original')).not.toBeNull()
    expect(pair?.querySelector(`.${BILINGUAL_TRANSLATION_CLASS}`)?.textContent).toBe('Translated status')
  })

  it('returns input without bilingual pair markers unchanged without parsing', () => {
    const html = '<p>Ordinary <strong>chat</strong> content</p>'
    const domParser = vi.fn(() => {
      throw new Error('DOMParser should not run for ordinary chat HTML')
    })
    vi.stubGlobal('DOMParser', domParser)

    try {
      expect(pruneEmptyBilingualPairs(html)).toBe(html)
      expect(domParser).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
