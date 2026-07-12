import type { Database } from '../storage/database.svelte'
import { getResourceDatabase, replaceResourceDatabase } from '../server/resourceState.svelte'

/** Mutable test adapter for suites that need to replace the resource database wholesale. */
export const testDatabaseState = {
  get db(): Database {
    return getResourceDatabase()
  },
  set db(value: Database | Record<string, unknown>) {
    replaceResourceDatabase(value as Database)
  },
}
