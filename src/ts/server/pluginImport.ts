import { createLatestOperationGuard, type LatestOperationToken } from './staleStateGuards'

const PLUGIN_IMPORT_TARGET = 'pluginImport' as const

export interface PluginImportPluginLike {
  readonly name: string
  readonly script?: string
  readonly updateURL?: string
  readonly versionOfPlugin?: string
  readonly version?: number | string
  readonly enabled?: boolean
  readonly allowedIPC?: readonly string[]
}

export interface PluginImportFreshness<TPlugin extends PluginImportPluginLike = PluginImportPluginLike> {
  readonly plugins: readonly TPlugin[] | null | undefined
}

export interface PluginImportTarget {
  readonly pluginListSnapshot: string
}

export interface PluginImportOperation extends PluginImportTarget {
  readonly token: LatestOperationToken<typeof PLUGIN_IMPORT_TARGET>
}

export type PluginImportApplyTarget =
  | {
      readonly kind: 'update'
      readonly index: number
      readonly pluginId: string
    }
  | {
      readonly kind: 'create'
      readonly index: number
    }
  | {
      readonly kind: 'skip'
    }
  | {
      readonly kind: 'name-mismatch'
      readonly originalPluginName: string
      readonly pluginName: string
    }

const pluginImportGuard = createLatestOperationGuard<typeof PLUGIN_IMPORT_TARGET>()

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function pluginList<TPlugin extends PluginImportPluginLike>(
  freshness: PluginImportFreshness<TPlugin>,
): readonly TPlugin[] {
  return freshness.plugins ?? []
}

function pluginImportIdentityList<TPlugin extends PluginImportPluginLike>(
  freshness: PluginImportFreshness<TPlugin>,
): readonly unknown[] {
  return pluginList(freshness).map((plugin) => [
    plugin.name,
    plugin.script ?? null,
    plugin.updateURL ?? null,
    plugin.versionOfPlugin ?? null,
    plugin.version ?? null,
    plugin.enabled ?? null,
    plugin.allowedIPC ?? null,
  ])
}

export function capturePluginImportTarget<TPlugin extends PluginImportPluginLike>(
  freshness: PluginImportFreshness<TPlugin>,
): PluginImportTarget {
  return {
    // Argument values and presentation fields can change while an import is
    // awaiting permission or network I/O without changing its apply target.
    pluginListSnapshot: snapshotJson(pluginImportIdentityList(freshness)),
  }
}

export function beginPluginImport(target: PluginImportTarget): PluginImportOperation {
  return {
    ...target,
    token: pluginImportGuard.issue(PLUGIN_IMPORT_TARGET),
  }
}

export function clearPluginImport(operation: PluginImportOperation): void {
  pluginImportGuard.clear(operation.token)
}

export function isFreshPluginImport<TPlugin extends PluginImportPluginLike>(
  operation: PluginImportOperation,
  freshness: PluginImportFreshness<TPlugin>,
): boolean {
  if (!pluginImportGuard.isLatest(operation.token)) return false
  return snapshotJson(pluginImportIdentityList(freshness)) === operation.pluginListSnapshot
}

export function resolveFreshPluginImportApplyTarget<TPlugin extends PluginImportPluginLike>(input: {
  readonly operation: PluginImportOperation
  readonly freshness: PluginImportFreshness<TPlugin>
  readonly plugin: PluginImportPluginLike
  readonly isUpdate?: boolean
  readonly originalPluginName?: string
  readonly isHotReload?: boolean
}): PluginImportApplyTarget | null {
  if (!isFreshPluginImport(input.operation, input.freshness)) return null

  const pluginName = input.plugin.name
  const originalPluginName = input.originalPluginName ?? ''
  if (originalPluginName && originalPluginName !== pluginName) {
    return {
      kind: 'name-mismatch',
      originalPluginName,
      pluginName,
    }
  }

  const plugins = pluginList(input.freshness)
  const index = plugins.findIndex((plugin) => plugin.name === pluginName)
  if (index !== -1) {
    return {
      kind: 'update',
      index,
      pluginId: pluginName,
    }
  }

  if (!input.isUpdate || input.isHotReload) {
    return {
      kind: 'create',
      index: plugins.length,
    }
  }

  return {
    kind: 'skip',
  }
}
