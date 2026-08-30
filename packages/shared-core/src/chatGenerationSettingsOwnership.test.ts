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

describe('chat-generation-settings shared-core ownership', () => {
  it('publishes the exact package subpath and root export', () => {
    const manifest = JSON.parse(source('packages/shared-core/package.json')) as {
      exports: Record<string, string>
    }
    expect(manifest.exports['./chat-generation-settings']).toBe('./src/chatGenerationSettings.ts')
    expect(source('packages/shared-core/src/index.ts')).toContain("export * from './chatGenerationSettings.js'")
  })

  it('keeps the browser compatibility facade and moves every Fastify consumer', () => {
    const sharedSubpath = '@risuai/shared-core/chat-generation-settings'
    expect(source('src/ts/chatGenerationSettings.ts').trim()).toBe(`export * from '${sharedSubpath}'`)

    for (const relativePath of fastifyTypescriptSources()) {
      const contents = source(`server/fastify/${relativePath}`)
      expect(contents, relativePath).not.toContain('src/ts/chatGenerationSettings')
    }
    for (const consumer of [
      'server/fastify/src/chatGenerationSettingsStorage.ts',
      'server/fastify/src/commands/chats.ts',
      'server/fastify/src/prompt/effectiveGenerationConfig.ts',
      'server/fastify/src/risuSave/importSnapshot.ts',
      'server/fastify/src/routes/commands.ts',
      'server/fastify/__tests__/commandSingleRowPaths.test.ts',
      'server/fastify/__tests__/commands.test.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
    }
  })

  it('keeps the shared implementation dependency-free', () => {
    const implementation = source('packages/shared-core/src/chatGenerationSettings.ts')
    expect(implementation).not.toContain('src/ts/')
    expect(implementation).not.toContain('svelte')
    expect(implementation).not.toContain('fastify')
    expect(implementation).not.toContain('node:')
    expect(implementation).toContain("from './agentPresetRecords.js'")
    expect(implementation).toContain("from './moduleActivation.js'")
    expect(implementation).toContain("from './moduleIntegration.js'")
  })
})
