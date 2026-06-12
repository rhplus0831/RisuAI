// AEC2 fixture: block export emits every current resource family, and
// BLOCK_RESOURCE_KEYS is the single source of truth for the reserved root keys.
export const BLOCK_RESOURCE_KEYS = ['characters', 'botPresets', 'modules', 'loadouts', 'plugins', 'pluginCustomStorage']

export function exportBlockDatabase(database: Record<string, unknown>): Record<string, unknown> {
  return {
    'database.characters': database.characters,
    'database.botPresets': database.botPresets,
    'database.modules': database.modules,
    'database.loadouts': database.loadouts,
    'database.plugins': database.plugins,
    'database.pluginCustomStorage': database.pluginCustomStorage,
  }
}
