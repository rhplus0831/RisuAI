export type PromptRole = 'user' | 'bot' | 'system'
export type PromptBlockRole = PromptRole | 'assistant'
export type PromptCacheRole = 'user' | 'assistant' | 'system' | 'all'

export interface PromptItemRoleLike {
  type?: unknown
  role?: unknown
  role2?: unknown
}

export function isPromptRoleValue(role: unknown): role is PromptBlockRole {
  return role === 'user' || role === 'bot' || role === 'system' || role === 'assistant'
}

/** Mutate a role-bearing prompt block after its card type changes. */
export function normalizePromptBlockRoleForType<T extends PromptItemRoleLike>(item: T): void {
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

export function normalizeCacheRole(role: unknown): PromptCacheRole {
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'all') return role
  if (role === 'bot' || role === 'char') return 'assistant'
  return 'all'
}

export function normalizePromptTemplate<T>(template: readonly T[]): T[]
export function normalizePromptTemplate(template: unknown): unknown[] | null
export function normalizePromptTemplate(template: unknown): unknown[] | null {
  if (!Array.isArray(template)) return null

  const normalized = safeClone(template) as unknown[]
  for (const rawItem of normalized) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue
    const item = rawItem as PromptItemRoleLike

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

  return normalized
}

/**
 * Match the browser owner's clone contract without importing its rfdc-backed
 * adapter. Native structured cloning handles normal persisted prompt data; the
 * fallback retains unsupported leaf values such as functions while cloning the
 * surrounding arrays and records.
 */
function safeClone<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return fallbackClone(value) as T
  }
}

function fallbackClone(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const keys = Object.keys(value)
    const cloned: unknown[] = new Array(keys.length)
    for (const key of keys) cloned[key as unknown as number] = fallbackClone(value[key as unknown as number])
    return cloned
  }
  if (value instanceof Date) return new Date(value)
  if (value instanceof Map) {
    return new Map(Array.from(value, ([key, entry]) => [fallbackClone(key), fallbackClone(entry)]))
  }
  if (value instanceof Set) return new Set(Array.from(value, (entry) => fallbackClone(entry)))
  if (ArrayBuffer.isView(value)) return cloneArrayBufferView(value)

  const cloned: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    cloned[key] = fallbackClone((value as Record<string, unknown>)[key])
  }
  return cloned
}

function cloneArrayBufferView(value: ArrayBufferView): ArrayBufferView {
  const buffer = value.buffer.slice(0)
  if (value instanceof DataView) return new DataView(buffer, value.byteOffset, value.byteLength)

  const constructor = value.constructor as {
    readonly BYTES_PER_ELEMENT?: number
    new (buffer: ArrayBufferLike, byteOffset?: number, length?: number): ArrayBufferView
  }
  const bytesPerElement = constructor.BYTES_PER_ELEMENT ?? 1
  return new constructor(buffer, value.byteOffset, value.byteLength / bytesPerElement)
}
