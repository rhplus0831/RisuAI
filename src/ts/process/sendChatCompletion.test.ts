import { describe, expect, it, vi } from 'vitest'
import { applySuccessfulSendChatEffects, type SuccessfulSendChatEffects } from './sendChatCompletion'

function effects(calls: string[] = []): SuccessfulSendChatEffects {
  return {
    clearRerollBuffer: vi.fn(() => calls.push('clear')),
    recordGeneratedReroll: vi.fn(() => calls.push('record')),
    markRerollChar: vi.fn(() => calls.push('mark')),
  }
}

describe('applySuccessfulSendChatEffects', () => {
  it('skips all success side effects when sendChat returns false', () => {
    const sendEffects = effects()

    const applied = applySuccessfulSendChatEffects(
      { sendSucceeded: false, previousLength: 2, confirmBoundary: true },
      sendEffects,
    )

    expect(applied).toBe(false)
    expect(sendEffects.clearRerollBuffer).not.toHaveBeenCalled()
    expect(sendEffects.recordGeneratedReroll).not.toHaveBeenCalled()
    expect(sendEffects.markRerollChar).not.toHaveBeenCalled()
  })

  it('runs success side effects after a successful send', () => {
    const calls: string[] = []
    const sendEffects = effects(calls)

    const applied = applySuccessfulSendChatEffects(
      { sendSucceeded: true, previousLength: 2, confirmBoundary: true },
      sendEffects,
    )

    expect(applied).toBe(true)
    expect(sendEffects.recordGeneratedReroll).toHaveBeenCalledWith(2)
    expect(calls).toEqual(['clear', 'record', 'mark'])
  })

  it('keeps reroll buffer when the caller is not confirming the boundary', () => {
    const calls: string[] = []
    const sendEffects = effects(calls)

    const applied = applySuccessfulSendChatEffects(
      { sendSucceeded: true, previousLength: 1, confirmBoundary: false },
      sendEffects,
    )

    expect(applied).toBe(true)
    expect(sendEffects.clearRerollBuffer).not.toHaveBeenCalled()
    expect(calls).toEqual(['record', 'mark'])
  })
})
