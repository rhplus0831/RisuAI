const INTERNAL_REASONING_TAG_RE = /<\s*(\/?)\s*(?:Thoughts|think)\b[^>]*>/giu

export function stripInternalReasoning(text: string, options: { preserveUnchanged?: boolean } = {}): string {
  let visible = ''
  let visibleFrom = 0
  let hiddenDepth = 0
  let foundOpeningTag = false

  for (const match of text.matchAll(INTERNAL_REASONING_TAG_RE)) {
    const index = match.index
    const closing = match[1] === '/'

    if (!closing) {
      foundOpeningTag = true
      if (hiddenDepth === 0) visible += text.slice(visibleFrom, index)
      hiddenDepth += 1
      continue
    }

    if (hiddenDepth === 0) continue
    hiddenDepth -= 1
    if (hiddenDepth === 0) visibleFrom = index + match[0].length
  }

  if (!foundOpeningTag && options.preserveUnchanged) return text
  if (hiddenDepth === 0) visible += text.slice(visibleFrom)
  return visible.trim()
}
