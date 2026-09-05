import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as shared from '@risuai/shared-core/trigger-compatibility'
import * as server from '../src/prompt/triggerCompatibility.js'
import { moduleSpecifiers, parseSource } from '../../../util/test-support/source-contract.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

describe('trigger compatibility policy ownership', () => {
  it('keeps Fastify consumers on the server facade of the shared policy', () => {
    const consumers = [
      'server/fastify/src/prompt/scripts.ts',
      'server/fastify/src/prompt/triggers.ts',
      'server/fastify/__tests__/phase9CompatibilityStructure.test.ts',
      'server/fastify/__tests__/triggers.test.ts',
    ]

    for (const consumer of consumers) {
      const imports = moduleSpecifiers(parseSource(consumer, source(consumer)))
      expect(imports, consumer).toContain(
        consumer.includes('/__tests__/') ? '../src/prompt/triggerCompatibility.js' : './triggerCompatibility.js',
      )
      expect(imports, consumer).not.toContain('src/ts/process/triggerServerSupport')
    }
  })

  it('uses shared exports by identity without a second policy implementation', () => {
    expect(Object.keys(server).sort()).toEqual(Object.keys(shared).sort())
    for (const name of Object.keys(shared) as Array<keyof typeof shared>) {
      expect(server[name], name).toBe(shared[name])
    }
  })

  it('keeps regex classification exact and CBS callback exclusions empty', () => {
    expect(server.serverUnsupportedRegexEffectType('@@emo happy')).toBe('@@emo')
    expect(server.serverUnsupportedRegexEffectType('@@emo')).toBeNull()
    expect(server.serverUnsupportedRegexEffectType('prefix @@emo happy')).toBeNull()
    expect(server.serverUnsupportedRegexEffectType(null)).toBeNull()
    expect([...server.serverUnsupportedCbsCallbackNames]).toEqual([])
  })

  it('diagnoses nested definitions without mutation, duplication, or cycles', () => {
    const definitions: { type: string; nested?: unknown } = {
      type: 'v2SetPersonaDesc',
      nested: [{ type: 'showAlert' }, { type: 'v2SetPersonaDesc' }],
    }
    definitions.nested = [definitions.nested, definitions]
    const before = structuredClone(definitions)

    const diagnostics = server.diagnoseServerTriggerCompatibility(definitions)
    expect(diagnostics).toEqual({
      unsupportedEffectTypes: ['showAlert', 'v2SetPersonaDesc'],
      unsupportedCbsCallbacks: [],
    })
    expect(diagnostics).toEqual(shared.diagnoseServerTriggerCompatibility(definitions))
    expect(definitions).toEqual(before)
  })
})
