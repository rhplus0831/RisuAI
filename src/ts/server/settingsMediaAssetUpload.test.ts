import { describe, expect, it } from 'vitest'

import {
  applyFreshSettingsMediaAssetUpload,
  beginSettingsMediaAssetUpload,
  captureSettingsMediaAssetUploadTarget,
  clearSettingsMediaAssetUpload,
  type SettingsMediaAssetUploadConfig,
  type SettingsMediaAssetUploadContext,
  type SettingsMediaAssetUploadFieldKeys,
  type SettingsMediaAssetUploadOperation,
  type SettingsMediaAssetUploadTargetId,
} from './settingsMediaAssetUpload'

const NAI_CHARACTER_REFERENCE_FIELDS = {
  image: 'character_image',
  base64image: 'character_base64image',
} satisfies SettingsMediaAssetUploadFieldKeys

const NAI_I2I_BASE_FIELDS = {
  image: 'image',
  base64image: 'base64image',
} satisfies SettingsMediaAssetUploadFieldKeys

const WAVESPEED_REFERENCE_FIELDS = {
  image: 'reference_image',
  base64image: 'reference_base64image',
} satisfies SettingsMediaAssetUploadFieldKeys

const naiCharacterContext = {
  provider: 'novelai',
  model: 'nai-diffusion-4-5-full',
  reference_mode: 'character',
}

const naiI2IContext = {
  provider: 'novelai',
  model: 'nai-diffusion-4-5-full',
  i2i: true,
}

const wavespeedContext = {
  provider: 'wavespeed',
  model: 'wavespeed/model-a',
  reference_mode: 'image',
  supportsImageInput: true,
}

function fieldsFor(targetId: SettingsMediaAssetUploadTargetId): SettingsMediaAssetUploadFieldKeys {
  switch (targetId) {
    case 'nai-character-reference':
      return NAI_CHARACTER_REFERENCE_FIELDS
    case 'nai-i2i-base':
      return NAI_I2I_BASE_FIELDS
    case 'wavespeed-reference':
      return WAVESPEED_REFERENCE_FIELDS
  }
}

function contextFor(targetId: SettingsMediaAssetUploadTargetId): SettingsMediaAssetUploadContext {
  switch (targetId) {
    case 'nai-character-reference':
      return naiCharacterContext
    case 'nai-i2i-base':
      return naiI2IContext
    case 'wavespeed-reference':
      return wavespeedContext
  }
}

function beginUpload(input: {
  targetId: SettingsMediaAssetUploadTargetId
  config?: SettingsMediaAssetUploadConfig
  context?: SettingsMediaAssetUploadContext
}): SettingsMediaAssetUploadOperation {
  const target = captureSettingsMediaAssetUploadTarget({
    targetId: input.targetId,
    fieldKeys: fieldsFor(input.targetId),
    config: input.config ?? {},
    context: input.context ?? contextFor(input.targetId),
  })

  return beginSettingsMediaAssetUpload(target)
}

function applyUpload(
  operation: SettingsMediaAssetUploadOperation,
  freshness?: Partial<{
    config: SettingsMediaAssetUploadConfig
    context: SettingsMediaAssetUploadContext
    image: string
  }>,
): SettingsMediaAssetUploadConfig | null {
  return applyFreshSettingsMediaAssetUpload({
    operation,
    freshness: {
      config: freshness?.config ?? {},
      context: freshness?.context ?? contextFor(operation.targetId),
    },
    image: freshness?.image ?? 'uploaded-asset',
  })
}

