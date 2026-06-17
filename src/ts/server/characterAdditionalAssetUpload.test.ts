import { describe, expect, it } from 'vitest'

import {
  appendFreshCharacterAdditionalAssets,
  beginCharacterAdditionalAssetUpload,
  captureCharacterAdditionalAssetUploadTarget,
  clearCharacterAdditionalAssetUpload,
  type CharacterAdditionalAssetEntry,
  type CharacterAdditionalAssetUploadOperation,
} from './characterAdditionalAssetUpload'

const asset = (name: string, path = `asset-${name}`, extension = 'png'): CharacterAdditionalAssetEntry => [
  name,
  path,
  extension,
]

function beginUpload(input: {
  characterId?: string
  characterIndex?: number
  additionalAssets?: CharacterAdditionalAssetEntry[]
}): CharacterAdditionalAssetUploadOperation {
  const target = captureCharacterAdditionalAssetUploadTarget({
    characterId: input.characterId ?? 'char-a',
    characterIndex: input.characterIndex,
    additionalAssets: input.additionalAssets ?? [],
  })

  if (!target) {
    throw new Error('expected upload target')
  }

  return beginCharacterAdditionalAssetUpload(target)
}

describe('character additional asset upload freshness', () => {
  it('rejects editor completion after character switch or newer asset edits', () => {
    const baseAssets = [asset('base')]
    const switchedCharacterUpload = beginUpload({
      characterId: 'char-switch',
      characterIndex: 0,
      additionalAssets: baseAssets,
    })
    const editedListUpload = beginUpload({
      characterId: 'char-edit',
      characterIndex: 0,
      additionalAssets: baseAssets,
    })

    try {
      expect(
        appendFreshCharacterAdditionalAssets({
          operation: switchedCharacterUpload,
          freshness: {
            currentCharacterId: 'char-b',
            rowCharacterId: 'char-switch',
            draftCharacterId: 'char-b',
            additionalAssets: baseAssets,
          },
          entries: [asset('late')],
        }),
      ).toBeNull()

      expect(
        appendFreshCharacterAdditionalAssets({
          operation: editedListUpload,
          freshness: {
            currentCharacterId: 'char-edit',
            rowCharacterId: 'char-edit',
            draftCharacterId: 'char-edit',
            additionalAssets: [...baseAssets, asset('newer-local-edit')],
          },
          entries: [asset('late')],
        }),
      ).toBeNull()
    } finally {
      clearCharacterAdditionalAssetUpload(switchedCharacterUpload)
      clearCharacterAdditionalAssetUpload(editedListUpload)
    }
  })

  it('rejects quick-add completion instead of overwriting a newer live asset list', () => {
    const baseAssets = [asset('base')]
    const operation = beginUpload({ characterId: 'char-a', additionalAssets: baseAssets })

    try {
      const appended = appendFreshCharacterAdditionalAssets({
        operation,
        freshness: {
          currentCharacterId: 'char-a',
          rowCharacterId: 'char-a',
          additionalAssets: [...baseAssets, asset('newer-live')],
        },
        entries: [asset('late')],
      })

      expect(appended).toBeNull()
    } finally {
      clearCharacterAdditionalAssetUpload(operation)
    }
  })

  it('lets the newer upload for the same character win over an older delayed upload', () => {
    const older = beginUpload({ characterId: 'char-a', additionalAssets: [] })
    const newer = beginUpload({ characterId: 'char-a', additionalAssets: [] })

    try {
      const newerResult = appendFreshCharacterAdditionalAssets({
        operation: newer,
        freshness: {
          currentCharacterId: 'char-a',
          rowCharacterId: 'char-a',
          additionalAssets: [],
        },
        entries: [asset('newer')],
      })

      expect(newerResult).toEqual([asset('newer')])

      const olderResult = appendFreshCharacterAdditionalAssets({
        operation: older,
        freshness: {
          currentCharacterId: 'char-a',
          rowCharacterId: 'char-a',
          additionalAssets: [],
        },
        entries: [asset('older')],
      })

      expect(olderResult).toBeNull()
    } finally {
      clearCharacterAdditionalAssetUpload(older)
      clearCharacterAdditionalAssetUpload(newer)
    }
  })

  it('does not let a canceled newer picker invalidate an older pending upload', () => {
    const baseAssets = [asset('base')]
    const older = beginUpload({ characterId: 'char-a', additionalAssets: baseAssets })

    const canceledTarget = captureCharacterAdditionalAssetUploadTarget({
      characterId: 'char-a',
      additionalAssets: baseAssets,
    })

    try {
      expect(canceledTarget).not.toBeNull()
      const result = appendFreshCharacterAdditionalAssets({
        operation: older,
        freshness: {
          currentCharacterId: 'char-a',
          rowCharacterId: 'char-a',
          additionalAssets: baseAssets,
        },
        entries: [asset('older')],
      })

      expect(result).toEqual([...baseAssets, asset('older')])
    } finally {
      clearCharacterAdditionalAssetUpload(older)
    }
  })
})
