// AEC5 fixture: normal module-link validation excludes MCP module rows from the
// set of linkable command ids and rejects unresolved module ids.
interface ModuleRecord {
  id: string
  mcp?: boolean
}

export function validateNormalModuleLinks(modules: ModuleRecord[], moduleIds: string[], label: string): void {
  const linkable = new Set(modules.filter((module) => !module.mcp).map((module) => module.id))
  for (const id of moduleIds) {
    if (!linkable.has(id)) {
      throw new Error(`Unknown module id in ${label}: ${id}`)
    }
  }
}
