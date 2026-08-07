import type { OpenAIChat } from './index.svelte'
import { normalizePromptRole } from './promptTemplateNormalization'

export function applyPromptBlockRole(rows: OpenAIChat[], role: unknown): OpenAIChat[] {
  if (role === undefined || role === null) return rows
  const normalized = normalizePromptRole(role) ?? 'system'
  const wireRole: OpenAIChat['role'] = normalized === 'bot' ? 'assistant' : normalized
  for (const row of rows) row.role = wireRole
  return rows
}

export function applyDescriptionPromptRole(
  rows: OpenAIChat[],
  role: unknown,
  baseDescriptionIndex: number | undefined,
): OpenAIChat[] {
  if (role === undefined || role === null) return rows
  const index = baseDescriptionIndex ?? 0
  if (index >= 0 && index < rows.length) applyPromptBlockRole([rows[index]], role)
  return rows
}
