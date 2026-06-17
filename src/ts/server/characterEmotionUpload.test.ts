import { describe, expect, it } from 'vitest'

import {
  appendFreshCharacterEmotionImages,
  beginCharacterEmotionUpload,
  captureCharacterEmotionUploadTarget,
  clearCharacterEmotionUpload,
  type CharacterEmotionImageEntry,
  type CharacterEmotionUploadOperation,
} from './characterEmotionUpload'

const emotion = (name: string, path = `emotion-${name}`): CharacterEmotionImageEntry => [name, path]

function beginUpload(input: {
  characterId?: string
  characterIndex?: number
  emotionImages?: CharacterEmotionImageEntry[]
}): CharacterEmotionUploadOperation {
  const target = captureCharacterEmotionUploadTarget({
    characterId: input.characterId ?? 'char-a',
    characterIndex: input.characterIndex,
    emotionImages: input.emotionImages ?? [],
  })

  if (!target) {
    throw new Error('expected upload target')
  }

  return beginCharacterEmotionUpload(target)
}

describe('character emotion image upload freshness', () => {
  it('rejects completion after character switch, row replacement, or newer emotion edits', () => {
    const baseImages = [emotion('base')]
    const switchedCharacterUpload = beginUpload({
      characterId: 'char-switch',
      characterIndex: 0,
      emotionImages: baseImages,
    })
    const replacedRowUpload = beginUpload({
      characterId: 'char-row',
      characterIndex: 0,
      emotionImages: baseImages,
    })
    const editedListUpload = beginUpload({
      characterId: 'char-edit',
      characterIndex: 0,
      emotionImages: baseImages,
    })

    try {
      expect(
        appendFreshCharacterEmotionImages({
          operation: switchedCharacterUpload,
          freshness: {
            currentCharacterId: 'char-b',
            rowCharacterId: 'char-switch',
            draftCharacterId: 'char-b',
            emotionImages: baseImages,
          },
          entries: [emotion('late')],
        }),
      ).toBeNull()

      expect(
        appendFreshCharacterEmotionImages({
          operation: replacedRowUpload,
          freshness: {
            currentCharacterId: 'char-row',
            rowCharacterId: 'char-replacement',
            draftCharacterId: 'char-row',
            emotionImages: baseImages,
          },
          entries: [emotion('late')],
        }),
      ).toBeNull()

      expect(
        appendFreshCharacterEmotionImages({
          operation: editedListUpload,
          freshness: {
            currentCharacterId: 'char-edit',
            rowCharacterId: 'char-edit',
            draftCharacterId: 'char-edit',
            emotionImages: [...baseImages, emotion('newer-local-edit')],
          },
          entries: [emotion('late')],
        }),
      ).toBeNull()
    } finally {
      clearCharacterEmotionUpload(switchedCharacterUpload)
      clearCharacterEmotionUpload(replacedRowUpload)
      clearCharacterEmotionUpload(editedListUpload)
    }
  })

  it('rejects quick-add completion instead of overwriting a newer live emotion list', () => {
    const baseImages = [emotion('base')]
    const operation = beginUpload({ characterId: 'char-a', emotionImages: baseImages })

    try {
      const appended = appendFreshCharacterEmotionImages({
        operation,
        freshness: {
          currentCharacterId: 'char-a',
          rowCharacterId: 'char-a',
          emotionImages: [...baseImages, emotion('newer-live')],
        },
        entries: [emotion('late')],
      })

      expect(appended).toBeNull()
    } finally {
      clearCharacterEmotionUpload(operation)
    }
  })

  it('lets the newer upload for the same character win over an older delayed upload', () => {
    const older = beginUpload({ characterId: 'char-a', emotionImages: [] })
    const newer = beginUpload({ characterId: 'char-a', emotionImages: [] })

    try {
      const newerResult = appendFreshCharacterEmotionImages({
        operation: newer,
        freshness: {
          currentCharacterId: 'char-a',
          rowCharacterId: 'char-a',
          emotionImages: [],
        },
        entries: [emotion('newer')],
      })

      expect(newerResult).toEqual([emotion('newer')])

      const olderResult = appendFreshCharacterEmotionImages({
        operation: older,
        freshness: {
          currentCharacterId: 'char-a',
          rowCharacterId: 'char-a',
          emotionImages: [],
        },
        entries: [emotion('older')],
      })

      expect(olderResult).toBeNull()
    } finally {
      clearCharacterEmotionUpload(older)
      clearCharacterEmotionUpload(newer)
    }
  })

  it('does not let a canceled newer picker invalidate an older pending upload', () => {
    const baseImages = [emotion('base')]
    const older = beginUpload({ characterId: 'char-a', emotionImages: baseImages })

    const canceledTarget = captureCharacterEmotionUploadTarget({
      characterId: 'char-a',
      emotionImages: baseImages,
    })

    try {
      expect(canceledTarget).not.toBeNull()
      const result = appendFreshCharacterEmotionImages({
        operation: older,
        freshness: {
          currentCharacterId: 'char-a',
          rowCharacterId: 'char-a',
          emotionImages: baseImages,
        },
        entries: [emotion('older')],
      })

      expect(result).toEqual([...baseImages, emotion('older')])
    } finally {
      clearCharacterEmotionUpload(older)
    }
  })

  it('appends only when the character and emotion snapshot still match', () => {
    const baseImages = [emotion('base')]
    const operation = beginUpload({ characterId: 'char-a', emotionImages: baseImages })

    try {
      expect(
        appendFreshCharacterEmotionImages({
          operation,
          freshness: {
            currentCharacterId: 'char-a',
            rowCharacterId: 'char-a',
            emotionImages: baseImages,
          },
          entries: [emotion('fresh')],
        }),
      ).toEqual([...baseImages, emotion('fresh')])
    } finally {
      clearCharacterEmotionUpload(operation)
    }
  })
})
