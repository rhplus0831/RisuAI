import { describe, expect, it } from 'vitest'

import type { SeparateParameters } from '../storage/database.svelte'
import {
  beginSeperateParametersImport,
  captureSeperateParametersImportTarget,
  clearSeperateParametersImport,
  parseSeperateParametersImport,
  resolveFreshSeperateParametersImportValue,
  type SeperateParametersImportFreshness,
  type SeperateParametersImportOperation,
  type SeperateParametersImportSlotKind,
} from './seperateParametersImport'

const originalParameters: SeparateParameters = {
  temperature: 0.7,
  top_p: 0.9,
}
const importedParameters: SeparateParameters = {
  temperature: 1.1,
  top_k: 42,
}

function freshness(input?: {
  slotKind?: SeperateParametersImportSlotKind
  targetKey?: string | null
  selectedOptionIsParameters?: boolean
  byModel?: boolean
  activeSelector?: string | null
  targetSlot?: SeparateParameters | null
}): SeperateParametersImportFreshness {
  const slotKind = input?.slotKind ?? 'base'
  const targetKey = input?.targetKey ?? (slotKind === 'base' ? 'memory' : 'model-a')

  return {
    slotKind,
    targetKey,
    selectedOptionIsParameters: input?.selectedOptionIsParameters ?? true,
    byModel: input?.byModel ?? slotKind === 'override',
    activeSelector: input?.activeSelector ?? targetKey,
    targetSlot: Object.hasOwn(input ?? {}, 'targetSlot') ? input?.targetSlot : originalParameters,
  }
}

function beginImport(input?: {
  slotKind?: SeperateParametersImportSlotKind
  targetKey?: string | null
  selectedOptionIsParameters?: boolean
  byModel?: boolean
  activeSelector?: string | null
  targetSlot?: SeparateParameters | null
}): SeperateParametersImportOperation {
  const target = captureSeperateParametersImportTarget(freshness(input))
  if (!target) {
    throw new Error('expected seperate parameters import target')
  }
  return beginSeperateParametersImport(target)
}

function resolveImport(
  operation: SeperateParametersImportOperation,
  input?: {
    slotKind?: SeperateParametersImportSlotKind
    targetKey?: string | null
    selectedOptionIsParameters?: boolean
    byModel?: boolean
    activeSelector?: string | null
    targetSlot?: SeparateParameters | null
    imported?: SeparateParameters
  },
): SeparateParameters | null {
  return resolveFreshSeperateParametersImportValue({
    operation,
    freshness: freshness(input),
    imported: input?.imported ?? importedParameters,
  })
}

describe('seperate parameters import freshness', () => {
  it('resolves a fresh base import value', () => {
    const operation = beginImport({
      slotKind: 'base',
      targetKey: 'memory',
      byModel: false,
      activeSelector: 'memory',
      targetSlot: originalParameters,
    })

    try {
      expect(resolveImport(operation)).toEqual(importedParameters)
    } finally {
      clearSeperateParametersImport(operation)
    }
  })

  it('rejects stale completion after the base selector changes', () => {
    const operation = beginImport({
      slotKind: 'base',
      targetKey: 'memory',
      byModel: false,
      activeSelector: 'memory',
      targetSlot: originalParameters,
    })

    try {
      expect(
        resolveImport(operation, {
          slotKind: 'base',
          targetKey: 'memory',
          byModel: false,
          activeSelector: 'translate',
          targetSlot: originalParameters,
        }),
      ).toBeNull()
    } finally {
      clearSeperateParametersImport(operation)
    }
  })

  it('rejects stale completion after the by-model toggle changes', () => {
    const operation = beginImport({
      slotKind: 'base',
      targetKey: 'memory',
      byModel: false,
      activeSelector: 'memory',
      targetSlot: originalParameters,
    })

    try {
      expect(
        resolveImport(operation, {
          slotKind: 'base',
          targetKey: 'memory',
          byModel: true,
          activeSelector: 'memory',
          targetSlot: originalParameters,
        }),
      ).toBeNull()
    } finally {
      clearSeperateParametersImport(operation)
    }
  })

  it('rejects stale completion after override model selection changes', () => {
    const operation = beginImport({
      slotKind: 'override',
      targetKey: 'model-a',
      byModel: true,
      activeSelector: 'model-a',
      targetSlot: originalParameters,
    })

    try {
      expect(
        resolveImport(operation, {
          slotKind: 'override',
          targetKey: 'model-b',
          byModel: true,
          activeSelector: 'model-b',
          targetSlot: originalParameters,
        }),
      ).toBeNull()
    } finally {
      clearSeperateParametersImport(operation)
    }
  })

  it('rejects stale completion after the target slot is edited or deleted', () => {
    const edited = beginImport({
      slotKind: 'base',
      targetKey: 'memory',
      byModel: false,
      activeSelector: 'memory',
      targetSlot: originalParameters,
    })

    try {
      expect(
        resolveImport(edited, {
          slotKind: 'base',
          targetKey: 'memory',
          byModel: false,
          activeSelector: 'memory',
          targetSlot: { ...originalParameters, top_p: 0.5 },
        }),
      ).toBeNull()
    } finally {
      clearSeperateParametersImport(edited)
    }

    const deleted = beginImport({
      slotKind: 'override',
      targetKey: 'model-a',
      byModel: true,
      activeSelector: 'model-a',
      targetSlot: originalParameters,
    })

    try {
      expect(
        resolveImport(deleted, {
          slotKind: 'override',
          targetKey: 'model-a',
          byModel: true,
          activeSelector: 'model-a',
          targetSlot: undefined,
        }),
      ).toBeNull()
    } finally {
      clearSeperateParametersImport(deleted)
    }
  })

  it('lets the newer selected import win over an older delayed import', () => {
    const older = beginImport()
    const newer = beginImport()

    try {
      expect(resolveImport(newer)).toEqual(importedParameters)
      expect(resolveImport(older)).toBeNull()
    } finally {
      clearSeperateParametersImport(older)
      clearSeperateParametersImport(newer)
    }
  })

  it('does not let a canceled newer picker invalidate an older pending import', () => {
    const older = beginImport()
    const canceledTarget = captureSeperateParametersImportTarget(freshness())

    try {
      expect(canceledTarget).not.toBeNull()
      expect(resolveImport(older)).toEqual(importedParameters)
    } finally {
      clearSeperateParametersImport(older)
    }
  })

  it('parses only JSON objects without producing a value for invalid input', () => {
    expect(parseSeperateParametersImport(JSON.stringify(importedParameters))).toEqual(importedParameters)
    expect(parseSeperateParametersImport('{')).toBeNull()
    expect(parseSeperateParametersImport('null')).toBeNull()
    expect(parseSeperateParametersImport('[]')).toBeNull()
    expect(parseSeperateParametersImport('1')).toBeNull()
    expect(parseSeperateParametersImport('"value"')).toBeNull()
  })
})
