export const BILINGUAL_TRANSLATION_CLASS = 'x-risu-bilingual-translation'
export const BILINGUAL_PAIR_CLASS = 'x-risu-bilingual-pair'
export const BILINGUAL_MUTED_CLASS = 'x-risu-bilingual-muted'

const BILINGUAL_SIDE_SELECTOR = `.${BILINGUAL_TRANSLATION_CLASS}, .${BILINGUAL_MUTED_CLASS}`
const VISUAL_CONTENT_SELECTOR =
  'img, svg, video, audio, iframe, canvas, embed, object, picture, hr, [style*="background"]'

export interface BilingualInterleaveOptions {
  emphasize?: 'original' | 'translation'
}

interface BilingualUnit {
  content: string
  blank: boolean
}

function splitBilingualUnits(text: string): BilingualUnit[] {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  const units: BilingualUnit[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!/^\s*```/.test(line)) {
      units.push({ content: line, blank: line.trim().length === 0 })
      continue
    }

    const fenceLines = [line]
    while (index + 1 < lines.length) {
      index += 1
      fenceLines.push(lines[index])
      if (/^\s*```\s*$/.test(lines[index])) break
    }
    units.push({ content: fenceLines.join('\n'), blank: false })
  }

  return units
}

function wrappedUnit(content: string, classes: readonly string[]): string {
  return `<div class="${classes.join(' ')}">\n\n${content}\n\n</div>`
}

function pairedUnit(
  original: string | undefined,
  translation: string | undefined,
  emphasize: 'original' | 'translation',
): string {
  const sides: string[] = []
  if (emphasize === 'translation') {
    if (translation !== undefined) {
      sides.push(wrappedUnit(translation, [BILINGUAL_TRANSLATION_CLASS]))
    }
    if (original !== undefined) {
      sides.push(wrappedUnit(original, [BILINGUAL_MUTED_CLASS]))
    }
  } else {
    if (original !== undefined) sides.push(original)
    if (translation !== undefined) {
      sides.push(wrappedUnit(translation, [BILINGUAL_TRANSLATION_CLASS, BILINGUAL_MUTED_CLASS]))
    }
  }
  return wrappedUnit(sides.join('\n\n'), [BILINGUAL_PAIR_CLASS])
}

function hasBilingualRenderedContent(element: Element): boolean {
  return (
    (element.textContent ?? '').trim().length > 0 ||
    element.matches(VISUAL_CONTENT_SELECTOR) ||
    element.querySelector(VISUAL_CONTENT_SELECTOR) !== null
  )
}

function collapseVisualOnlyPair(pair: Element): void {
  if ((pair.textContent ?? '').trim().length > 0) return

  const sides = [...pair.querySelectorAll(BILINGUAL_SIDE_SELECTOR)]
  if (sides.length === 0) return

  const hasBareOriginal = [...pair.children].some(
    (child) => !child.matches(BILINGUAL_SIDE_SELECTOR) && hasBilingualRenderedContent(child),
  )
  const kept = hasBareOriginal
    ? null
    : (sides.find(
        (side) =>
          side.classList.contains(BILINGUAL_MUTED_CLASS) &&
          !side.classList.contains(BILINGUAL_TRANSLATION_CLASS),
      ) ?? sides[0])

  for (const side of sides) {
    if (side !== kept) side.remove()
  }
  kept?.classList.remove(BILINGUAL_MUTED_CLASS)
}

export function pruneEmptyBilingualPairs(html: string): string {
  if (!html.includes(BILINGUAL_PAIR_CLASS)) return html

  const document = new DOMParser().parseFromString(html, 'text/html')
  const pairs = document.body.querySelectorAll(`.${BILINGUAL_PAIR_CLASS}`)

  for (const pair of pairs) {
    for (const side of pair.querySelectorAll(BILINGUAL_SIDE_SELECTOR)) {
      if (!hasBilingualRenderedContent(side)) side.remove()
    }

    if (!hasBilingualRenderedContent(pair)) {
      pair.remove()
      continue
    }

    collapseVisualOnlyPair(pair)
  }

  return document.body.innerHTML
}

export function bilingualInterleave(
  originalText: string,
  translatedText: string,
  options: BilingualInterleaveOptions = {},
): string {
  const emphasize = options.emphasize ?? 'original'
  const originalUnits = splitBilingualUnits(originalText)
  const translatedUnits = splitBilingualUnits(translatedText).filter((unit) => !unit.blank)
  const composite: string[] = []
  let translatedIndex = 0

  for (const original of originalUnits) {
    if (original.blank) {
      composite.push(original.content)
      continue
    }
    const translation = translatedUnits[translatedIndex]?.content
    composite.push(pairedUnit(original.content, translation, emphasize))
    if (translation !== undefined) {
      translatedIndex += 1
    }
  }

  while (translatedIndex < translatedUnits.length) {
    composite.push(pairedUnit(undefined, translatedUnits[translatedIndex].content, emphasize))
    translatedIndex += 1
  }

  return composite.join('\n')
}
