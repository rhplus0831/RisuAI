import type { ModuleFolder, RisuModule } from './process/modules'

export interface ModuleOrganizationGroup {
  folder: ModuleFolder | null
  modules: RisuModule[]
}

export interface GroupModulesByFolderOptions {
  search?: string
  omitEmptyMatches?: boolean
}

export function normalizeModuleOrganizationSearch(value: string): string {
  return value.trim().toLocaleLowerCase()
}

/** Build the folder view without changing either persisted order. */
export function groupModulesByFolder(
  folders: readonly ModuleFolder[],
  modules: readonly RisuModule[],
  options: GroupModulesByFolderOptions = {},
): ModuleOrganizationGroup[] {
  const search = normalizeModuleOrganizationSearch(options.search ?? '')
  const folderIds = new Set(folders.map((folder) => folder.id))
  const modulesByFolder = new Map<string, RisuModule[]>(folders.map((folder) => [folder.id, []]))
  const uncategorized: RisuModule[] = []

  for (const module of modules) {
    if (
      search &&
      !module.name.toLocaleLowerCase().includes(search) &&
      !(module.description ?? '').toLocaleLowerCase().includes(search)
    ) {
      continue
    }
    if (module.folderId && folderIds.has(module.folderId)) modulesByFolder.get(module.folderId)!.push(module)
    else uncategorized.push(module)
  }

  const groups: ModuleOrganizationGroup[] = folders.map((folder) => ({
    folder,
    modules: modulesByFolder.get(folder.id) ?? [],
  }))
  groups.push({ folder: null, modules: uncategorized })
  return options.omitEmptyMatches && search ? groups.filter((group) => group.modules.length > 0) : groups
}

export function flattenModuleOrganizationGroups(groups: readonly ModuleOrganizationGroup[]): RisuModule[] {
  return groups.flatMap((group) => group.modules)
}

export function moveModuleToFolder(
  folders: readonly ModuleFolder[],
  modules: readonly RisuModule[],
  moduleId: string,
  destinationFolderId: string | null,
  destinationIndex?: number,
): RisuModule[] {
  const knownFolderIds = new Set(folders.map((folder) => folder.id))
  if (destinationFolderId !== null && !knownFolderIds.has(destinationFolderId)) return [...modules]
  const source = modules.find((module) => module.id === moduleId)
  if (!source) return [...modules]

  const remaining = modules.filter((module) => module.id !== moduleId)
  const moved = { ...source }
  if (destinationFolderId === null) delete moved.folderId
  else moved.folderId = destinationFolderId

  const groups = groupModulesByFolder(folders, remaining)
  const destination = groups.find(
    (group) => group.folder?.id === destinationFolderId || (!group.folder && destinationFolderId === null),
  )
  if (!destination) return [...modules]
  const index = Math.max(0, Math.min(destinationIndex ?? destination.modules.length, destination.modules.length))
  destination.modules.splice(index, 0, moved)
  return flattenModuleOrganizationGroups(groups)
}
