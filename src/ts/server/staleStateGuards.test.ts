import { describe, expect, it, vi } from 'vitest'

import {
  applyAttemptedFieldRollback,
  applyAttemptedKeyedListRollback,
  captureDestructiveRefreshEpoch,
  createDestructiveRefreshToken,
  createLatestOperationGuard,
  hasDestructiveRefreshEpochChanged,
  isLatestOperation,
  mergeProjectionIntoDirtyDraft,
  runRollbackUnlessDestructiveRefreshChanged,
} from './staleStateGuards'

type Row = {
  id: string
  label: string
  meta?: {
    count: number
  }
}

const row = (id: string, label: string, count = 1): Row => ({
  id,
  label,
  meta: { count },
})

describe('latest operation guard', () => {
  it('accepts newest token per target and rejects older token for same target', () => {
    const guard = createLatestOperationGuard<string>()
    const older = guard.issue('target-a')
    const newer = guard.issue('target-a')

    expect(guard.isLatest(newer)).toBe(true)
    expect(guard.isLatest(older)).toBe(false)
    expect(isLatestOperation(guard, newer)).toBe(true)
  })

  it('keeps separate targets from invalidating each other', () => {
    const guard = createLatestOperationGuard<string>()
    const targetA = guard.issue('target-a')
    const targetB = guard.issue('target-b')

    expect(guard.isLatest(targetA)).toBe(true)
    expect(guard.isLatest(targetB)).toBe(true)
  })

  it('clear() invalidates only the matching token', () => {
    const guard = createLatestOperationGuard<string>()
    const targetA = guard.issue('target-a')
    const staleTargetB = guard.issue('target-b')
    const targetB = guard.issue('target-b')

    guard.clear(staleTargetB)

    expect(guard.isLatest(targetA)).toBe(true)
    expect(guard.isLatest(targetB)).toBe(true)

    guard.clear(targetA)

    expect(guard.isLatest(targetA)).toBe(false)
    expect(guard.isLatest(targetB)).toBe(true)
  })
})

describe('attempted field rollback', () => {
  it('restores only attempted fields whose live value still equals attempted', () => {
    const target = {
      name: 'attempted',
      description: 'local edit',
      untouched: 'stay',
    }

    const rolledBack = applyAttemptedFieldRollback({
      target,
      previous: { name: 'before', description: 'old description' },
      attempted: { name: 'attempted', description: 'attempted description' },
    })

    expect(rolledBack).toEqual(['name'])
    expect(target).toEqual({
      name: 'before',
      description: 'local edit',
      untouched: 'stay',
    })
  })

  it('skips newer local edits', () => {
    const target = {
      title: 'newer local edit',
    }

    const rolledBack = applyAttemptedFieldRollback({
      target,
      previous: { title: 'before' },
      attempted: { title: 'failed attempt' },
    })

    expect(rolledBack).toEqual([])
    expect(target.title).toBe('newer local edit')
  })

  it('deletes keys added by failed attempt when deleteMissingPrevious is true', () => {
    const target: Record<string, unknown> = {
      added: { nested: 'attempted' },
      kept: 'value',
    }

    const rolledBack = applyAttemptedFieldRollback({
      target,
      previous: {},
      attempted: { added: { nested: 'attempted' } },
      deleteMissingPrevious: true,
    })

    expect(rolledBack).toEqual(['added'])
    expect(target).toEqual({ kept: 'value' })
  })

  it('ignores broad keys that are absent from attempted', () => {
    const target: Record<string, unknown> = {
      touched: 'attempted',
      absentWithPrevious: undefined,
      absentWithoutPrevious: undefined,
    }

    const rolledBack = applyAttemptedFieldRollback({
      target,
      previous: {
        touched: 'before',
        absentWithPrevious: 'previous value',
      },
      attempted: { touched: 'attempted' },
      keys: ['touched', 'absentWithPrevious', 'absentWithoutPrevious'],
      deleteMissingPrevious: true,
    })

    expect(rolledBack).toEqual(['touched'])
    expect(target).toEqual({
      touched: 'before',
      absentWithPrevious: undefined,
      absentWithoutPrevious: undefined,
    })
    expect(Object.hasOwn(target, 'absentWithoutPrevious')).toBe(true)
  })
})

