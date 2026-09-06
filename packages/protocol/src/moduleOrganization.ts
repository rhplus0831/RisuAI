import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const StableIdSchema = Type.String({ minLength: 1 })

export const ModuleFolderSchema = Type.Object(
  {
    id: StableIdSchema,
    name: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

export const CreateModuleFolderPayloadSchema = Type.Object(
  { folder: ModuleFolderSchema },
  { additionalProperties: false },
)

export const PatchModuleFolderPayloadSchema = Type.Object(
  {
    patch: Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  },
  { additionalProperties: false },
)

export const ReorderModuleFoldersPayloadSchema = Type.Object(
  { folderIds: Type.Array(StableIdSchema, { uniqueItems: true }) },
  { additionalProperties: false },
)

export const ReorderModulesWithFoldersPayloadSchema = Type.Object(
  {
    moduleIds: Type.Array(StableIdSchema, { uniqueItems: true }),
    folderByModuleId: Type.Record(StableIdSchema, Type.Union([StableIdSchema, Type.Null()])),
  },
  { additionalProperties: false },
)

export type ModuleFolder = Static<typeof ModuleFolderSchema>
export type CreateModuleFolderPayload = Static<typeof CreateModuleFolderPayloadSchema>
export type PatchModuleFolderPayload = Static<typeof PatchModuleFolderPayloadSchema>
export type ReorderModuleFoldersPayload = Static<typeof ReorderModuleFoldersPayloadSchema>
export type ReorderModulesWithFoldersPayload = Static<typeof ReorderModulesWithFoldersPayloadSchema>

function isTrimmedNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0
}

export function isModuleFolder(value: unknown): value is ModuleFolder {
  return (
    Value.Check(ModuleFolderSchema, value) && isTrimmedNonEmptyString(value.id) && isTrimmedNonEmptyString(value.name)
  )
}

/** Repair persisted/imported folder metadata without inventing new identities. */
export function normalizeModuleFolders(value: unknown): ModuleFolder[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  const folders: ModuleFolder[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const record = candidate as Record<string, unknown>
    if (!isTrimmedNonEmptyString(record.id) || typeof record.name !== 'string') continue
    const name = record.name.trim()
    if (name === '' || ids.has(record.id)) continue
    ids.add(record.id)
    folders.push({ id: record.id, name })
  }
  return folders
}

export function isCreateModuleFolderPayload(value: unknown): value is CreateModuleFolderPayload {
  return Value.Check(CreateModuleFolderPayloadSchema, value) && isModuleFolder(value.folder)
}

export function isPatchModuleFolderPayload(value: unknown): value is PatchModuleFolderPayload {
  return Value.Check(PatchModuleFolderPayloadSchema, value) && isTrimmedNonEmptyString(value.patch.name)
}

export function isReorderModuleFoldersPayload(value: unknown): value is ReorderModuleFoldersPayload {
  return Value.Check(ReorderModuleFoldersPayloadSchema, value) && value.folderIds.every(isTrimmedNonEmptyString)
}

export function isReorderModulesWithFoldersPayload(value: unknown): value is ReorderModulesWithFoldersPayload {
  if (!Value.Check(ReorderModulesWithFoldersPayloadSchema, value)) return false
  if (!value.moduleIds.every(isTrimmedNonEmptyString)) return false
  const assignmentEntries = Object.entries(value.folderByModuleId)
  if (
    assignmentEntries.length !== value.moduleIds.length ||
    value.moduleIds.some((moduleId) => !Object.prototype.hasOwnProperty.call(value.folderByModuleId, moduleId))
  ) {
    return false
  }
  return assignmentEntries.every(
    ([moduleId, folderId]) =>
      isTrimmedNonEmptyString(moduleId) && (folderId === null || isTrimmedNonEmptyString(folderId)),
  )
}
