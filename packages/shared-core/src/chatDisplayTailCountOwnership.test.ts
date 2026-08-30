import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('chat display-tail shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const consumers = ['server/fastify/src/databaseDefaults.ts', 'src/ts/storage/database.svelte.ts']

    for (const consumer of consumers) {
      expect(source(consumer), consumer).toContain("from '@risuai/shared-core/chat-display-tail-count'")
    }
    expect(fs.existsSync(new URL('src/ts/chatDisplayTailCount.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
