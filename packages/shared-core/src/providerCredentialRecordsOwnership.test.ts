import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('provider-credential-records shared-core ownership', () => {
  it('keeps the browser facade and Fastify consumers on shared core', () => {
    const sharedSubpath = '@risuai/shared-core/provider-credential-records'
    expect(source('src/ts/model/providerCredentialRecords.ts')).toContain(sharedSubpath)

    for (const consumer of [
      'server/fastify/src/commands/providerCredentials.ts',
      'server/fastify/src/commands/modelProfiles.ts',
      'server/fastify/src/databaseDefaults.ts',
      'server/fastify/src/routes/commands.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
      expect(source(consumer), consumer).not.toContain('src/ts/model/providerCredentialRecords')
    }
  })

  it('keeps projected credential normalization on the shared owner and facade', () => {
    expect(source('src/ts/model/providerCredentialRecords.ts')).toContain('normalizeProjectedProviderCredentials')
    expect(source('packages/shared-core/src/providerCredentialRecords.ts')).toContain(
      'export function normalizeProjectedProviderCredentials',
    )
  })
})
