import { normalizeModelRoleProfiles, type ModelRoleProfileMap } from './modelProfileRecords'

export interface ModelRoleBindingPresetSnapshot {
  name: string
  modelRoleProfiles: ModelRoleProfileMap
}

export function createModelRoleBindingPresetSnapshot(
  source: { modelRoleProfiles?: unknown },
  name: string,
): ModelRoleBindingPresetSnapshot {
  return {
    name,
    modelRoleProfiles: cloneJsonValue(normalizeModelRoleProfiles(source.modelRoleProfiles)),
  }
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
