import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

function typescriptSources(root: string): string[] {
  return fs
    .readdirSync(path.join(repoRoot, root), { recursive: true, encoding: 'utf8' })
    .filter((file) => typeof file === 'string' && file.endsWith('.ts'))
}

describe('provider-capability shared-core ownership', () => {
  it('publishes the exact package subpath and root export', () => {
    const manifest = JSON.parse(source('packages/shared-core/package.json')) as {
      exports: Record<string, string>
    }
    expect(manifest.exports['./provider-capability']).toBe('./src/providerCapability.ts')

    const rootExports = source('packages/shared-core/src/index.ts')
    expect(rootExports).toContain("export * from './providerCapability.js'")
  })

  it('keeps the browser path as a compatibility facade without a second table', () => {
    expect(source('src/ts/process/request/providerCapability.ts').trim()).toBe(
      "export * from '@risuai/shared-core/provider-capability'",
    )

    expect(source('packages/shared-core/src/modelProfileResolver.ts')).toContain("from './providerCapability.js'")
    expect(source('src/ts/process/request/serverCompletion.ts')).toContain("from './providerCapability'")
  })

  it('moves the Fastify production and structural-test consumers to shared core', () => {
    const sharedSubpath = '@risuai/shared-core/provider-capability'
    for (const consumer of [
      'server/fastify/src/prompt/chatDispatch.ts',
      'server/fastify/__tests__/phase7CompatibilityStructure.test.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
      expect(source(consumer), consumer).not.toContain('src/ts/process/request/providerCapability')
    }
  })

  it('keeps the shared implementation on shared model and secret-mask leaves', () => {
    const implementation = source('packages/shared-core/src/providerCapability.ts')
    expect(implementation).toContain("from './modelTypes.js'")
    expect(implementation).toContain("from './providerSecretMask.js'")
    expect(implementation).not.toContain('src/ts/')
    expect(implementation).not.toContain('svelte')
    expect(implementation).not.toContain('fastify')
  })

  it('closes every Fastify edge to the browser implementation path', () => {
    for (const relativePath of typescriptSources('server/fastify')) {
      const contents = source(`server/fastify/${relativePath}`)
      expect(contents, relativePath).not.toContain('src/ts/process/request/providerCapability')
    }
  })
})
