import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('lorebook model ownership', () => {
  it('does not carry an unused flat model mirror through activation', () => {
    const lorebook = source('server/fastify/src/prompt/lorebook.ts')
    const assemble = source('server/fastify/src/prompt/assemble.ts')
    const agentPreset = source('server/fastify/src/prompt/agentPresetExecution.ts')
    const luaRuntime = source('server/fastify/src/prompt/luaRuntime.ts')
    const assemblyCalls = [...assemble.matchAll(/activateLorebook(?:Async)?\(\{([\s\S]*?)\n  \}\)/g)].map(
      (match) => match[1],
    )

    expect(lorebook).not.toContain('model?: string')
    expect(assemblyCalls).toHaveLength(2)
    expect(assemblyCalls.every((call) => !call.includes('model:'))).toBe(true)
    expect(agentPreset).not.toContain('model: context.database.aiModel')
    expect(luaRuntime).not.toContain('model: state.ctx.model')
  })
})
