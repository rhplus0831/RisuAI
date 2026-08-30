import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('CBS callback memo type ownership', () => {
  it('keeps every Fastify memo consumer on the local contract', () => {
    const consumers = [
      'server/fastify/src/prompt/cbsCallbackMemo.ts',
      'server/fastify/src/prompt/assemble.ts',
      'server/fastify/src/prompt/variables.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer), consumer).not.toContain('src/ts/cbs')
    }

    const owner = source('packages/shared-core/src/cbsContracts.ts')
    expect(owner).toContain("export type CbsCallbackMemoName = 'charhistory' | 'userhistory' | 'lorebook'")
    expect(owner).toContain('export interface CbsCallbackMemo')
    expect(source('server/fastify/src/prompt/cbsCallbackMemo.ts')).toContain(
      "from '@risuai/shared-core/cbs-contracts'",
    )
  })
})
