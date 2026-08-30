import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('chat page shared-core ownership', () => {
  it('keeps browser and Fastify consumers on the shared leaf without local duplicate bodies', () => {
    const browser = source('src/ts/chatCommands.ts')
    const server = source('server/fastify/src/commands/chats.ts')

    for (const consumer of [browser, server]) {
      expect(consumer).toContain("from '@risuai/shared-core/chat-page'")
      expect(consumer).not.toContain('function normalizeChatPage(')
      expect(consumer).not.toContain('if (!Number.isInteger(character.chatPage')
    }
    expect(browser.match(/normalizeChatPageIndex\(/g)).toHaveLength(3)
    expect(server.match(/normalizeChatPageIndex\(/g)).toHaveLength(1)
  })
})
