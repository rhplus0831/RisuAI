import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('prompt-settings shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const sharedSubpath = '@risuai/shared-core/prompt-settings'
    for (const consumer of ['server/fastify/src/commands/prompts.ts', 'src/lib/Setting/Pages/BotSettings.svelte']) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
    }
    expect(source('packages/shared-core/src/settingsGroups.ts')).toContain("from './promptSettings.js'")
    expect(fs.existsSync(new URL('src/ts/promptSettings.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
