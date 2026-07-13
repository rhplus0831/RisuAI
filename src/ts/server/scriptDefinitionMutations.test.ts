import { describe, expect, it } from 'vitest'
import { classifyScriptDefinitionMutation } from './scriptDefinitionMutations'

describe('script definition mutation classifier', () => {
  it('suppresses exact and semantic undefined-only no-ops', () => {
    expect(classifyScriptDefinitionMutation([{ id: 'a', text: 'same' }], [{ text: 'same', id: 'a' }])).toEqual({
      kind: 'none',
    })
    expect(classifyScriptDefinitionMutation([{ id: 'a' }], [{ id: 'a', optional: undefined }])).toEqual({
      kind: 'none',
    })
  })

  it('updates only changed fields and encodes removed or undefined fields as deleteKeys', () => {
    const unchangedLargeBody = 'x'.repeat(64 * 1024)
    const plan = classifyScriptDefinitionMutation(
      [{ id: 'a', comment: 'before', body: unchangedLargeBody, nullable: 'before', removed: true }],
      [{ id: 'a', comment: 'after', body: unchangedLargeBody, nullable: null, removed: undefined }],
    )

    expect(plan).toEqual({
      kind: 'mutation',
      mutation: {
        op: 'update',
        id: 'a',
        patch: { comment: 'after', nullable: null },
        deleteKeys: ['removed'],
      },
    })
    expect(JSON.stringify(plan)).not.toContain(unchangedLargeBody)
  })

  it('creates one final edited row at its final index', () => {
    const original = [{ id: 'a', text: 'A' }]
    const extension = { enabled: true }
    const final: Array<Record<string, unknown>> = [original[0], { id: 'b', text: 'edited after create', extension }]
    const plan = classifyScriptDefinitionMutation(original, final)
    expect(plan).toEqual({
      kind: 'mutation',
      mutation: {
        op: 'create',
        row: { id: 'b', text: 'edited after create', extension: { enabled: true } },
        index: 1,
      },
    })
    extension.enabled = false
    expect(plan).toEqual({
      kind: 'mutation',
      mutation: {
        op: 'create',
        row: { id: 'b', text: 'edited after create', extension: { enabled: true } },
        index: 1,
      },
    })
  })

  it('deletes one row when every remaining row and its order are unchanged', () => {
    expect(
      classifyScriptDefinitionMutation(
        [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
        [{ id: 'b', text: 'B' }],
      ),
    ).toEqual({ kind: 'mutation', mutation: { op: 'delete', id: 'a' } })
  })

  it('reorders an otherwise unchanged collection', () => {
    expect(
      classifyScriptDefinitionMutation(
        [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
        [
          { id: 'b', text: 'B' },
          { id: 'a', text: 'A' },
        ],
      ),
    ).toEqual({ kind: 'mutation', mutation: { op: 'reorder', ids: ['b', 'a'] } })
  })

  it.each([
    [
      'multiple content edits',
      [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      [
        { id: 'a', text: 'changed A' },
        { id: 'b', text: 'changed B' },
      ],
    ],
    [
      'content plus reorder',
      [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      [
        { id: 'b', text: 'changed B' },
        { id: 'a', text: 'A' },
      ],
    ],
    ['create plus content edit', [{ id: 'a', text: 'A' }], [{ id: 'a', text: 'changed' }, { id: 'b' }]],
    ['delete plus reorder', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'c' }, { id: 'a' }]],
    ['id replacement', [{ id: 'a', text: 'same' }], [{ id: 'b', text: 'same' }]],
    ['multiple creates', [], [{ id: 'a' }, { id: 'b' }]],
    ['multiple deletes', [{ id: 'a' }, { id: 'b' }], []],
    ['missing ids', [{ id: 'a' }], [{ text: 'missing' }]],
    ['duplicate ids', [{ id: 'a' }], [{ id: 'a' }, { id: 'a' }]],
  ])('falls back to full replacement for %s', (_label, previous, final) => {
    expect(classifyScriptDefinitionMutation(previous, final)).toEqual({ kind: 'replace' })
  })
})
