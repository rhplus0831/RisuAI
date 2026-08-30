import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('model-types shared-core ownership', () => {
  it('keeps the browser facade and every Fastify consumer on shared core', () => {
    const sharedSubpath = '@risuai/shared-core/model-types'
    expect(source('src/ts/model/types.ts')).toContain(sharedSubpath)

    const consumers = [
      'server/fastify/src/commands/modelProfiles.ts',
      'server/fastify/src/databaseDefaults.ts',
      'server/fastify/src/generation/providerMessages.ts',
      'server/fastify/src/ollamaCloudToolProxy.ts',
      'server/fastify/src/prompt/chatDispatch.ts',
      'server/fastify/src/prompt/promptScope.ts',
      'server/fastify/src/prompt/tokenizerConfig.ts',
      'server/fastify/src/prompt/variables.ts',
      'server/fastify/__tests__/assemble.test.ts',
      'server/fastify/__tests__/chatDispatchProfileOptions.test.ts',
      'server/fastify/__tests__/commands.test.ts',
      'server/fastify/__tests__/databaseDefaults.test.ts',
      'server/fastify/__tests__/generation.chat.test.ts',
      'server/fastify/__tests__/generation.completion.test.ts',
      'server/fastify/__tests__/modelProfileResolver.server.test.ts',
      'server/fastify/__tests__/phase7CompatibilityStructure.test.ts',
      'server/fastify/__tests__/providerCapabilityRoute.test.ts',
      'server/fastify/__tests__/providerMessages.test.ts',
      'server/fastify/__tests__/splitPresets.test.ts',
      'server/fastify/__tests__/tokenizerConfig.test.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
      expect(source(consumer), consumer).not.toContain('src/ts/model/types')
    }
  })
})
