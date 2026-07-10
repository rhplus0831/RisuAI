import { describe, expect, it } from 'vitest'

import {
  applyFreshCharacterNotificationImageUpload,
  beginCharacterNotificationImageUpload,
  captureCharacterNotificationImageUploadTarget,
  clearCharacterNotificationImageUpload,
  invalidateCharacterNotificationImageUpload,
  type CharacterNotificationImageUploadFreshness,
  type CharacterNotificationImageUploadOperation,
} from './characterNotificationImageUpload'

function beginUpload(
  input: {
    characterId?: string
    characterIndex?: number
    draftCharacterId?: string | null
    rowNotificationImage?: unknown
    draftNotificationImage?: unknown
  } = {},
): CharacterNotificationImageUploadOperation {
  const target = captureCharacterNotificationImageUploadTarget({
    characterId: input.characterId ?? 'char-a',
    characterIndex: input.characterIndex ?? 0,
    draftCharacterId: input.draftCharacterId ?? 'char-a',
    rowNotificationImage: input.rowNotificationImage ?? 'original-image',
    draftNotificationImage: input.draftNotificationImage ?? 'original-image',
  })

  if (!target) throw new Error('expected notification image upload target')
  return beginCharacterNotificationImageUpload(target)
}

function freshness(
  overrides: Partial<CharacterNotificationImageUploadFreshness> = {},
): CharacterNotificationImageUploadFreshness {
  return {
    currentCharacterId: 'char-a',
    rowCharacterId: 'char-a',
    draftCharacterId: 'char-a',
    rowNotificationImage: 'original-image',
    draftNotificationImage: 'original-image',
    ...overrides,
  }
}

describe('character notification image upload freshness', () => {
  it('rejects completion after the target row or draft field changes', () => {
    const operation = beginUpload()

    try {
      expect(
        applyFreshCharacterNotificationImageUpload({
          operation,
          freshness: freshness({ rowNotificationImage: 'newer-row-image' }),
          image: 'uploaded-image',
        }),
      ).toBeNull()
      expect(
        applyFreshCharacterNotificationImageUpload({
          operation,
          freshness: freshness({ draftNotificationImage: 'newer-draft-image' }),
          image: 'uploaded-image',
        }),
      ).toBeNull()
      expect(
        applyFreshCharacterNotificationImageUpload({
          operation,
          freshness: freshness({ draftCharacterId: 'char-b' }),
          image: 'uploaded-image',
        }),
      ).toBeNull()
    } finally {
      clearCharacterNotificationImageUpload(operation)
    }
  })

  it('lets a newer same-character selection supersede an older upload', () => {
    const older = beginUpload()
    const newer = beginUpload()

    try {
      expect(
        applyFreshCharacterNotificationImageUpload({
          operation: older,
          freshness: freshness(),
          image: 'older-image',
        }),
      ).toBeNull()
      expect(
        applyFreshCharacterNotificationImageUpload({
          operation: newer,
          freshness: freshness(),
          image: 'newer-image',
        }),
      ).toBe('newer-image')
    } finally {
      clearCharacterNotificationImageUpload(older)
      clearCharacterNotificationImageUpload(newer)
    }
  })

  it('invalidates a pending upload when the image is cleared', () => {
    const operation = beginUpload()

    try {
      invalidateCharacterNotificationImageUpload('char-a')

      expect(
        applyFreshCharacterNotificationImageUpload({
          operation,
          freshness: freshness({
            rowNotificationImage: '',
            draftNotificationImage: '',
          }),
          image: 'older-image',
        }),
      ).toBeNull()
    } finally {
      clearCharacterNotificationImageUpload(operation)
    }
  })
})
