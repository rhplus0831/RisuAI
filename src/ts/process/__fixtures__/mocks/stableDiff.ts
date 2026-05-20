import { recordSideEffect } from '../sideEffects'

export async function stableDiff(char: unknown, prompt: unknown): Promise<void> {
  recordSideEffect('stableDiff', [summarizeChar(char), prompt])
}

function summarizeChar(char: unknown): { chaId?: string; name?: string } {
  if (!char || typeof char !== 'object') return {}
  const c = char as { chaId?: string; name?: string }
  return { chaId: c.chaId, name: c.name }
}
