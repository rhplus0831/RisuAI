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

describe('agent-preset-resolver shared-core ownership', () => {
  it('publishes the exact package subpath and root export', () => {
    const manifest = JSON.parse(source('packages/shared-core/package.json')) as {
      exports: Record<string, string>
    }
    expect(manifest.exports['./agent-preset-resolver']).toBe('./src/agentPresetResolver.ts')
    expect(source('packages/shared-core/src/index.ts')).toContain("export * from './agentPresetResolver.js'")
  })

  it('keeps the browser compatibility facade and migrates Fastify consumers', () => {
    const sharedSubpath = '@risuai/shared-core/agent-preset-resolver'
    expect(source('src/ts/agentPresetResolver.ts').trim()).toBe(`export * from '${sharedSubpath}'`)
    for (const relativePath of fastifyTypescriptSources()) {
      const contents = source(`server/fastify/${relativePath}`)
      expect(contents, relativePath).not.toContain('src/ts/agentPresetResolver')
    }
    for (const consumer of [
      'server/fastify/src/prompt/agentPresetExecution.ts',
      'server/fastify/src/prompt/assemble.ts',
      'server/fastify/src/prompt/effectiveGenerationConfig.ts',
      'server/fastify/__tests__/agentPresetExecution.test.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
    }
  })

  it('keeps the shared implementation dependency-free and on shared leaves', () => {
    const implementation = source('packages/shared-core/src/agentPresetResolver.ts')
    expect(implementation).not.toContain('src/ts/')
    expect(implementation).not.toContain('svelte')
    expect(implementation).not.toContain('fastify')
    expect(implementation).not.toContain('node:')
    expect(implementation).not.toContain('storage/')
    expect(implementation).toContain("from './agentPresetRecords.js'")
    expect(implementation).toContain("from './chatGenerationSettings.js'")
    expect(implementation).toContain("from './modelProfileResolver.js'")
  })
})
