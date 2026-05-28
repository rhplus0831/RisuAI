// AEC5 fixture: normal module-link validation excludes MCP module rows from the
// set of linkable command ids and rejects unresolved module ids.
interface ModuleRecord {
  id: string
  mcp?: boolean
}

export function validateNormalModuleLinks(
  modules: ModuleRecord[],
  moduleIds: string[],
  label: string,
): void {
  // Anti-pattern: MCP module rows are treated as normal link targets because the
  // linkable set is not filtered by module type.
  const linkable = new Set(modules.map((module) => module.id))
  for (const id of moduleIds) {
    if (!linkable.has(id)) {
      throw new Error(`Unknown module id in ${label}: ${id}`)
    }
  }
}
