import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('key/value parser shared-core ownership', () => {
  it('keeps the browser facade and Fastify defaults on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/parse-key-value'"
    expect(source('src/ts/util/parseKeyValue.ts')).toContain(sharedImport)
    expect(source('server/fastify/src/prompt/chatVarDefaults.ts')).toContain(sharedImport)
    expect(source('server/fastify/src/prompt/chatVarDefaults.ts')).not.toContain('src/ts/util/parseKeyValue')
  })
})
