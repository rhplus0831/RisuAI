import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const realmImportTestPath = path.normalize('__tests__/realmImport.test.ts')
const directRealmImportTestRun = process.argv.some((arg) => {
  const normalized = path.normalize(arg)
  return (
    normalized === 'realmImport.test.ts' ||
    normalized === realmImportTestPath ||
    normalized.endsWith(`${path.sep}${realmImportTestPath}`)
  )
})

export default defineConfig({
  test: {
    root: here,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 15000,
    env: {
      RISU_DIRECT_REALM_IMPORT_TEST: directRealmImportTestRun ? 'true' : '',
    },
  },
})
