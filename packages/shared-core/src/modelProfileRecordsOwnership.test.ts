import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

function fastifyRuntimeSources(): string[] {
  return fs
    .readdirSync(path.join(repoRoot, 'server/fastify/src'), { recursive: true, encoding: 'utf8' })
    .filter((file) => typeof file === 'string' && file.endsWith('.ts'))
}

describe('model-profile-records shared-core ownership', () => {
  it('publishes the exact package subpath and root export', () => {
    const manifest = JSON.parse(source('packages/shared-core/package.json')) as {
      exports: Record<string, string>
    }
    expect(manifest.exports['./model-profile-records']).toBe('./src/modelProfileRecords.ts')

    const rootExports = source('packages/shared-core/src/index.ts')
    expect(rootExports).toContain("export * from './modelProfileRecords.js'")
  })

  it('keeps the browser compatibility facade and Fastify consumers on shared core', () => {
    const sharedSubpath = '@risuai/shared-core/model-profile-records'
    expect(source('src/ts/model/modelProfileRecords.ts')).toContain(sharedSubpath)

    for (const consumer of [
      'server/fastify/src/commands/modelProfiles.ts',
      'server/fastify/src/commands/presets.ts',
      'server/fastify/src/commands/providerCredentials.ts',
      'server/fastify/src/commands/splitPresets.ts',
      'server/fastify/src/databaseDefaults.ts',
      'server/fastify/src/prompt/effectiveGenerationConfig.ts',
      'server/fastify/src/routes/commands.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
      expect(source(consumer), consumer).not.toContain('src/ts/model/modelProfileRecords')
    }
  })

  it('keeps the moved implementation dependency-free', () => {
    const implementation = source('packages/shared-core/src/modelProfileRecords.ts')
    expect(implementation).not.toContain('src/ts/')
    expect(implementation).not.toContain('svelte')
    expect(implementation).not.toContain('fastify')
    expect(implementation).toContain("from './modelRoles.js'")
    expect(implementation).toContain("from './modelTypes.js'")
  })

  it('closes every Fastify runtime edge to the browser owner', () => {
    for (const relativePath of fastifyRuntimeSources()) {
      const contents = source(`server/fastify/src/${relativePath}`)
      expect(contents, relativePath).not.toContain('src/ts/model/modelProfileRecords')
    }
  })
})
