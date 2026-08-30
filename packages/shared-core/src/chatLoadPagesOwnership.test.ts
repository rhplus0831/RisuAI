import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('chat load-page shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const consumers = [
      'server/fastify/src/databaseDefaults.ts',
      'src/lib/ChatScreens/DefaultChatScreen.loadPages.ts',
      'src/lib/ChatScreens/DefaultChatScreen.svelte',
      'src/ts/server/chatMessageHydration.svelte.ts',
      'src/ts/server/routeResourceLoader.ts',
      'src/ts/storage/database.svelte.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer), consumer).toContain("from '@risuai/shared-core/chat-load-pages'")
    }
    expect(fs.existsSync(new URL('src/ts/chatLoadPages.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
