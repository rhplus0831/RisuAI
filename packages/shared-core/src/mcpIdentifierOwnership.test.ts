import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('MCP identifier shared-core ownership', () => {
  it('keeps browser compatibility and Fastify validation on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/mcp-identifier'"
    expect(source('src/ts/process/mcp/mcpIdentifier.ts')).toContain(sharedImport)
    expect(source('server/fastify/src/commands/modules.ts')).toContain(sharedImport)
    expect(source('server/fastify/src/commands/modules.ts')).not.toContain('src/ts/process/mcp/mcpIdentifier')
  })
})
