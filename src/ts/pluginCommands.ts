import type { RisuPlugin } from './plugins/plugins.svelte'
import {
  canUseServerCommands,
  createPluginCommand,
  deletePluginCommand,
  enablePluginCommand,
  reorderPluginsCommand,
  runServerCommand,
  selectPluginProviderCommand,
  updatePluginCommand,
  type PluginSnapshot,
  type ServerCommandResult,
} from './server/commands'
import { DBState } from './stores.svelte'

export interface PluginStateSnapshot {
  plugins: RisuPlugin[]
  currentPluginProvider: string
}

const PLUGIN_PATCH_EXCLUDED_KEYS = new Set(['name'])
let pluginWatchSuppressionVersion = 0

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function currentPluginStateSnapshot(): PluginStateSnapshot {
  return {
    plugins: cloneJsonValue(DBState.db.plugins ?? []),
    currentPluginProvider: DBState.db.currentPluginProvider ?? '',
  }
}

export function restorePluginState(snapshot: PluginStateSnapshot): void {
  pluginWatchSuppressionVersion += 1
  DBState.db.plugins = cloneJsonValue(snapshot.plugins)
  DBState.db.currentPluginProvider = snapshot.currentPluginProvider
}

export function currentPluginWatchSuppressionVersion(): number {
  return pluginWatchSuppressionVersion
}

export function runPluginCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback })
}

export function dispatchCreatePlugin(plugin: RisuPlugin, previous: PluginStateSnapshot): void {
  runPluginCommand(
    (baseRevision) =>
      createPluginCommand({
        baseRevision,
        plugin: toPluginSnapshot(plugin),
      }),
    () => restorePluginState(previous),
  )
}

export function dispatchUpdatePlugin(
  pluginId: string,
  patch: PluginSnapshot,
  previous: PluginStateSnapshot,
): void {
  const commandPatch = sanitizePluginPatch(patch)
  if (Object.keys(commandPatch).length === 0) return
  runPluginCommand(
    (baseRevision) =>
      updatePluginCommand({
        baseRevision,
        pluginId,
        patch: commandPatch,
      }),
    () => restorePluginState(previous),
  )
}

export function dispatchDeletePlugin(pluginId: string, previous: PluginStateSnapshot): void {
  runPluginCommand(
    (baseRevision) =>
      deletePluginCommand({
        baseRevision,
        pluginId,
      }),
    () => restorePluginState(previous),
  )
}

export function dispatchEnablePlugin(
  pluginId: string,
  enabled: boolean,
  previous: PluginStateSnapshot,
): void {
  runPluginCommand(
    (baseRevision) =>
      enablePluginCommand({
        baseRevision,
        pluginId,
        enabled,
      }),
    () => restorePluginState(previous),
  )
}

export function dispatchSelectPluginProvider(
  provider: string,
  previous: PluginStateSnapshot,
): void {
  runPluginCommand(
    (baseRevision) =>
      selectPluginProviderCommand({
        baseRevision,
        provider,
      }),
    () => restorePluginState(previous),
  )
}

export function dispatchReorderPlugins(previous: PluginStateSnapshot): void {
  runPluginCommand(
    (baseRevision) =>
      reorderPluginsCommand({
        baseRevision,
        pluginIds: (DBState.db.plugins ?? []).map((plugin) => plugin.name),
      }),
    () => restorePluginState(previous),
  )
}

export function toPluginSnapshot(plugin: RisuPlugin): PluginSnapshot {
  return cloneJsonValue(plugin) as PluginSnapshot
}

export function sanitizePluginPatch(patch: PluginSnapshot): PluginSnapshot {
  const sanitized: PluginSnapshot = {}
  for (const [key, value] of Object.entries(patch)) {
    if (PLUGIN_PATCH_EXCLUDED_KEYS.has(key) || value === undefined) continue
    sanitized[key] = value
  }
  return sanitized
}
