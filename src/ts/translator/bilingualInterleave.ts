export const BILINGUAL_TRANSLATION_CLASS = 'x-risu-bilingual-translation'

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

function translatedUnit(content: string): string {
  return `<div class="${BILINGUAL_TRANSLATION_CLASS}">\n\n${content}\n\n</div>`
}

export function bilingualInterleave(originalText: string, translatedText: string): string {
  const originalUnits = splitBilingualUnits(originalText)
  const translatedUnits = splitBilingualUnits(translatedText).filter((unit) => !unit.blank)
  const composite: string[] = []
  let translatedIndex = 0

  for (const original of originalUnits) {
    composite.push(original.content)
    if (!original.blank && translatedIndex < translatedUnits.length) {
      composite.push(translatedUnit(translatedUnits[translatedIndex].content))
      translatedIndex += 1
    }
  }

  while (translatedIndex < translatedUnits.length) {
    composite.push(translatedUnit(translatedUnits[translatedIndex].content))
    translatedIndex += 1
  }

  return composite.join('\n')
}
