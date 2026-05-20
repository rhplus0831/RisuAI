import { recordSideEffect } from '../sideEffects'

export function runInlayScreen(char: unknown, text: unknown): { text: string; promise: null } {
  recordSideEffect('runInlayScreen', [summarizeChar(char), text])
  return { text: typeof text === 'string' ? text : '', promise: null }
}

function summarizeChar(char: unknown): { chaId?: string; name?: string } {
  if (!char || typeof char !== 'object') return {}
  const c = char as { chaId?: string; name?: string }
  return { chaId: c.chaId, name: c.name }
}
