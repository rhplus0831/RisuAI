import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('default hotkey shared-core ownership', () => {
  it('keeps the browser facade and Fastify defaults on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/default-hotkeys'"
    expect(source('src/ts/defaulthotkeys.ts')).toContain(sharedImport)
    expect(source('server/fastify/src/databaseDefaults.ts')).toContain(sharedImport)
    expect(source('server/fastify/src/databaseDefaults.ts')).not.toContain('src/ts/defaulthotkeys')
  })
})
