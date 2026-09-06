import { normalizePromptRole } from './promptTemplateNormalization.js'

export interface PromptRoleRowLike {
  role: unknown
}

/** Mutate every supplied prompt row to the requested wire role. */
export function applyPromptBlockRole<Row extends PromptRoleRowLike>(rows: Row[], role: unknown): Row[] {
  if (role === undefined || role === null) return rows
  const normalized = normalizePromptRole(role) ?? 'system'
  const wireRole = normalized === 'bot' ? 'assistant' : normalized
  for (const row of rows) row.role = wireRole
  return rows
}

/** Mutate only the base character-description row, defaulting its index to zero. */
export function applyDescriptionPromptRole<Row extends PromptRoleRowLike>(
  rows: Row[],
  role: unknown,
  baseDescriptionIndex: number | undefined,
): Row[] {
  if (role === undefined || role === null) return rows
  const index = baseDescriptionIndex ?? 0
  if (index >= 0 && index < rows.length) applyPromptBlockRole([rows[index]], role)
  return rows
}