describe('attempted keyed list rollback', () => {
  it('replaces, removes, and inserts only targeted ids while preserving sibling rows', () => {
    const list = [row('a', 'attempted replace'), row('b', 'sibling'), row('c', 'attempted insert')]

    const rolledBack = applyAttemptedKeyedListRollback({
      list,
      entries: [
        {
          key: 'a',
          previous: row('a', 'before replace'),
          attempted: row('a', 'attempted replace'),
        },
        {
          key: 'c',
          previous: null,
          attempted: row('c', 'attempted insert'),
        },
        {
          key: 'd',
          previous: row('d', 'before delete'),
          attempted: null,
          previousIndex: 2,
        },
      ],
      getKey: (item) => item.id,
    })

    expect(rolledBack).toEqual(['a', 'c', 'd'])
    expect(list).toEqual([row('a', 'before replace'), row('b', 'sibling'), row('d', 'before delete')])
  })

  it('skips when the live row differs from attempted', () => {
    const list = [row('a', 'newer local edit'), row('b', 'sibling')]

    const rolledBack = applyAttemptedKeyedListRollback({
      list,
      entries: [
        {
          key: 'a',
          previous: row('a', 'before'),
          attempted: row('a', 'failed attempt'),
        },
      ],
      getKey: (item) => item.id,
    })

    expect(rolledBack).toEqual([])
    expect(list).toEqual([row('a', 'newer local edit'), row('b', 'sibling')])
  })

  it('does not let sequential failures unwind newer successful or local state', () => {
    const list = [row('a', 'second attempt')]

    const firstFailure = applyAttemptedKeyedListRollback({
      list,
      entries: [
        {
          key: 'a',
          previous: row('a', 'initial'),
          attempted: row('a', 'first attempt'),
        },
      ],
      getKey: (item) => item.id,
    })

    expect(firstFailure).toEqual([])
    expect(list).toEqual([row('a', 'second attempt')])

    list[0] = row('a', 'local edit after second attempt')

    const secondFailure = applyAttemptedKeyedListRollback({
      list,
      entries: [
        {
          key: 'a',
          previous: row('a', 'first attempt'),
          attempted: row('a', 'second attempt'),
        },
      ],
      getKey: (item) => item.id,
    })

    expect(secondFailure).toEqual([])
    expect(list).toEqual([row('a', 'local edit after second attempt')])
  })
})

describe('dirty draft projection merge', () => {
  it('updates clean fields and preserves dirty fields', () => {
    const draft = {
      name: 'dirty draft',
      description: 'old description',
      nested: { count: 1 },
    }
    const projection = {
      name: 'server name',
      description: 'server description',
      nested: { count: 2 },
    }

    const merged = mergeProjectionIntoDirtyDraft({
      draft,
      projection,
      dirtyFields: new Set<keyof typeof draft & string>(['name']),
    })

    expect(merged).toBe(draft)
    expect(draft).toEqual({
      name: 'dirty draft',
      description: 'server description',
      nested: { count: 2 },
    })
    expect(draft.nested).not.toBe(projection.nested)
  })
})

describe('destructive refresh tokens', () => {
  it('are explicit, unique, and carry the reason', () => {
    const first = createDestructiveRefreshToken('restore-backup')
    const second = createDestructiveRefreshToken('full-resync')

    expect(first).toMatchObject({
      kind: 'destructive-refresh',
      reason: 'restore-backup',
    })
    expect(second).toMatchObject({
      kind: 'destructive-refresh',
      reason: 'full-resync',
    })
    expect(second.id).not.toBe(first.id)
  })

  it('captures the current epoch and reports later destructive refreshes', () => {
    const before = captureDestructiveRefreshEpoch()

    expect(hasDestructiveRefreshEpochChanged(before)).toBe(false)

    createDestructiveRefreshToken('restore-backup')

    expect(hasDestructiveRefreshEpochChanged(before)).toBe(true)
    expect(hasDestructiveRefreshEpochChanged(captureDestructiveRefreshEpoch())).toBe(false)
  })

  it('runs rollback only when the destructive refresh epoch is unchanged', () => {
    const currentRollback = vi.fn()
    const staleRollback = vi.fn()
    const currentEpoch = captureDestructiveRefreshEpoch()

    expect(runRollbackUnlessDestructiveRefreshChanged(currentRollback, currentEpoch)).toBe(true)
    expect(currentRollback).toHaveBeenCalledTimes(1)

    const staleEpoch = captureDestructiveRefreshEpoch()
    createDestructiveRefreshToken('full-resync')

    expect(runRollbackUnlessDestructiveRefreshChanged(staleRollback, staleEpoch)).toBe(false)
    expect(staleRollback).not.toHaveBeenCalled()
  })
})
