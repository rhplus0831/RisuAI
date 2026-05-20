import { recordSideEffect } from '../sideEffects'

export async function sayTTS(char: unknown, text: unknown): Promise<void> {
  recordSideEffect('sayTTS', [summarizeChar(char), text])
}

function summarizeChar(char: unknown): { chaId?: string; name?: string } {
  if (!char || typeof char !== 'object') return {}
  const c = char as { chaId?: string; name?: string }
  return { chaId: c.chaId, name: c.name }
}
