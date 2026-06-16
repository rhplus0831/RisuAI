export type OperationTargetKey = string | number

export interface LatestOperationToken<TTarget extends OperationTargetKey = OperationTargetKey> {
  readonly target: TTarget
  readonly sequence: number
}

export interface LatestOperationGuard<TTarget extends OperationTargetKey = OperationTargetKey> {
  issue(target: TTarget): LatestOperationToken<TTarget>
  isLatest(token: LatestOperationToken<TTarget>): boolean
  clear(token: LatestOperationToken<TTarget>): void
}

export interface DestructiveRefreshToken {
  readonly kind: 'destructive-refresh'
  readonly id: number
  readonly reason: string
}

let nextOperationSequence = 0
let nextDestructiveRefreshId = 0

const snapshotJson = (value: unknown): string | undefined => JSON.stringify(value)

const isJsonSnapshotEqual = (left: unknown, right: unknown): boolean => snapshotJson(left) === snapshotJson(right)

const cloneJsonValue = <T>(value: T): T => {
  const snapshot = snapshotJson(value)
  return snapshot === undefined ? value : (JSON.parse(snapshot) as T)
}

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

const insertIndexFor = (index: number | undefined, length: number): number => {
  if (index === undefined) return length
  if (index < 0) return 0
  if (index > length) return length
  return index
}

export function createLatestOperationGuard<
  TTarget extends OperationTargetKey = OperationTargetKey,
>(): LatestOperationGuard<TTarget> {
  const latestByTarget = new Map<TTarget, number>()

  return {
    issue(target) {
      const token = { target, sequence: ++nextOperationSequence }
      latestByTarget.set(target, token.sequence)
      return token
    },
    isLatest(token) {
      return latestByTarget.get(token.target) === token.sequence
    },
    clear(token) {
      if (latestByTarget.get(token.target) === token.sequence) {
        latestByTarget.delete(token.target)
      }
    },
  }
}

export function isLatestOperation<TTarget extends OperationTargetKey>(
  guard: Pick<LatestOperationGuard<TTarget>, 'isLatest'>,
  token: LatestOperationToken<TTarget>,
): boolean {
  return guard.isLatest(token)
}

export function applyAttemptedFieldRollback<T extends Record<string, unknown>>(input: {
  target: T
  previous: Partial<T>
  attempted: Partial<T>
  keys?: Iterable<keyof T & string>
  deleteMissingPrevious?: boolean
}): string[] {
  const { target, previous, attempted, deleteMissingPrevious = false } = input
  const keys = input.keys ?? (Object.keys(attempted) as Array<keyof T & string>)
  const rolledBack: string[] = []

  for (const key of keys) {
    if (!hasOwn(attempted, key)) continue

    const liveValue = target[key]
    const attemptedValue = attempted[key]

    if (!isJsonSnapshotEqual(liveValue, attemptedValue)) continue

    if (hasOwn(previous, key)) {
      target[key] = cloneJsonValue(previous[key]) as T[keyof T & string]
      rolledBack.push(key)
      continue
    }

    if (deleteMissingPrevious && hasOwn(target, key)) {
      delete target[key]
      rolledBack.push(key)
    }
  }

  return rolledBack
}

export function applyAttemptedKeyedListRollback<TItem, TKey extends OperationTargetKey>(input: {
  list: TItem[]
  entries: readonly {
    key: TKey
    previous: TItem | null
    attempted: TItem | null
    previousIndex?: number
  }[]
  getKey: (item: TItem) => TKey | null | undefined
}): TKey[] {
  const { list, entries, getKey } = input
  const rolledBack: TKey[] = []

  for (const entry of entries) {
    const liveIndex = list.findIndex((item) => getKey(item) === entry.key)
    const liveValue = liveIndex === -1 ? null : list[liveIndex]

    if (!isJsonSnapshotEqual(liveValue, entry.attempted)) continue

    if (entry.previous === null) {
      if (liveIndex !== -1) {
        list.splice(liveIndex, 1)
        rolledBack.push(entry.key)
      }
      continue
    }

    const previous = cloneJsonValue(entry.previous)

    if (liveIndex === -1) {
      list.splice(insertIndexFor(entry.previousIndex, list.length), 0, previous)
      rolledBack.push(entry.key)
      continue
    }

    list[liveIndex] = previous
    rolledBack.push(entry.key)
  }

  return rolledBack
}

export function mergeProjectionIntoDirtyDraft<T extends Record<string, unknown>>(input: {
  draft: T
  projection: Partial<T>
  dirtyFields: ReadonlySet<keyof T & string>
}): T {
  const { draft, projection, dirtyFields } = input

  for (const key of Object.keys(projection) as Array<keyof T & string>) {
    if (dirtyFields.has(key)) continue
    draft[key] = cloneJsonValue(projection[key]) as T[keyof T & string]
  }

  return draft
}

export function createDestructiveRefreshToken(reason: string): DestructiveRefreshToken {
  return {
    kind: 'destructive-refresh',
    id: ++nextDestructiveRefreshId,
    reason,
  }
}
