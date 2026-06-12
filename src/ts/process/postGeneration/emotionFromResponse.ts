import type { character } from '../../storage/database.svelte'
import { loadAndTrimCharEmotion, pushCharEmotionEntry } from './charEmotionStore'

export interface ApplyEmotionFromResponseOptions {
  emotion: string | undefined
  currentChar: character
}

export function applyEmotionFromResponse(opts: ApplyEmotionFromResponseOptions): boolean {
  if (!opts.emotion) return false

  const { tempEmotion, charemotions } = loadAndTrimCharEmotion(opts.currentChar.chaId)

  for (const emo of opts.currentChar.emotionImages) {
    if (emo[0] === opts.emotion) {
      pushCharEmotionEntry({
        emoTuple: emo,
        tempEmotion,
        charemotions,
        chaId: opts.currentChar.chaId,
      })
      return true
    }
  }
  return false
}
