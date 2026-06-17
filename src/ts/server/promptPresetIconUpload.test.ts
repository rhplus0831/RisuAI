import { describe, expect, it } from 'vitest'

import {
  beginPromptPresetIconUpload,
  capturePromptPresetIconUploadTarget,
  clearPromptPresetIconUpload,
  resolveFreshPromptPresetIconUploadIndex,
  type PromptPresetIconRecord,
  type PromptPresetIconUploadOperation,
} from './promptPresetIconUpload'

function preset(id: string, image?: unknown): PromptPresetIconRecord {
  return { id, image }
}

function beginUpload(input: {
  presetId?: string
  presetIndex?: number
  image?: unknown
}): PromptPresetIconUploadOperation {
  const image = Object.hasOwn(input, 'image') ? input.image : 'old-image'
  const target = capturePromptPresetIconUploadTarget({
    presetIndex: input.presetIndex ?? 0,
    preset: preset(input.presetId ?? 'preset-a', image),
  })

  if (!target) {
    throw new Error('expected prompt preset icon upload target')
  }

  return beginPromptPresetIconUpload(target)
}

function resolveUpload(
  operation: PromptPresetIconUploadOperation,
  freshness?: Partial<{
    selectedPresetId: string | null
    rowPresetId: string | null
    image: unknown
  }>,
): number | null {
  return resolveFreshPromptPresetIconUploadIndex({
    operation,
    freshness: {
      selectedPresetId: freshness?.selectedPresetId ?? operation.presetId,
      rowPresetId: freshness?.rowPresetId ?? operation.presetId,
      image: Object.hasOwn(freshness ?? {}, 'image') ? freshness?.image : 'old-image',
    },
  })
}

describe('prompt preset icon upload freshness', () => {
  it('rejects stale completion after preset selection changes', () => {
    const operation = beginUpload({ presetId: 'preset-a', image: 'old-image' })

    try {
      expect(
        resolveUpload(operation, {
          selectedPresetId: 'preset-b',
          rowPresetId: 'preset-a',
          image: 'old-image',
        }),
      ).toBeNull()
    } finally {
      clearPromptPresetIconUpload(operation)
    }
  })

  it('rejects stale completion after the captured row no longer contains the same preset', () => {
    const operation = beginUpload({ presetId: 'preset-a', image: 'old-image' })

    try {
      expect(
        resolveUpload(operation, {
          selectedPresetId: 'preset-a',
          rowPresetId: 'preset-b',
          image: 'old-image',
        }),
      ).toBeNull()
    } finally {
      clearPromptPresetIconUpload(operation)
    }
  })

  it('rejects stale completion after the same preset image changes', () => {
    const operation = beginUpload({ presetId: 'preset-a', image: 'old-image' })

    try {
      expect(
        resolveUpload(operation, {
          selectedPresetId: 'preset-a',
          rowPresetId: 'preset-a',
          image: 'newer-image',
        }),
      ).toBeNull()
    } finally {
      clearPromptPresetIconUpload(operation)
    }
  })

  it('lets the newer upload for the same preset win over an older delayed decode', () => {
    const older = beginUpload({ presetId: 'preset-a', image: 'old-image' })
    const newer = beginUpload({ presetId: 'preset-a', image: 'old-image' })

    try {
      expect(resolveUpload(newer)).toBe(0)
      expect(resolveUpload(older)).toBeNull()
    } finally {
      clearPromptPresetIconUpload(older)
      clearPromptPresetIconUpload(newer)
    }
  })

  it('does not let a canceled newer picker invalidate an older pending upload', () => {
    const older = beginUpload({ presetId: 'preset-a', image: 'old-image' })
    const canceledTarget = capturePromptPresetIconUploadTarget({
      presetIndex: 0,
      preset: preset('preset-a', 'old-image'),
    })

    try {
      expect(canceledTarget).not.toBeNull()
      expect(resolveUpload(older)).toBe(0)
    } finally {
      clearPromptPresetIconUpload(older)
    }
  })

  it('resolves the captured update index only when the snapshot still matches', () => {
    const operation = beginUpload({ presetId: 'preset-a', presetIndex: 3, image: undefined })

    try {
      expect(
        resolveUpload(operation, {
          selectedPresetId: 'preset-a',
          rowPresetId: 'preset-a',
          image: undefined,
        }),
      ).toBe(3)

      expect(
        resolveUpload(operation, {
          selectedPresetId: 'preset-a',
          rowPresetId: 'preset-a',
          image: 'newer-image',
        }),
      ).toBeNull()
    } finally {
      clearPromptPresetIconUpload(operation)
    }
  })
})
