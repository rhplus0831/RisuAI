import { describe, expect, it } from 'vitest'

import {
  beginBiasImport,
  captureBiasImportTarget,
  clearBiasImport,
  parseBiasImport,
  resolveFreshBiasImportValue,
  type BiasImportOperation,
  type BiasImportValue,
} from './biasImport'

const originalBias: BiasImportValue = [['old', 1]]
const importedBias: BiasImportValue = [['new', 2]]

function beginImport(input?: { selectedPromptPresetId?: string | null; bias?: BiasImportValue }): BiasImportOperation {
  const target = captureBiasImportTarget({
    selectedPromptPresetId: input?.selectedPromptPresetId ?? 'preset-a',
    bias: input?.bias ?? originalBias,
  })

  if (!target) {
    throw new Error('expected bias import target')
  }

  return beginBiasImport(target)
}

function resolveImport(
  operation: BiasImportOperation,
  freshness?: Partial<{
    selectedPromptPresetId: string | null
    bias: BiasImportValue
  }>,
): BiasImportValue | null {
  return resolveFreshBiasImportValue({
    operation,
    freshness: {
      selectedPromptPresetId: freshness?.selectedPromptPresetId ?? operation.selectedPromptPresetId,
      bias: Object.hasOwn(freshness ?? {}, 'bias') ? freshness?.bias : originalBias,
    },
    bias: importedBias,
  })
}

describe('bias import freshness', () => {
  it('resolves a fresh bias import value', () => {
    const operation = beginImport({
      selectedPromptPresetId: 'preset-a',
      bias: originalBias,
    })

    try {
      expect(resolveImport(operation)).toEqual(importedBias)
    } finally {
      clearBiasImport(operation)
    }
  })

  it('rejects stale completion after selected prompt preset changes', () => {
    const operation = beginImport({
      selectedPromptPresetId: 'preset-a',
      bias: originalBias,
    })

    try {
      expect(
        resolveImport(operation, {
          selectedPromptPresetId: 'preset-b',
          bias: originalBias,
        }),
      ).toBeNull()
    } finally {
      clearBiasImport(operation)
    }
  })

  it('rejects stale completion after a manual bias edit changes the snapshot', () => {
    const operation = beginImport({
      selectedPromptPresetId: 'preset-a',
      bias: originalBias,
    })

    try {
      expect(
        resolveImport(operation, {
          selectedPromptPresetId: 'preset-a',
          bias: [['manual edit', 3]],
        }),
      ).toBeNull()
    } finally {
      clearBiasImport(operation)
    }
  })

  it('lets the newer selected import win over an older delayed import', () => {
    const older = beginImport({
      selectedPromptPresetId: 'preset-a',
      bias: originalBias,
    })
    const newer = beginImport({
      selectedPromptPresetId: 'preset-a',
      bias: originalBias,
    })

    try {
      expect(resolveImport(newer)).toEqual(importedBias)
      expect(resolveImport(older)).toBeNull()
    } finally {
      clearBiasImport(older)
      clearBiasImport(newer)
    }
  })

  it('does not let a canceled newer picker invalidate an older pending import', () => {
    const older = beginImport({
      selectedPromptPresetId: 'preset-a',
      bias: originalBias,
    })
    const canceledTarget = captureBiasImportTarget({
      selectedPromptPresetId: 'preset-a',
      bias: originalBias,
    })

    try {
      expect(canceledTarget).not.toBeNull()
      expect(resolveImport(older)).toEqual(importedBias)
    } finally {
      clearBiasImport(older)
    }
  })

  it('parses only JSON arrays without producing a value for invalid input', () => {
    expect(parseBiasImport(JSON.stringify(importedBias))).toEqual(importedBias)
    expect(parseBiasImport(JSON.stringify({ bias: importedBias }))).toBeNull()
    expect(parseBiasImport('{')).toBeNull()
  })
})
