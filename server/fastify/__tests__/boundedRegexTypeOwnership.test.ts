import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('bounded regex settings type ownership', () => {
  it('keeps compatibility settings behind a narrow Fastify-owned record', () => {
    const owner = fs.readFileSync(path.join(repoRoot, 'server/fastify/src/prompt/boundedRegex.ts'), 'utf8')

    expect(owner).not.toContain('src/ts/storage/database.svelte')
    expect(owner).toContain('export interface BoundedRegexSettings')
    expect(owner).toContain("complexRegexCompatibilityMode: 'strict' | 'worker'")
    expect(owner).toContain('regexOutputSizeLimitMiB: number')
  })
})
