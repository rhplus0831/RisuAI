import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('chat-generation-toggle-preset-records shared-core ownership', () => {
  it('keeps the browser facade and Fastify consumer on shared core', () => {
    const sharedSubpath = '@risuai/shared-core/chat-generation-toggle-preset-records'
    expect(source('src/ts/chatGenerationTogglePresetRecords.ts')).toContain(sharedSubpath)
    expect(source('src/ts/chatGenerationSettings.ts')).toContain('@risuai/shared-core/chat-generation-settings')
    expect(source('packages/shared-core/src/chatGenerationSettings.ts')).toContain(
      './chatGenerationTogglePresetRecords.js',
    )
    expect(source('server/fastify/src/routes/commands.ts')).toContain(sharedSubpath)
    expect(source('server/fastify/src/routes/commands.ts')).not.toContain('src/ts/chatGenerationTogglePresetRecords')
  })
})
