import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

function fastifyTypescriptSources(): string[] {
  return fs
    .readdirSync(path.join(repoRoot, 'server/fastify'), { recursive: true, encoding: 'utf8' })
    .filter((file) => typeof file === 'string' && file.endsWith('.ts'))
}

describe('model-profile-resolver shared-core ownership', () => {
  it('publishes the exact package subpath and root export', () => {
    const manifest = JSON.parse(source('packages/shared-core/package.json')) as {
      exports: Record<string, string>
    }
    expect(manifest.exports['./model-profile-resolver']).toBe('./src/modelProfileResolver.ts')

    const rootExports = source('packages/shared-core/src/index.ts')
    expect(rootExports).toContain("export * from './modelProfileResolver.js'")
  })

  it('keeps the browser compatibility facade and every Fastify consumer on shared core', () => {
    const sharedSubpath = '@risuai/shared-core/model-profile-resolver'
    expect(source('src/ts/model/modelProfileResolver.ts').trim()).toBe(`export * from '${sharedSubpath}'`)

    for (const relativePath of fastifyTypescriptSources()) {
      const contents = source(`server/fastify/${relativePath}`)
      if (contents.includes('modelProfileResolver')) expect(contents, relativePath).toContain(sharedSubpath)
      expect(contents, relativePath).not.toContain('src/ts/model/modelProfileResolver')
    }
  })

  it('keeps the moved implementation dependency-free and on shared leaves', () => {
    const implementation = source('packages/shared-core/src/modelProfileResolver.ts')
    expect(implementation).not.toContain('src/ts/')
    expect(implementation).not.toContain('svelte')
    expect(implementation).not.toContain('fastify')
    expect(implementation).toContain("from './modelRoles.js'")
    expect(implementation).toContain("from './modelTypes.js'")
    expect(implementation).toContain("from './modelProfileRecords.js'")
    expect(implementation).toContain("from './providerCapability.js'")
    expect(implementation).toContain("from './providerCredentialRecords.js'")
  })
})
