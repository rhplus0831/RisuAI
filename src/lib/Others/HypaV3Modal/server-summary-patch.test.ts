import { describe, expect, it } from 'vitest'
import type { SerializableSummary } from 'src/ts/process/memory/hypav3'
import { buildServerSummaryPatch } from './server-summary-patch'

function summary(overrides: Partial<SerializableSummary> = {}): SerializableSummary {
  return {
    text: 'summary text',
    chatMemos: ['message-1'],
    isImportant: true,
    categoryId: 'story',
    tags: ['plot'],
    ...overrides,
  }
}

describe('buildServerSummaryPatch', () => {
  it('returns only the field that changed', () => {
    const value = summary()

    expect(buildServerSummaryPatch(value, 'text')).toEqual({ text: 'summary text' })
    expect(buildServerSummaryPatch(value, 'isImportant')).toEqual({ isImportant: true })
    expect(buildServerSummaryPatch(value, 'categoryId')).toEqual({ categoryId: 'story' })
  })

  it('normalizes tags in both the patch and local summary', () => {
    const value = summary({ tags: [' plot ', '', 'plot', ' character '] })

    expect(buildServerSummaryPatch(value, 'tags')).toEqual({ tags: ['plot', 'character'] })
    expect(value.tags).toEqual(['plot', 'character'])
  })

  it('uses null to remove absent optional metadata', () => {
    const value = summary({ categoryId: undefined, tags: undefined })

    expect(buildServerSummaryPatch(value, 'categoryId')).toEqual({ categoryId: null })
    expect(buildServerSummaryPatch(value, 'tags')).toEqual({ tags: null })
  })
})
