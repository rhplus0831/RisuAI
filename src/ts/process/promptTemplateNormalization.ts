import { safeStructuredClone } from '../safeStructuredClone'
import type { PromptItem, PromptRole } from './prompt'

export function isPromptRoleValue(role: unknown): role is PromptRole | 'assistant' {
  return role === 'user' || role === 'bot' || role === 'system' || role === 'assistant'
}

export function normalizePromptBlockRoleForType(item: PromptItem): void {
  if (
    (item.type === 'persona' || item.type === 'description' || item.type === 'authornote' || item.type === 'memory') &&
    !isPromptRoleValue(item.role2)
  ) {
    item.role2 = 'system'
  }
}

export function normalizePromptRole(role: unknown): PromptRole | null {
  if (role === 'user' || role === 'bot' || role === 'system') return role
  if (role === 'assistant' || role === 'char') return 'bot'
  return null
}

export function normalizeCacheRole(role: unknown): 'user' | 'assistant' | 'system' | 'all' {
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'all') return role
  if (role === 'bot' || role === 'char') return 'assistant'
  return 'all'
}

export function normalizePromptTemplate(template: unknown): PromptItem[] | null {
  if (!Array.isArray(template)) return null

  const normalized = safeStructuredClone(template) as Array<Record<string, unknown>>
  for (const item of normalized) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue

    switch (item.type) {
      case 'plain':
      case 'jailbreak':
      case 'cot':
        item.role = normalizePromptRole(item.role) ?? 'system'
        break
      case 'persona':
      case 'description':
      case 'authornote':
      case 'memory':
        if (item.role2 !== undefined && item.role2 !== null) {
          item.role2 = normalizePromptRole(item.role2) ?? 'system'
        }
        break
      case 'cache':
        item.role = normalizeCacheRole(item.role)
        break
    }
  }

  return normalized as unknown as PromptItem[]
}
