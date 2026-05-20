import { tokenize } from '../tokenizer'
import { isLastCharPunctuation } from '../util'

export interface AutoContinueDecision {
  shouldContinue: boolean
  resultTokens: number
}

export async function evaluateAutoContinue({
  result,
  usedContinueTokens,
  db,
}: {
  result: string
  usedContinueTokens: number
  db: { autoContinueMinTokens: number; autoContinueChat: boolean }
}): Promise<AutoContinueDecision> {
  const resultTokens = (await tokenize(result)) + usedContinueTokens
  let shouldContinue = false
  if (db.autoContinueMinTokens > 0 && resultTokens < db.autoContinueMinTokens) {
    shouldContinue = true
  }
  if (db.autoContinueChat && !isLastCharPunctuation(result)) {
    shouldContinue = true
  }
  return { shouldContinue, resultTokens }
}
