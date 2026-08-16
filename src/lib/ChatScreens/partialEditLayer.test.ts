import { describe, expect, it } from 'vitest'
import { resolvePartialEditLayer, resolveRangePartialEditLayer } from './partialEditLayer'

function bilingualDom(): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = [
    '<div class="x-risu-bilingual-pair">',
    '<p id="orig-1">first original line</p>',
    '<div class="x-risu-bilingual-translation x-risu-bilingual-muted"><p id="trans-1">first translated line</p></div>',
    '</div>',
    '<div class="x-risu-bilingual-pair">',
    '<div class="x-risu-bilingual-translation"><p id="trans-2">second translated line</p></div>',
    '<div class="x-risu-bilingual-muted"><p id="orig-2">second original line</p></div>',
    '</div>',
  ].join('')
  document.body.appendChild(root)
  return root
}

function byId(root: HTMLElement, id: string): HTMLElement {
  const el = root.querySelector(`#${id}`)
  if (!el) throw new Error(`missing fixture element ${id}`)
  return el as HTMLElement
}

function rangeBetween(startNode: Node, endNode: Node): Range {
  const range = document.createRange()
  range.setStart(startNode, 0)
  range.setEnd(endNode, (endNode.textContent ?? '').length)
  return range
}

describe('resolvePartialEditLayer', () => {
  it('returns original for every block in original display mode', () => {
    const root = bilingualDom()
    expect(resolvePartialEditLayer(byId(root, 'trans-1'), 'original')).toBe('original')
    root.remove()
  })

  it('returns translation for every block in translated-only display mode', () => {
    const root = bilingualDom()
    expect(resolvePartialEditLayer(byId(root, 'orig-1'), 'translation')).toBe('translation')
    root.remove()
  })

  it('detects the translation side in bilingual mode for both emphasis layouts', () => {
    const root = bilingualDom()
    expect(resolvePartialEditLayer(byId(root, 'trans-1'), 'bilingual')).toBe('translation')
    expect(resolvePartialEditLayer(byId(root, 'trans-2'), 'bilingual')).toBe('translation')
    expect(resolvePartialEditLayer(byId(root, 'trans-1').parentElement, 'bilingual')).toBe('translation')
    root.remove()
  })

  it('detects the original side in bilingual mode, bare and muted-wrapped', () => {
    const root = bilingualDom()
    expect(resolvePartialEditLayer(byId(root, 'orig-1'), 'bilingual')).toBe('original')
    expect(resolvePartialEditLayer(byId(root, 'orig-2'), 'bilingual')).toBe('original')
    expect(resolvePartialEditLayer(byId(root, 'orig-2').parentElement, 'bilingual')).toBe('original')
    root.remove()
  })

  it('rejects blocks spanning both layers', () => {
    const root = bilingualDom()
    const pair = root.querySelector('.x-risu-bilingual-pair') as HTMLElement
    expect(resolvePartialEditLayer(pair, 'bilingual')).toBeNull()
    expect(resolvePartialEditLayer(root, 'bilingual')).toBeNull()
    expect(resolvePartialEditLayer(null, 'bilingual')).toBeNull()
    root.remove()
  })
})

describe('resolveRangePartialEditLayer', () => {
  it('resolves selections inside a single side', () => {
    const root = bilingualDom()
    const orig = byId(root, 'orig-1').firstChild!
    const trans = byId(root, 'trans-1').firstChild!
    expect(resolveRangePartialEditLayer(rangeBetween(orig, orig), 'bilingual')).toBe('original')
    expect(resolveRangePartialEditLayer(rangeBetween(trans, trans), 'bilingual')).toBe('translation')
    root.remove()
  })

  it('follows the display mode outside bilingual view', () => {
    const root = bilingualDom()
    const trans = byId(root, 'trans-1').firstChild!
    expect(resolveRangePartialEditLayer(rangeBetween(trans, trans), 'original')).toBe('original')
    expect(resolveRangePartialEditLayer(rangeBetween(trans, trans), 'translation')).toBe('translation')
    expect(resolveRangePartialEditLayer(null, 'bilingual')).toBeNull()
    root.remove()
  })

  it('rejects selections crossing sides within a pair', () => {
    const root = bilingualDom()
    const range = rangeBetween(byId(root, 'orig-1').firstChild!, byId(root, 'trans-1').firstChild!)
    expect(resolveRangePartialEditLayer(range, 'bilingual')).toBeNull()
    root.remove()
  })

  it('rejects same-side selections that span multiple pairs', () => {
    const root = bilingualDom()
    const acrossOriginals = rangeBetween(byId(root, 'orig-1').firstChild!, byId(root, 'orig-2').firstChild!)
    expect(resolveRangePartialEditLayer(acrossOriginals, 'bilingual')).toBeNull()
    const acrossTranslations = rangeBetween(byId(root, 'trans-1').firstChild!, byId(root, 'trans-2').firstChild!)
    expect(resolveRangePartialEditLayer(acrossTranslations, 'bilingual')).toBeNull()
    root.remove()
  })
})
