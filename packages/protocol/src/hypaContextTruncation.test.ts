import { describe, expect, it } from 'vitest'
import { HYPA_CONTEXT_TRUNCATION_CONFIRMATION_REQUIRED } from './hypaContextTruncation.js'

describe('Hypa context truncation protocol', () => {
  it('keeps the confirmation-required error code stable', () => {
    expect(HYPA_CONTEXT_TRUNCATION_CONFIRMATION_REQUIRED).toBe('hypa_context_truncation_confirmation_required')
  })
})
