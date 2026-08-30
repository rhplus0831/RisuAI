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

describe('module-activation shared-core ownership', () => {
  it('publishes the exact package subpath and root export', () => {
    const manifest = JSON.parse(source('packages/shared-core/package.json')) as {
      exports: Record<string, string>
    }
    expect(manifest.exports['./module-activation']).toBe('./src/moduleActivation.ts')
    expect(source('packages/shared-core/src/index.ts')).toContain("export * from './moduleActivation.js'")
  })

  it('keeps browser aggregate behavior while exposing pure helpers through the facade', () => {
    const browser = source('src/ts/moduleActivation.ts')
    expect(browser).toContain("from '@risuai/shared-core/module-activation'")
    expect(browser).toContain('export function resolveActiveModuleIdentifiers')
    expect(browser).toContain('export function resolveActiveModuleStates')
    expect(browser).toContain("from './agentPresetResolver'")
    expect(browser).toContain("from './personaModuleLinks'")
  })

  it('keeps the shared implementation dependency-free and closes Fastify edges', () => {
    const implementation = source('packages/shared-core/src/moduleActivation.ts')
    expect(implementation).not.toContain('src/ts/')
    expect(implementation).not.toContain('svelte')
    expect(implementation).not.toContain('fastify')
    expect(implementation).not.toContain('agentPresetResolver')
    expect(implementation).not.toContain('personaModuleLinks')
    expect(implementation).not.toContain('storage/')

    for (const relativePath of fastifyTypescriptSources()) {
      const contents = source(`server/fastify/${relativePath}`)
      expect(contents, relativePath).not.toContain('src/ts/moduleActivation')
    }
    expect(source('server/fastify/src/prompt/modules.ts')).toContain("from '@risuai/shared-core/module-activation'")
    expect(source('server/fastify/__tests__/phase10CompatibilityStructure.test.ts')).toContain(
      "from '@risuai/shared-core/module-activation'",
    )
  })
})
