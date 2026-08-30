import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('history-slot shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/history-slots'"
    for (const consumer of [
      'src/ts/process/inputHooks.ts',
      'src/lib/ChatScreens/DefaultChatScreen.svelte',
      'server/fastify/src/translation/rawMessageTranslation.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedImport)
    }
    expect(fs.existsSync(new URL('src/ts/translator/historySlots.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
