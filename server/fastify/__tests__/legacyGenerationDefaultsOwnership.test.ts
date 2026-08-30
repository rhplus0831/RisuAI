import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { prebuiltNAIpresets, prebuiltPresets } from '../src/legacyGenerationDefaults.js'
import {
  prebuiltNAIpresets as browserPrebuiltNAIpresets,
  prebuiltPresets as browserPrebuiltPresets,
} from '../../../src/ts/process/templates/templates.js'

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

  it('preserves the browser defaults byte-for-byte for the retained compatibility fields', () => {
    // This browser import is intentionally test-only. It is a removable
    // compatibility oracle once the legacy browser catalog is retired.
    const browserGenerationDefaults = {
      OAI: {
        mainPrompt: browserPrebuiltPresets.OAI.mainPrompt,
        jailbreak: browserPrebuiltPresets.OAI.jailbreak,
        ooba: browserPrebuiltPresets.OAI.ooba,
        ainconfig: browserPrebuiltPresets.OAI.ainconfig,
      },
    }

    expect(JSON.stringify(prebuiltPresets)).toBe(JSON.stringify(browserGenerationDefaults))
    expect(JSON.stringify(prebuiltNAIpresets)).toBe(JSON.stringify(browserPrebuiltNAIpresets))
  })
})