describe('settings media asset upload freshness', () => {
  it('rejects stale completion after mode, model, or enable context changes', () => {
    const characterReference = beginUpload({ targetId: 'nai-character-reference' })
    const i2iBase = beginUpload({ targetId: 'nai-i2i-base' })
    const wavespeedReference = beginUpload({ targetId: 'wavespeed-reference' })

    try {
      expect(
        applyUpload(characterReference, {
          context: {
            ...naiCharacterContext,
            reference_mode: '',
          },
        }),
      ).toBeNull()

      expect(
        applyUpload(i2iBase, {
          context: {
            ...naiI2IContext,
            i2i: false,
          },
        }),
      ).toBeNull()

      expect(
        applyUpload(wavespeedReference, {
          context: {
            ...wavespeedContext,
            model: 'wavespeed/model-b',
          },
        }),
      ).toBeNull()
    } finally {
      clearSettingsMediaAssetUpload(characterReference)
      clearSettingsMediaAssetUpload(i2iBase)
      clearSettingsMediaAssetUpload(wavespeedReference)
    }
  })

  it('rejects stale completion after image fields are deleted or replaced', () => {
    const deleted = beginUpload({
      targetId: 'nai-i2i-base',
      config: {
        image: 'old-image',
        base64image: 'old-base64',
      },
    })
    const replaced = beginUpload({
      targetId: 'wavespeed-reference',
      config: {
        reference_image: 'old-reference',
        reference_base64image: 'old-base64',
      },
    })

    try {
      expect(
        applyUpload(deleted, {
          config: {},
        }),
      ).toBeNull()

      expect(
        applyUpload(replaced, {
          config: {
            reference_image: 'newer-reference',
            reference_base64image: 'newer-base64',
          },
        }),
      ).toBeNull()
    } finally {
      clearSettingsMediaAssetUpload(deleted)
      clearSettingsMediaAssetUpload(replaced)
    }
  })

  it('lets the newer upload for the same target win over an older delayed upload', () => {
    const older = beginUpload({ targetId: 'nai-i2i-base' })
    const newer = beginUpload({ targetId: 'nai-i2i-base' })

    try {
      expect(
        applyUpload(newer, {
          image: 'newer-asset',
        }),
      ).toEqual({
        image: 'newer-asset',
      })

      expect(
        applyUpload(older, {
          image: 'older-asset',
        }),
      ).toBeNull()
    } finally {
      clearSettingsMediaAssetUpload(older)
      clearSettingsMediaAssetUpload(newer)
    }
  })

  it('does not let a canceled newer picker invalidate an older active upload', () => {
    const older = beginUpload({ targetId: 'wavespeed-reference' })
    const canceledTarget = captureSettingsMediaAssetUploadTarget({
      targetId: 'wavespeed-reference',
      fieldKeys: WAVESPEED_REFERENCE_FIELDS,
      config: {},
      context: wavespeedContext,
    })

    try {
      expect(canceledTarget.targetId).toBe('wavespeed-reference')
      expect(
        applyUpload(older, {
          image: 'older-asset',
        }),
      ).toEqual({
        reference_image: 'older-asset',
      })
    } finally {
      clearSettingsMediaAssetUpload(older)
    }
  })

  it('preserves unrelated config fields while updating only intended image fields', () => {
    const config = {
      width: 832,
      height: 1216,
      sampler: 'k_euler',
      image: 'old-image',
      base64image: 'old-base64',
      character_image: 'untouched-character-reference',
    }
    const operation = beginUpload({
      targetId: 'nai-i2i-base',
      config,
    })

    try {
      const result = applyUpload(operation, {
        config,
        image: 'fresh-image',
      })

      expect(result).toEqual({
        width: 832,
        height: 1216,
        sampler: 'k_euler',
        image: 'fresh-image',
        character_image: 'untouched-character-reference',
      })
      expect(result).not.toBe(config)
      expect(JSON.stringify({ ...result, width: 1024 })).not.toContain('old-base64')
    } finally {
      clearSettingsMediaAssetUpload(operation)
    }
  })

  it.each([
    ['nai-character-reference', 'character_image', 'character_base64image'],
    ['nai-i2i-base', 'image', 'base64image'],
    ['wavespeed-reference', 'reference_image', 'reference_base64image'],
  ] as const)('stores only the durable asset reference for %s uploads', (targetId, imageKey, base64Key) => {
    const operation = beginUpload({
      targetId,
      config: {
        [imageKey]: 'old-asset',
        [base64Key]: 'duplicated-image-bytes',
        sibling: 'preserved',
      },
    })

    try {
      const result = applyUpload(operation, {
        config: {
          [imageKey]: 'old-asset',
          [base64Key]: 'duplicated-image-bytes',
          sibling: 'preserved',
        },
        image: 'new-asset',
      })

      expect(result).toEqual({
        [imageKey]: 'new-asset',
        sibling: 'preserved',
      })
      expect(result).not.toHaveProperty(base64Key)
    } finally {
      clearSettingsMediaAssetUpload(operation)
    }
  })
})
