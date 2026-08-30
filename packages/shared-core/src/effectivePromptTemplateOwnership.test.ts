import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('effective prompt-template shared-core ownership', () => {
  it('keeps the browser facade and every current runtime consumer on the shared policy', () => {
    const sharedSubpath = '@risuai/shared-core/effective-prompt-template'
    expect(source('src/ts/process/promptAssembly/effectivePromptTemplate.ts')).toContain(sharedSubpath)
    for (const consumer of [
      'server/fastify/src/prompt/templates.ts',
      'server/fastify/src/prompt/staticSections.ts',
      'src/ts/process/promptAssembly/normalizeTemplate.ts',
      'src/ts/utilState.ts',
      'packages/shared-core/src/cbsRegistry.ts',
      'src/ts/process/templates/templateCheck.ts',
      'src/lib/Setting/Pages/OtherBotSettings.svelte',
    ]) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
    }
  })

  it('removes the Fastify-to-browser effective policy edge', () => {
    for (const consumer of ['server/fastify/src/prompt/templates.ts', 'server/fastify/src/prompt/staticSections.ts']) {
      expect(source(consumer)).not.toContain('src/ts/process/promptAssembly/effectivePromptTemplate')
    }
  })
})
