import { describe, expect, it } from 'vitest'

import {
  beginNaiVibeImport,
  captureNaiVibeImportTarget,
  clearNaiVibeImport,
  parseNaiVibeImport,
  resolveFreshNaiVibeImportPatch,
  type NaiVibeData,
  type NaiVibeImportConfig,
  type NaiVibeImportFreshness,
  type NaiVibeImportOperation,
} from './naiVibeImport'

const originalVibe = {
  identifier: 'novelai-vibe-transfer',
  version: 1,
  thumbnail: 'data:image/png;base64,old',
  encodings: {
    v4full: {
      old: {
        encoding: 'old-encoding',
        params: {
          information_extracted: 1,
        },
      },
    },
  },
} satisfies NaiVibeData

const importedVibe = {
  identifier: 'novelai-vibe-transfer',
  version: 1,
  thumbnail: 'data:image/png;base64,new',
  encodings: {
    'v4-5full': {
      first: {
        encoding: 'new-encoding',
        params: {
          information_extracted: 2,
        },
      },
    },
  },
} satisfies NaiVibeData

const baseConfig: NaiVibeImportConfig = {
  width: 832,
  height: 1216,
  sampler: 'k_euler',
  vibe_data: originalVibe,
  reference_image_multiple: ['old-reference'],
  vibe_model_selection: 'v4full',
  InfoExtracted: 1,
  reference_strength_multiple: [0.35],
}

function freshness(input?: {
  provider?: unknown
  model?: unknown
  reference_mode?: unknown
  config?: NaiVibeImportConfig | null
}): NaiVibeImportFreshness {
  return {
    provider: input?.provider ?? 'novelai',
    model: input?.model ?? 'nai-diffusion-4-5-full',
    reference_mode: input?.reference_mode ?? 'vibe',
    config: Object.hasOwn(input ?? {}, 'config') ? input?.config : baseConfig,
  }
}

function beginImport(input?: {
  provider?: unknown
  model?: unknown
  reference_mode?: unknown
  config?: NaiVibeImportConfig | null
}): NaiVibeImportOperation {
  return beginNaiVibeImport(captureNaiVibeImportTarget(freshness(input)))
}

function resolveImport(
  operation: NaiVibeImportOperation,
  input?: {
    provider?: unknown
    model?: unknown
    reference_mode?: unknown
    config?: NaiVibeImportConfig | null
    vibeData?: NaiVibeData
  },
) {
  return resolveFreshNaiVibeImportPatch({
    operation,
    freshness: freshness(input),
    vibeData: input?.vibeData ?? importedVibe,
  })
}

describe('NovelAI vibe import freshness', () => {
  it('produces a narrow patch for a fresh valid import', () => {
    const operation = beginImport()

    try {
      expect(resolveImport(operation)).toEqual({
        vibe_data: importedVibe,
        reference_image_multiple: [],
        vibe_model_selection: 'v4-5full',
        InfoExtracted: 2,
      })
    } finally {
      clearNaiVibeImport(operation)
    }
  })

  it('initializes reference strength only when the live value is not an array', () => {
    const config = {
      ...baseConfig,
      reference_strength_multiple: undefined,
    }
    const operation = beginImport({ config })

    try {
      expect(resolveImport(operation, { config })).toEqual({
        vibe_data: importedVibe,
        reference_image_multiple: [],
        vibe_model_selection: 'v4-5full',
        InfoExtracted: 2,
        reference_strength_multiple: [0.7],
      })
    } finally {
      clearNaiVibeImport(operation)
    }
  })

  it('parses valid files and returns null for invalid JSON, version, or identifier', () => {
    expect(parseNaiVibeImport(JSON.stringify(importedVibe))).toEqual(importedVibe)
    expect(parseNaiVibeImport('{')).toBeNull()
    expect(parseNaiVibeImport(JSON.stringify({ ...importedVibe, version: 2 }))).toBeNull()
    expect(parseNaiVibeImport(JSON.stringify({ ...importedVibe, identifier: 'other' }))).toBeNull()
  })

  it('rejects stale completion after provider, model, or reference mode changes', () => {
    const providerOperation = beginImport()

    try {
      expect(resolveImport(providerOperation, { provider: 'webui' })).toBeNull()
    } finally {
      clearNaiVibeImport(providerOperation)
    }

    const modelOperation = beginImport()

    try {
      expect(resolveImport(modelOperation, { model: 'nai-diffusion-4-curated' })).toBeNull()
    } finally {
      clearNaiVibeImport(modelOperation)
    }

    const referenceModeOperation = beginImport()

    try {
      expect(resolveImport(referenceModeOperation, { reference_mode: 'character' })).toBeNull()
    } finally {
      clearNaiVibeImport(referenceModeOperation)
    }
  })

  it('rejects stale completion after manual edits or deletes to vibe fields', () => {
    const edited = beginImport()

    try {
      expect(
        resolveImport(edited, {
          config: {
            ...baseConfig,
            vibe_model_selection: 'v4curated',
          },
        }),
      ).toBeNull()
    } finally {
      clearNaiVibeImport(edited)
    }

    const deleted = beginImport()
    const { vibe_data: _deletedVibeData, ...configWithoutVibeData } = baseConfig

    try {
      expect(
        resolveImport(deleted, {
          config: configWithoutVibeData,
        }),
      ).toBeNull()
    } finally {
      clearNaiVibeImport(deleted)
    }
  })

  it('lets the newer selected import win over an older delayed import', () => {
    const older = beginImport()
    const newer = beginImport()

    try {
      expect(resolveImport(newer)).toEqual({
        vibe_data: importedVibe,
        reference_image_multiple: [],
        vibe_model_selection: 'v4-5full',
        InfoExtracted: 2,
      })
      expect(resolveImport(older)).toBeNull()
    } finally {
      clearNaiVibeImport(older)
      clearNaiVibeImport(newer)
    }
  })

  it('does not let a canceled newer picker invalidate an older pending import', () => {
    const older = beginImport()
    const canceledTarget = captureNaiVibeImportTarget(freshness())

    try {
      expect(canceledTarget.model).toBe('nai-diffusion-4-5-full')
      expect(resolveImport(older)).toEqual({
        vibe_data: importedVibe,
        reference_image_multiple: [],
        vibe_model_selection: 'v4-5full',
        InfoExtracted: 2,
      })
    } finally {
      clearNaiVibeImport(older)
    }
  })
})
