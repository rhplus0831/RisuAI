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

/**
 * Append-only reasoning removal. Retains only a possible tag and trailing
 * whitespace, never the reasoning body. Unlike whole-string stripping, leading
 * whitespace already emitted before a later opening tag cannot be retracted.
 */
export function createInternalReasoningStream(): { push(text: string): string; finish(): string } {
  let depth = 0
  let foundOpeningTag = false
  let emittedVisible = false
  let whitespace = ''
  let tag = ''
  let name = ''
  let closing = false
  let phase: 'text' | 'beforeSlash' | 'beforeName' | 'name' | 'attributes' = 'text'
  let output = ''

  const visible = (text: string): void => {
    if (depth > 0) return
    for (const char of text) {
      if (/\s/u.test(char)) {
        whitespace += char
      } else {
        output += (!emittedVisible && foundOpeningTag ? '' : whitespace) + char
        whitespace = ''
        emittedVisible = true
      }
    }
  }

  const startTag = (): void => {
    tag = '<'
    name = ''
    closing = false
    phase = 'beforeSlash'
  }

  const completeTag = (): void => {
    if (!closing) {
      foundOpeningTag = true
      depth += 1
    } else if (depth > 0) {
      depth -= 1
    } else {
      visible(tag)
    }
    tag = ''
    phase = 'text'
  }

  return {
    push(text) {
      output = ''
      for (const char of text) {
        if (phase === 'text') {
          if (char === '<') startTag()
          else visible(char)
          continue
        }

        tag += char
        if (phase === 'attributes') {
          if (char === '>') completeTag()
          continue
        }
        if (phase === 'beforeSlash' || phase === 'beforeName') {
          if (/\s/u.test(char)) continue
          if (phase === 'beforeSlash' && char === '/') {
            closing = true
            phase = 'beforeName'
            continue
          }
          phase = 'name'
        }

        if ((name === 'think' || name === 'thoughts') && !/\w/iu.test(char)) {
          phase = 'attributes'
          if (char === '>') completeTag()
          continue
        }
        // Match the case folding of the whole-string /iu tag expression.
        name += char.toLowerCase().replace(/ſ/gu, 's')
        if ('think'.startsWith(name) || 'thoughts'.startsWith(name)) continue

        // An invalid candidate can itself end with the next tag's '<'.
        if (char === '<') {
          visible(tag.slice(0, -1))
          startTag()
        } else {
          visible(tag)
          tag = ''
          phase = 'text'
        }
      }
      return output
    },
    finish() {
      output = ''
      // Incomplete tags outside a recognized block are ordinary literal text,
      // matching stripInternalReasoning. Unterminated reasoning stays hidden.
      visible(tag)
      tag = ''
      phase = 'text'
      if (!foundOpeningTag) output += whitespace
      whitespace = ''
      return output
    },
  }
}
