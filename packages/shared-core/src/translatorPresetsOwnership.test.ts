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

describe('translator-presets shared-core ownership', () => {
  it('publishes the exact package subpath and root export', () => {
    const manifest = JSON.parse(source('packages/shared-core/package.json')) as {
      exports: Record<string, string>
    }
    expect(manifest.exports['./translator-presets']).toBe('./src/translatorPresets.ts')
    expect(source('packages/shared-core/src/index.ts')).toContain("export * from './translatorPresets.js'")
  })

  it('keeps codec behavior in the browser facade and migrates Fastify consumers', () => {
    const sharedSubpath = '@risuai/shared-core/translator-presets'
    const browser = source('src/ts/translator/presets.ts')
    expect(browser).toContain(`from '${sharedSubpath}'`)
    expect(browser).toContain("from 'msgpackr/index-no-eval'")
    expect(browser).toContain("from 'fflate'")

    for (const relativePath of fastifyTypescriptSources()) {
      const contents = source(`server/fastify/${relativePath}`)
      expect(contents, relativePath).not.toContain('src/ts/translator/presets')
    }
    for (const consumer of [
      'server/fastify/src/commands/translatorPresets.ts',
      'server/fastify/src/databaseDefaults.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
    }
  })

  it('keeps the shared record implementation dependency-free', () => {
    const implementation = source('packages/shared-core/src/translatorPresets.ts')
    expect(implementation).not.toContain('src/ts/')
    expect(implementation).not.toContain('svelte')
    expect(implementation).not.toContain('fastify')
    expect(implementation).not.toContain('node:')
    expect(implementation).not.toContain('msgpackr')
    expect(implementation).not.toContain('fflate')
    expect(implementation).not.toContain('rpack')
    expect(implementation).not.toContain('../')
  })
})
