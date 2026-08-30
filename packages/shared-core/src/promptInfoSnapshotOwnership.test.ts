import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('prompt-info-snapshot shared-core ownership', () => {
  it('keeps the browser facade and Fastify consumer on shared core', () => {
    const sharedSubpath = '@risuai/shared-core/prompt-info-snapshot'
    expect(source('src/ts/promptInfo.ts')).toContain(sharedSubpath)
    expect(source('server/fastify/src/prompt/effectiveGenerationConfig.ts')).toContain(sharedSubpath)
    expect(source('server/fastify/src/prompt/effectiveGenerationConfig.ts')).not.toContain('src/ts/promptInfo')
  })
})
