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

describe('translator-pipeline shared-core ownership', () => {
  it('publishes the exact package subpath and root export', () => {
    const manifest = JSON.parse(source('packages/shared-core/package.json')) as {
      exports: Record<string, string>
    }
    expect(manifest.exports['./translator-pipeline']).toBe('./src/translatorPipeline.ts')
    expect(source('packages/shared-core/src/index.ts')).toContain("export * from './translatorPipeline.js'")
  })

  it('keeps the browser facade and migrates the Fastify translation consumer', () => {
    const sharedSubpath = '@risuai/shared-core/translator-pipeline'
    expect(source('src/ts/translator/pipeline.ts').trim()).toBe(`export * from '${sharedSubpath}'`)
    for (const relativePath of fastifyTypescriptSources()) {
      const contents = source(`server/fastify/${relativePath}`)
      expect(contents, relativePath).not.toContain('src/ts/translator/pipeline')
    }
    expect(source('server/fastify/src/translation/rawMessageTranslation.ts')).toContain(sharedSubpath)
  })

  it('keeps the shared pipeline dependency-free', () => {
    const implementation = source('packages/shared-core/src/translatorPipeline.ts')
    expect(implementation).not.toContain('src/ts/')
    expect(implementation).not.toContain('svelte')
    expect(implementation).not.toContain('fastify')
    expect(implementation).not.toContain('node:')
    expect(implementation).not.toContain('../')
  })
})
