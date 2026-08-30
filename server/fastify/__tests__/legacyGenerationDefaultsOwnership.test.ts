import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { prebuiltNAIpresets, prebuiltPresets } from '../src/legacyGenerationDefaults.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('Fastify legacy generation defaults ownership', () => {
  it('keeps database normalization on the Fastify-owned compatibility module', () => {
    const databaseDefaults = source('server/fastify/src/databaseDefaults.ts')
    const owner = source('server/fastify/src/legacyGenerationDefaults.ts')

    expect(databaseDefaults).toContain("from './legacyGenerationDefaults.js'")
    expect(databaseDefaults).not.toContain('src/ts/process/templates/templates')
    expect(owner).not.toContain('src/ts/process/templates/templates')
    expect(owner).not.toContain('src/ts/storage/database.svelte')
  })

  it('contains exactly the legacy fields consumed by database normalization', () => {
    expect(Object.keys(prebuiltPresets)).toEqual(['OAI'])
    expect(Object.keys(prebuiltPresets.OAI)).toEqual(['mainPrompt', 'jailbreak', 'ooba', 'ainconfig'])
    expect(Object.keys(prebuiltNAIpresets)).toEqual([
      'topK',
      'topP',
      'topA',
      'tailFreeSampling',
      'repetitionPenalty',
      'repetitionPenaltyRange',
      'repetitionPenaltySlope',
      'repostitionPenaltyPresence',
      'seperator',
      'frequencyPenalty',
      'presencePenalty',
      'typicalp',
      'starter',
    ])
  })
})
