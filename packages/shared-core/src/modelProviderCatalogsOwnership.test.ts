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

describe('shared model provider catalog ownership', () => {
  it('publishes exact package subpaths and root exports', () => {
    const manifest = JSON.parse(source('packages/shared-core/package.json')) as {
      exports: Record<string, string>
    }
    expect(manifest.exports['./openai-models']).toBe('./src/openaiModels.ts')
    expect(manifest.exports['./anthropic-models']).toBe('./src/anthropicModels.ts')
    expect(manifest.exports['./google-models']).toBe('./src/googleModels.ts')

    const rootExports = source('packages/shared-core/src/index.ts')
    expect(rootExports).toContain("export * from './openaiModels.js'")
    expect(rootExports).toContain("export * from './anthropicModels.js'")
    expect(rootExports).toContain("export * from './googleModels.js'")
  })

  it('keeps browser facades and Fastify consumers on the exact shared leaves', () => {
    expect(source('src/ts/model/providers/openai.ts').trim()).toBe(
      "export { OpenAIModels } from '@risuai/shared-core/openai-models'",
    )
    expect(source('src/ts/model/providers/anthropic.ts').trim()).toBe(
      "export { AnthropicModels } from '@risuai/shared-core/anthropic-models'",
    )
    expect(source('src/ts/model/providers/google.ts').trim()).toBe(
      "export { GoogleModels } from '@risuai/shared-core/google-models'",
    )

    const expectedConsumers = {
      'server/fastify/src/commands/modelProfiles.ts': [
        '@risuai/shared-core/openai-models',
        '@risuai/shared-core/anthropic-models',
        '@risuai/shared-core/google-models',
      ],
      'server/fastify/src/prompt/chatDispatch.ts': ['@risuai/shared-core/openai-models'],
    }
    for (const [consumer, subpaths] of Object.entries(expectedConsumers)) {
      const contents = source(consumer)
      for (const subpath of subpaths) expect(contents, `${consumer}: ${subpath}`).toContain(subpath)
    }
  })

  it('closes every Fastify edge to the browser provider modules', () => {
    for (const relativePath of fastifyTypescriptSources()) {
      const contents = source(`server/fastify/${relativePath}`)
      expect(contents, relativePath).not.toContain('src/ts/model/providers/openai')
      expect(contents, relativePath).not.toContain('src/ts/model/providers/anthropic')
      expect(contents, relativePath).not.toContain('src/ts/model/providers/google')
    }
  })

  it('keeps each shared catalog dependency-free', () => {
    for (const relativePath of [
      'packages/shared-core/src/openaiModels.ts',
      'packages/shared-core/src/anthropicModels.ts',
      'packages/shared-core/src/googleModels.ts',
    ]) {
      const implementation = source(relativePath)
      expect(implementation, relativePath).toContain("from './modelTypes.js'")
      expect(implementation, relativePath).not.toContain('src/ts/')
      expect(implementation, relativePath).not.toContain('svelte')
      expect(implementation, relativePath).not.toContain('fastify')
    }
  })
})
