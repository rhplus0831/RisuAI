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

describe('preset-split shared-core ownership', () => {
  it('publishes the exact package subpath and root export', () => {
    const manifest = JSON.parse(source('packages/shared-core/package.json')) as {
      exports: Record<string, string>
    }
    expect(manifest.exports['./preset-split']).toBe('./src/presetSplit.ts')
    expect(source('packages/shared-core/src/index.ts')).toContain("export * from './presetSplit.js'")
  })

  it('keeps the browser compatibility facade and migrates every Fastify consumer', () => {
    const sharedSubpath = '@risuai/shared-core/preset-split'
    expect(source('src/ts/presetSplit.ts').trim()).toBe(`export * from '${sharedSubpath}'`)

    for (const relativePath of fastifyTypescriptSources()) {
      const contents = source(`server/fastify/${relativePath}`)
      expect(contents, relativePath).not.toContain('src/ts/presetSplit')
    }
    for (const consumer of [
      'server/fastify/src/commands/splitPresets.ts',
      'server/fastify/src/databaseDefaults.ts',
      'server/fastify/src/displaySourceService.ts',
      'server/fastify/src/memorySummarizeJobHandler.ts',
      'server/fastify/src/prompt/effectiveGenerationConfig.ts',
      'server/fastify/src/routes/commands.ts',
      'server/fastify/__tests__/phase5CompatibilityStructure.test.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
    }
  })

  it('keeps the shared implementation dependency-free and on shared leaves', () => {
    const implementation = source('packages/shared-core/src/presetSplit.ts')
    expect(implementation).not.toContain('src/ts/')
    expect(implementation).not.toContain('svelte')
    expect(implementation).not.toContain('fastify')
    expect(implementation).not.toContain('node:')
    expect(implementation).toContain("from './promptTemplateNormalization.js'")
    expect(implementation).toContain("from './modelProfileRecords.js'")
  })
})
