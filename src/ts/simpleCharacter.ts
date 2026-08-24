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
