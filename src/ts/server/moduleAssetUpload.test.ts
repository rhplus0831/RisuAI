import { describe, expect, it } from 'vitest'

import {
  appendFreshModuleAssets,
  beginModuleAssetUpload,
  captureModuleAssetUploadTarget,
  clearModuleAssetUpload,
  type ModuleAssetEntry,
  type ModuleAssetUploadOperation,
} from './moduleAssetUpload'

const asset = (name: string, path = `asset-${name}`, extension = 'png'): ModuleAssetEntry => [name, path, extension]

function beginUpload(input: { moduleId?: string; assets?: ModuleAssetEntry[] }): ModuleAssetUploadOperation {
  const target = captureModuleAssetUploadTarget({
    moduleId: input.moduleId ?? 'module-a',
    assets: input.assets ?? [],
  })

  if (!target) {
    throw new Error('expected upload target')
  }

  return beginModuleAssetUpload(target)
}

describe('module asset upload freshness', () => {
  it('rejects completion after module switch or asset-list edit', () => {
    const baseAssets = [asset('base')]
    const switchedModuleUpload = beginUpload({
      moduleId: 'module-switch',
      assets: baseAssets,
    })
    const editedListUpload = beginUpload({
      moduleId: 'module-edit',
      assets: baseAssets,
    })

    try {
      expect(
        appendFreshModuleAssets({
          operation: switchedModuleUpload,
          freshness: {
            currentModuleId: 'module-b',
            assets: baseAssets,
          },
          entries: [asset('late')],
        }),
      ).toBeNull()

      expect(
        appendFreshModuleAssets({
          operation: editedListUpload,
          freshness: {
            currentModuleId: 'module-edit',
            assets: [...baseAssets, asset('newer-local-edit')],
          },
          entries: [asset('late')],
        }),
      ).toBeNull()
    } finally {
      clearModuleAssetUpload(switchedModuleUpload)
      clearModuleAssetUpload(editedListUpload)
    }
  })

  it('lets the newer upload for the same module win over an older delayed upload', () => {
    const older = beginUpload({ moduleId: 'module-a', assets: [] })
    const newer = beginUpload({ moduleId: 'module-a', assets: [] })

    try {
      const newerResult = appendFreshModuleAssets({
        operation: newer,
        freshness: {
          currentModuleId: 'module-a',
          assets: [],
        },
        entries: [asset('newer')],
      })

      expect(newerResult).toEqual([asset('newer')])

      const olderResult = appendFreshModuleAssets({
        operation: older,
        freshness: {
          currentModuleId: 'module-a',
          assets: [],
        },
        entries: [asset('older')],
      })

      expect(olderResult).toBeNull()
    } finally {
      clearModuleAssetUpload(older)
      clearModuleAssetUpload(newer)
    }
  })

  it('does not let a canceled newer picker invalidate an older pending upload', () => {
    const baseAssets = [asset('base')]
    const older = beginUpload({ moduleId: 'module-a', assets: baseAssets })

    const canceledTarget = captureModuleAssetUploadTarget({
      moduleId: 'module-a',
      assets: baseAssets,
    })

    try {
      expect(canceledTarget).not.toBeNull()
      const result = appendFreshModuleAssets({
        operation: older,
        freshness: {
          currentModuleId: 'module-a',
          assets: baseAssets,
        },
        entries: [asset('older')],
      })

      expect(result).toEqual([...baseAssets, asset('older')])
    } finally {
      clearModuleAssetUpload(older)
    }
  })

  it('appends only when the module and asset snapshot still match', () => {
    const baseAssets = [asset('base')]
    const operation = beginUpload({ moduleId: 'module-a', assets: baseAssets })

    try {
      expect(
        appendFreshModuleAssets({
          operation,
          freshness: {
            currentModuleId: 'module-a',
            assets: baseAssets,
          },
          entries: [asset('fresh')],
        }),
      ).toEqual([...baseAssets, asset('fresh')])
    } finally {
      clearModuleAssetUpload(operation)
    }
  })
})
