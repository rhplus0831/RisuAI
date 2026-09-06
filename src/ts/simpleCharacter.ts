import type { simpleCharacterArgument } from './parser/parser.svelte'
import type { character, customscript } from './storage/database.svelte'

export function createSimpleCharacter(char: character, customscript: customscript[] | undefined = char.customscript) {
  if (!char) return null

  const simpleChar: simpleCharacterArgument = {
    type: 'simple',
    customscript,
    chaId: char.chaId,
    additionalAssets: char.additionalAssets,
    virtualscript: char.virtualscript,
    emotionImages: char.emotionImages,
    triggerscript: char.triggerscript,
  }

  return simpleChar
}

/** Preserve parser inputs when a parent projection changes only unrelated fields. */
export function createSimpleCharacterMemo() {
  let previous: simpleCharacterArgument | null = null
  let previousReload: unknown
  return (char: character, scripts: customscript[] | undefined, reload: unknown) => {
    const next = createSimpleCharacter(char, scripts)
    if (next && previous && reload === previousReload && Object.keys(next).every((key) => next[key] === previous[key]))
      return previous
    previousReload = reload
    previous = next
    return next
  }
}
