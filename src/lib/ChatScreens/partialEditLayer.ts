import { BILINGUAL_PAIR_CLASS, BILINGUAL_TRANSLATION_CLASS } from 'src/ts/translator/bilingualInterleave'

export type PartialEditLayer = 'original' | 'translation'

export type PartialEditDisplayMode = 'original' | 'translation' | 'bilingual'

const TRANSLATION_SIDE_SELECTOR = `.${BILINGUAL_TRANSLATION_CLASS}`
const PAIR_SELECTOR = `.${BILINGUAL_PAIR_CLASS}`

function closestElement(node: Node | null): Element | null {
  if (!node) return null
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
}

function bilingualSideLayer(element: Element): PartialEditLayer {
  return element.closest(TRANSLATION_SIDE_SELECTOR) ? 'translation' : 'original'
}

/**
 * Resolve which text layer a candidate block edits. Returns null when the
 * block spans both bilingual layers (pair wrappers or ancestors of them), so
 * callers must not offer edit affordances for it.
 */
export function resolvePartialEditLayer(
  element: Element | null,
  displayMode: PartialEditDisplayMode,
): PartialEditLayer | null {
  if (!element) return null
  if (displayMode === 'original') return 'original'
  if (displayMode === 'translation') return 'translation'

  if (element.closest(TRANSLATION_SIDE_SELECTOR)) return 'translation'
  if (element.matches(PAIR_SELECTOR) || element.querySelector(`${PAIR_SELECTOR}, ${TRANSLATION_SIDE_SELECTOR}`)) {
    return null
  }
  return 'original'
}

/**
 * Resolve the layer of a drag selection. Returns null when the selection
 * crosses bilingual layers or spans multiple pairs, where the selected text
 * mixes content from both source texts and cannot match either.
 */
export function resolveRangePartialEditLayer(
  range: Range | null,
  displayMode: PartialEditDisplayMode,
): PartialEditLayer | null {
  if (!range) return null
  if (displayMode === 'original') return 'original'
  if (displayMode === 'translation') return 'translation'

  const start = closestElement(range.startContainer)
  const end = closestElement(range.endContainer)
  if (!start || !end) return null

  const startLayer = bilingualSideLayer(start)
  if (startLayer !== bilingualSideLayer(end)) return null

  const fragment = range.cloneContents()
  if (startLayer === 'original' && fragment.querySelector(TRANSLATION_SIDE_SELECTOR)) return null
  if (startLayer === 'translation' && fragment.querySelector(PAIR_SELECTOR)) return null
  return startLayer
}
