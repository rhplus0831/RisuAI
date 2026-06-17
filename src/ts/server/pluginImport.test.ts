import { describe, expect, it } from 'vitest'

import {
  beginPluginImport,
  capturePluginImportTarget,
  clearPluginImport,
  resolveFreshPluginImportApplyTarget,
  type PluginImportOperation,
} from './pluginImport'

type PluginRow = {
  name: string
  script: string
}

function plugin(name: string, script = `Risuai.log("${name}")`): PluginRow {
  return {
    name,
    script,
  }
}

function beginImport(plugins: PluginRow[]): PluginImportOperation {
  return beginPluginImport(capturePluginImportTarget({ plugins }))
}

describe('plugin import freshness', () => {
  it('rejects stale completion after the plugin list snapshot changes', () => {
    const operation = beginImport([plugin('plugin-a')])

    try {
      expect(
        resolveFreshPluginImportApplyTarget({
          operation,
          freshness: { plugins: [plugin('plugin-a'), plugin('plugin-b')] },
          plugin: plugin('plugin-c'),
        }),
      ).toBeNull()
    } finally {
      clearPluginImport(operation)
    }
  })

  it('lets a newer plugin import or update operation win', () => {
    const plugins = [plugin('plugin-a')]
    const older = beginImport(plugins)
    const newer = beginImport(plugins)

    try {
      expect(
        resolveFreshPluginImportApplyTarget({
          operation: older,
          freshness: { plugins },
          plugin: plugin('plugin-b'),
        }),
      ).toBeNull()

      expect(
        resolveFreshPluginImportApplyTarget({
          operation: newer,
          freshness: { plugins },
          plugin: plugin('plugin-b'),
        }),
      ).toEqual({
        kind: 'create',
        index: 1,
      })
    } finally {
      clearPluginImport(older)
      clearPluginImport(newer)
    }
  })

  it('does not let clearing an old operation clear a newer operation', () => {
    const plugins = [plugin('plugin-a')]
    const older = beginImport(plugins)
    const newer = beginImport(plugins)

    clearPluginImport(older)

    try {
      expect(
        resolveFreshPluginImportApplyTarget({
          operation: newer,
          freshness: { plugins },
          plugin: plugin('plugin-a', 'updated'),
          isUpdate: true,
          originalPluginName: 'plugin-a',
        }),
      ).toEqual({
        kind: 'update',
        index: 0,
        pluginId: 'plugin-a',
      })
    } finally {
      clearPluginImport(newer)
    }
  })

  it('resolves fresh unchanged snapshots to update, create, and validation shapes', () => {
    const plugins = [plugin('plugin-a'), plugin('plugin-b')]
    const updateOperation = beginImport(plugins)

    try {
      expect(
        resolveFreshPluginImportApplyTarget({
          operation: updateOperation,
          freshness: { plugins },
          plugin: plugin('plugin-b', 'updated'),
          isUpdate: true,
          originalPluginName: 'plugin-b',
        }),
      ).toEqual({
        kind: 'update',
        index: 1,
        pluginId: 'plugin-b',
      })
    } finally {
      clearPluginImport(updateOperation)
    }

    const createOperation = beginImport(plugins)
    try {
      expect(
        resolveFreshPluginImportApplyTarget({
          operation: createOperation,
          freshness: { plugins },
          plugin: plugin('plugin-c'),
        }),
      ).toEqual({
        kind: 'create',
        index: 2,
      })
    } finally {
      clearPluginImport(createOperation)
    }

    const mismatchOperation = beginImport(plugins)
    try {
      expect(
        resolveFreshPluginImportApplyTarget({
          operation: mismatchOperation,
          freshness: { plugins },
          plugin: plugin('plugin-c'),
          isUpdate: true,
          originalPluginName: 'plugin-b',
        }),
      ).toEqual({
        kind: 'name-mismatch',
        originalPluginName: 'plugin-b',
        pluginName: 'plugin-c',
      })
    } finally {
      clearPluginImport(mismatchOperation)
    }
  })
})
