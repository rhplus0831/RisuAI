import { describe, expect, it } from 'vitest'
import {
  createTranscriptMessageViewOwner,
  MAX_TRANSCRIPT_MESSAGE_VIEWS,
  MAX_TRANSCRIPT_MESSAGE_VIEW_KEY_LENGTH,
} from './transcriptMessageView'

const manualOriginal = { translated: false, suppressAutomaticTranslationDisplay: true }

describe('transcript message display preferences', () => {
  it('restores flags across captures without retaining mutable caller objects', () => {
    const owner = createTranscriptMessageViewOwner()
    const view = { ...manualOriginal }
    owner.capture('message-a').write(view)
    view.translated = true
    const restored = owner.capture('message-a').read()!
    expect(restored).toEqual(manualOriginal)
    restored.translated = true
    expect(owner.capture('message-a').read()).toEqual(manualOriginal)
  })

  it('evicts the least recently read preference at the finite entry limit', () => {
    const owner = createTranscriptMessageViewOwner()
    for (let index = 0; index < MAX_TRANSCRIPT_MESSAGE_VIEWS; index += 1) {
      owner.capture(`message-${index}`).write(manualOriginal)
    }
    expect(owner.capture('message-0').read()).toEqual(manualOriginal)
    owner.capture('extra-message').write(manualOriginal)
    expect(owner.capture('message-1').read()).toBeUndefined()
    expect(owner.capture('message-0').read()).toEqual(manualOriginal)
    expect(owner.capture('extra-message').read()).toEqual(manualOriginal)
  })

  it('rejects oversized identities and clears all preferences on a chat change', () => {
    const owner = createTranscriptMessageViewOwner()
    const oversized = owner.capture('x'.repeat(MAX_TRANSCRIPT_MESSAGE_VIEW_KEY_LENGTH + 1))
    oversized.write(manualOriginal)
    expect(oversized.read()).toBeUndefined()
    const stale = owner.capture('message-a')
    stale.write(manualOriginal)
    owner.reset()
    stale.write(manualOriginal)
    expect(stale.read()).toBeUndefined()
    expect(owner.capture('message-a').read()).toBeUndefined()
  })
})
