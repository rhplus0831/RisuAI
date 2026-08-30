import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

describe('provider message server type ownership', () => {
  it('keeps provider conversion behind a Fastify-owned input', () => {
    const owner = source('server/fastify/src/generation/providerMessages.ts')

    expect(owner).not.toContain('src/ts/process/index.svelte')
    expect(owner).toContain('export interface ProviderMessageInput')
    expect(owner).toContain('export interface ProviderMessageMultimodal')
  })
})
