import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('Hypa context truncation protocol ownership', () => {
  it('keeps the browser facade and Fastify route on the protocol contract', () => {
    const protocolImport = "from '@risuai/protocol/hypa-context-truncation'"
    expect(source('src/ts/process/request/hypaContextTruncation.ts')).toContain(protocolImport)
    expect(source('server/fastify/src/routes/generationChat.ts')).toContain(protocolImport)
    expect(source('server/fastify/src/routes/generationChat.ts')).not.toContain(
      'src/ts/process/request/hypaContextTruncation',
    )
  })
})
