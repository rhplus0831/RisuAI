import type { MemorySummary } from './memoryRepository.js'

/**
 * Legacy Hypa V3 summaries predate model-scoped server memory. They remain
 * valid regardless of the currently selected summarization model.
 */
export const LEGACY_HYPA_V3_SUMMARY_MODEL = 'legacy-hypav3'

export function isMemorySummaryCompatibleWithModel(
  summary: Pick<MemorySummary, 'model'>,
  activeModel: string,
): boolean {
  return summary.model === activeModel || summary.model === LEGACY_HYPA_V3_SUMMARY_MODEL
}

/**
 * Prefer the imported row when a pre-fix database has both it and an
 * automatically re-summarized active-model row for the same chunk. The legacy
 * row is the one that retains Important/category/tag and complete memo
 * metadata; selecting only one also prevents duplicate prompt content.
 */
export function filterMemorySummariesForModel(
  summaries: readonly MemorySummary[],
  activeModel: string,
): MemorySummary[] {
  const legacyChunkIds = new Set(
    summaries.filter((summary) => summary.model === LEGACY_HYPA_V3_SUMMARY_MODEL).map((summary) => summary.chunkId),
  )

  return summaries.filter((summary) => {
    if (summary.model === LEGACY_HYPA_V3_SUMMARY_MODEL) return true
    return summary.model === activeModel && !legacyChunkIds.has(summary.chunkId)
  })
}
