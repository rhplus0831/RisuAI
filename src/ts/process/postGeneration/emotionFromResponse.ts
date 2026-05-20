import { get } from 'svelte/store'
import { CharEmotion } from '../../stores.svelte'
import type { character } from '../../storage/database.svelte'

export interface ApplyEmotionFromResponseOptions {
  emotion: string | undefined
  currentChar: character
}

export function applyEmotionFromResponse(
  opts: ApplyEmotionFromResponseOptions,
): boolean {
  if (!opts.emotion) return false

  const charemotions = get(CharEmotion)
  const currentEmotion = opts.currentChar.emotionImages

  let tempEmotion = charemotions[opts.currentChar.chaId]
  if (!tempEmotion) {
    tempEmotion = []
  }
  if (tempEmotion.length > 4) {
    tempEmotion.splice(0, 1)
  }

  for (const emo of currentEmotion) {
    if (emo[0] === opts.emotion) {
      const emos: [string, string, number] = [emo[0], emo[1], Date.now()]
      tempEmotion.push(emos)
      charemotions[opts.currentChar.chaId] = tempEmotion
      CharEmotion.set(charemotions)
      return true
    }
  }
  return false
}
