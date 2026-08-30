import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('Agent lorebook input shared-core ownership', () => {
  it('keeps the pure resolver in shared-core and the browser export projection in src', () => {
    const browserOwner = source('src/ts/agentLorebookInputs.ts')
    const sharedOwner = source('packages/shared-core/src/agentLorebookInputs.ts')
    const fastifyConsumer = source('server/fastify/src/prompt/agentPresetExecution.ts')

    expect(browserOwner).toContain("from '@risuai/shared-core/agent-lorebook-inputs'")
    expect(fastifyConsumer).toContain("from '@risuai/shared-core/agent-lorebook-inputs'")
    expect(sharedOwner).not.toContain("from '../")
    expect(sharedOwner).not.toContain("from '../../../")
    expect(browserOwner).toContain('lorebookEntriesForOriginalRisuExport')
    expect(browserOwner).not.toContain('function resolveAgentLorebookInput')
  })
})
