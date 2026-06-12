// AEC2 fixture: import normalization keeps every accepted import block-
// exportable, and ROOT_COMPONENT import rejects reserved resource-family keys
// before assigning them as root components.
// Anti-pattern: ROOT_COMPONENT_RESERVED_KEYS has drifted from the block export
// resource keys ('plugins' is missing), so a root component named 'plugins'
// could overwrite the plugins resource block on import.
export const ROOT_COMPONENT_RESERVED_KEYS = new Set([
  'characters',
  'botPresets',
  'modules',
  'loadouts',
  'pluginCustomStorage',
])

export function normalizeImportDatabase(target: Record<string, unknown>): Record<string, unknown> {
  normalizeCharacterCollection(target)
  normalizePresetCollection(target)
  ensureModuleRecords(target)
  normalizeLoadoutCollection(target)
  ensurePluginRecords(target)
  ensurePluginCustomStorage(target)
  return target
}

export function assembleBlockDatabase(components: { key: string; value: unknown }[]): Record<string, unknown> {
  const database: Record<string, unknown> = {}
  for (const component of components) {
    if (ROOT_COMPONENT_RESERVED_KEYS.has(component.key)) {
      throw new Error(`Root component key ${component.key} is reserved for resource blocks`)
    }
    database[component.key] = component.value
  }
  return database
}

function normalizeCharacterCollection(_target: Record<string, unknown>): void {}
function normalizePresetCollection(_target: Record<string, unknown>): void {}
function ensureModuleRecords(_target: Record<string, unknown>): void {}
function normalizeLoadoutCollection(_target: Record<string, unknown>): void {}
function ensurePluginRecords(_target: Record<string, unknown>): void {}
function ensurePluginCustomStorage(_target: Record<string, unknown>): void {}
