export interface ChatMessageRangeMergeInput {
  start: number
  total: number
  preserveExistingOnGrowth?: boolean
}

export interface ChatMessageRangeMergeResult<T> {
  messages: T[]
  changed: boolean
  replacedArray: boolean
  assignedRows: number
  allocatedPlaceholders: number
}

export function sameStructuredValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => sameStructuredValue(value, right[index]))
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key) => !Object.prototype.hasOwnProperty.call(rightRecord, key))
  ) {
    return false
  }
  return leftKeys.every((key) => sameStructuredValue(leftRecord[key], rightRecord[key]))
}

/**
 * Merge one authoritative transcript range without copying the resident prefix.
 * Returns null for malformed ranges so the caller can reject the projection and
 * use its normal authoritative refresh fallback.
 */
export function mergeChatMessageRange<T>(
  existing: T[],
  incoming: readonly T[],
  range: ChatMessageRangeMergeInput,
  createPlaceholder: () => T,
): ChatMessageRangeMergeResult<T> | null {
  if (
    !Number.isInteger(range.start) ||
    range.start < 0 ||
    !Number.isInteger(range.total) ||
    range.total < 0 ||
    range.start > range.total ||
    incoming.length > range.total - range.start
  ) {
    return null
  }

  const canPreserveExisting =
    existing.length === range.total || (range.preserveExistingOnGrowth === true && range.start <= existing.length)
  if (!canPreserveExisting) {
    const messages = Array.from({ length: range.total }, createPlaceholder)
    for (let index = 0; index < incoming.length; index += 1) {
      messages[range.start + index] = incoming[index]
    }
    return {
      messages,
      changed: true,
      replacedArray: true,
      assignedRows: incoming.length,
      allocatedPlaceholders: range.total - incoming.length,
    }
  }

  let changed = false
  let assignedRows = 0
  let allocatedPlaceholders = 0
  if (existing.length > range.total) {
    existing.length = range.total
    changed = true
  } else {
    for (let index = existing.length; index < range.total; index += 1) {
      const incomingIndex = index - range.start
      if (incomingIndex >= 0 && incomingIndex < incoming.length) {
        existing.push(incoming[incomingIndex])
        assignedRows += 1
      } else {
        existing.push(createPlaceholder())
        allocatedPlaceholders += 1
      }
      changed = true
    }
  }

  const residentEnd = Math.min(existing.length, range.start + incoming.length)
  for (let index = range.start; index < residentEnd; index += 1) {
    const incomingMessage = incoming[index - range.start]
    if (sameStructuredValue(existing[index], incomingMessage)) continue
    existing[index] = incomingMessage
    assignedRows += 1
    changed = true
  }

  return {
    messages: existing,
    changed,
    replacedArray: false,
    assignedRows,
    allocatedPlaceholders,
  }
}
