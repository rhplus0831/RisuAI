import type { RangeResult } from 'src/ts/parser/partialEdit'

export type PartialEditMode = 'edit' | 'delete'

export interface PartialEditSaveDetail {
  newData: string
  sourceData: string
  sourceRange: RangeResult
  mode: PartialEditMode
  chatIndex: number
  chatId?: string
  messageId?: string
}

export interface PartialEditLiveMessageState {
  chatIndex: number
  chatId?: string | null
  messageId?: string | null
  data?: string | null
}

export type PartialEditFreshnessFailureReason =
  | 'missing-live-message'
  | 'chat-index-changed'
  | 'chat-id-changed'
  | 'message-id-changed'
  | 'source-data-changed'

export type PartialEditFreshnessResolution =
  | { ok: true; detail: PartialEditSaveDetail }
  | { ok: false; reason: PartialEditFreshnessFailureReason }

function normalizeOptionalId(value: string | null | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined
}

export function resolveFreshPartialEditSave(
  detail: PartialEditSaveDetail,
  live: PartialEditLiveMessageState | null | undefined,
): PartialEditFreshnessResolution {
  if (!live || typeof live.data !== 'string') {
    return { ok: false, reason: 'missing-live-message' }
  }

  if (live.chatIndex !== detail.chatIndex) {
    return { ok: false, reason: 'chat-index-changed' }
  }

  if (normalizeOptionalId(live.chatId) !== normalizeOptionalId(detail.chatId)) {
    return { ok: false, reason: 'chat-id-changed' }
  }

  if (normalizeOptionalId(live.messageId) !== normalizeOptionalId(detail.messageId)) {
    return { ok: false, reason: 'message-id-changed' }
  }

  if (live.data !== detail.sourceData) {
    return { ok: false, reason: 'source-data-changed' }
  }

  return { ok: true, detail }
}
