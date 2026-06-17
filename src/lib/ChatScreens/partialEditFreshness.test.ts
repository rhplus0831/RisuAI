import { describe, expect, it } from 'vitest'
import {
  resolveFreshPartialEditSave,
  type PartialEditLiveMessageState,
  type PartialEditSaveDetail,
} from './partialEditFreshness'

function makeDetail(overrides: Partial<PartialEditSaveDetail> = {}): PartialEditSaveDetail {
  return {
    newData: 'alpha edited omega',
    sourceData: 'alpha source omega',
    sourceRange: {
      start: 6,
      end: 12,
      method: 'exact',
      confidence: 1,
    },
    mode: 'edit',
    chatIndex: 2,
    chatId: 'chat-a',
    messageId: 'message-a',
    ...overrides,
  }
}

function makeLive(overrides: Partial<PartialEditLiveMessageState> = {}): PartialEditLiveMessageState {
  return {
    chatIndex: 2,
    chatId: 'chat-a',
    messageId: 'message-a',
    data: 'alpha source omega',
    ...overrides,
  }
}

describe('resolveFreshPartialEditSave', () => {
  it('accepts matching chat, message, index, and source data', () => {
    expect(resolveFreshPartialEditSave(makeDetail(), makeLive())).toEqual({
      ok: true,
      detail: makeDetail(),
    })
  })

  it('rejects changed message data while the modal is open', () => {
    expect(resolveFreshPartialEditSave(makeDetail(), makeLive({ data: 'alpha newer omega' }))).toEqual({
      ok: false,
      reason: 'source-data-changed',
    })
  })

  it('rejects changed message id', () => {
    expect(resolveFreshPartialEditSave(makeDetail(), makeLive({ messageId: 'message-b' }))).toEqual({
      ok: false,
      reason: 'message-id-changed',
    })
  })

  it('rejects changed chat id', () => {
    expect(resolveFreshPartialEditSave(makeDetail(), makeLive({ chatId: 'chat-b' }))).toEqual({
      ok: false,
      reason: 'chat-id-changed',
    })
  })

  it('allows no-id fallback only when index and source data still match', () => {
    const detail = makeDetail({ chatId: undefined, messageId: undefined })
    const live = makeLive({ chatId: undefined, messageId: undefined })

    expect(resolveFreshPartialEditSave(detail, live)).toEqual({
      ok: true,
      detail,
    })
    expect(resolveFreshPartialEditSave(detail, { ...live, chatIndex: 3 })).toEqual({
      ok: false,
      reason: 'chat-index-changed',
    })
    expect(resolveFreshPartialEditSave(detail, { ...live, data: 'alpha newer omega' })).toEqual({
      ok: false,
      reason: 'source-data-changed',
    })
    expect(resolveFreshPartialEditSave(detail, { ...live, messageId: 'message-a' })).toEqual({
      ok: false,
      reason: 'message-id-changed',
    })
  })
})
