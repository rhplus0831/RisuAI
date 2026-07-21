import type { Database } from './storage/database.svelte'

let databaseAccessor: (() => Database) | undefined

export function registerAlertDatabaseAccessor(accessor: () => Database): void {
  databaseAccessor = accessor
}

export function getAlertDatabase(): Database | undefined {
  return databaseAccessor?.()
}
