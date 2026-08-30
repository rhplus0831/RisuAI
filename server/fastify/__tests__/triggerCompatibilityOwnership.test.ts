import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  diagnoseServerTriggerCompatibility,
  serverUnsupportedCbsCallbackNames,
  serverUnsupportedRegexEffectType,
} from '../src/prompt/triggerCompatibility.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

function unsupportedEffectTypes(file: string): string[] {
  const body = source(file).match(/serverUnsupportedTriggerEffectTypes:[\s\S]*?new Set\(\[([\s\S]*?)\]\)/)?.[1]
  if (!body) throw new Error(`Missing unsupported trigger-effect set in ${file}`)
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

describe('trigger compatibility policy ownership', () => {
  it('keeps Fastify consumers behind the server-owned policy', () => {
    const consumers = [
      'server/fastify/src/prompt/scripts.ts',
      'server/fastify/src/prompt/triggers.ts',
      'server/fastify/__tests__/phase9CompatibilityStructure.test.ts',
      'server/fastify/__tests__/triggers.test.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer)).not.toContain('src/ts/process/triggerServerSupport')
    }
  })

  it('keeps the browser compatibility-warning mirror aligned', () => {
    expect(unsupportedEffectTypes('server/fastify/src/prompt/triggerCompatibility.ts')).toEqual(
      unsupportedEffectTypes('src/ts/process/triggerServerSupport.ts'),
    )
  })

  it('keeps regex classification exact and CBS callback exclusions empty', () => {
    expect(serverUnsupportedRegexEffectType('@@emo happy')).toBe('@@emo')
    expect(serverUnsupportedRegexEffectType('@@emo')).toBeNull()
    expect(serverUnsupportedRegexEffectType('prefix @@emo happy')).toBeNull()
    expect(serverUnsupportedRegexEffectType(null)).toBeNull()
    expect([...serverUnsupportedCbsCallbackNames]).toEqual([])
  })

  it('diagnoses nested definitions without mutation, duplication, or cycles', () => {
    const definitions: { type: string; nested?: unknown } = {
      type: 'v2SetPersonaDesc',
      nested: [{ type: 'showAlert' }, { type: 'v2SetPersonaDesc' }],
    }
    definitions.nested = [definitions.nested, definitions]
    const before = definitions.type

    expect(diagnoseServerTriggerCompatibility(definitions)).toEqual({
      unsupportedEffectTypes: ['showAlert', 'v2SetPersonaDesc'],
      unsupportedCbsCallbacks: [],
    })
    expect(definitions.type).toBe(before)
  })
})
