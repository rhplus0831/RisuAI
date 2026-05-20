import { get } from 'svelte/store'
import { CharEmotion } from '../../stores.svelte'

export type CharEmotionEntry = [string, string, number]
export type CharEmotionMap = { [chaId: string]: CharEmotionEntry[] }

export function loadAndTrimCharEmotion(chaId: string): {
  tempEmotion: CharEmotionEntry[]
  charemotions: CharEmotionMap
} {
  const charemotions = get(CharEmotion) as CharEmotionMap
  let tempEmotion = charemotions[chaId]
  if (!tempEmotion) {
    tempEmotion = []
  }
  if (tempEmotion.length > 4) {
    tempEmotion.splice(0, 1)
  }
  return { tempEmotion, charemotions }
}

export function pushCharEmotionEntry(opts: {
  emoTuple: readonly [string, string]
  tempEmotion: CharEmotionEntry[]
  charemotions: CharEmotionMap
  chaId: string
}): void {
  opts.tempEmotion.push([opts.emoTuple[0], opts.emoTuple[1], Date.now()])
  opts.charemotions[opts.chaId] = opts.tempEmotion
  CharEmotion.set(opts.charemotions)
}
