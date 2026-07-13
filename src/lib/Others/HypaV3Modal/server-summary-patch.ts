import type { SerializableSummary } from 'src/ts/process/memory/hypav3'
import type { PatchServerMemorySummaryInput } from 'src/ts/process/request/serverMemory'

export type ServerSummaryPatchField = keyof PatchServerMemorySummaryInput

export function buildServerSummaryPatch(
  summary: SerializableSummary,
  field: ServerSummaryPatchField,
): PatchServerMemorySummaryInput {
  switch (field) {
    case 'text':
      return { text: summary.text }
    case 'isImportant':
      return { isImportant: summary.isImportant }
    case 'categoryId':
      return { categoryId: summary.categoryId ?? null }
    case 'tags': {
      if (!summary.tags) return { tags: null }
      const tags = [...new Set(summary.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))]
      summary.tags = tags
      return { tags }
    }
  }
}
