import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { MASKED_PROVIDER_SECRET } from '../src/providerSecrets.js'
import { resourceProjectionFields } from '../src/routes/projection.js'
import type { FastifyInstance } from 'fastify'

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-projection-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
  })
  return { app, dataDir }
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

async function importDatabase(database: unknown): Promise<number> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    payload: { database },
  })
  expect(res.statusCode).toBe(200)
  return res.json().revision as number
}

async function getProjection(resource: string) {
  return harness.app.inject({ method: 'GET', url: `/api/v1/projection/${resource}` })
}

describe('targeted projection route (lazy-projection Phase 2)', () => {
  it('returns the owned top-level fields for a structural resource', async () => {
    const revision = await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
      language: 'en',
    })

    const res = await getProjection('character')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.revision).toBe(revision)
    expect(body.resource).toBe('character')
    expect(body.mode).toBe('fields')
    // Only the resource's owned keys are present.
    expect(Object.keys(body.fields).sort()).toEqual(['characterOrder', 'characters'])
    expect(body.fields.characters[0]).toMatchObject({ chaId: 'char-a', name: 'Ada' })
    expect(body.fields).not.toHaveProperty('botPresets')
    expect(body.fields).not.toHaveProperty('language')
  })

  it('masks provider secrets in the returned fields', async () => {
    await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      botPresets: [{ id: 'p1', openAIKey: 'sk-secret', proxyKey: 'px-secret' }],
    })

    const res = await getProjection('preset')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(body.fields.botPresets[0].openAIKey).toBe(MASKED_PROVIDER_SECRET)
    expect(body.fields.botPresets[0].proxyKey).toBe(MASKED_PROVIDER_SECRET)
  })

  it('returns mode "full" for a sprawling resource (settings)', async () => {
    const revision = await importDatabase({ characters: [], language: 'en' })
    const res = await getProjection('settings')
    const body = res.json()
    expect(body.revision).toBe(revision)
    expect(body.mode).toBe('full')
    expect(body.fields).toBeUndefined()
  })

  it('returns mode "full" for an unknown resource', async () => {
    await importDatabase({ characters: [] })
    const res = await getProjection('does-not-exist')
    expect(res.json().mode).toBe('full')
  })

  it('returns empty fields for the asset resource (no projected change)', async () => {
    await importDatabase({ characters: [] })
    const res = await getProjection('asset')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(body.fields).toEqual({})
  })

  it('maps every command-event resource to either fields or full', () => {
    // The structural resources the decision tree narrows; everything else
    // (settings/state/pluginStorage/unknown) intentionally falls back to full.
    expect(resourceProjectionFields('character')).toEqual(['characters', 'characterOrder'])
    expect(resourceProjectionFields('generation')).toEqual(['characters'])
    expect(resourceProjectionFields('asset')).toEqual([])
    expect(resourceProjectionFields('settings')).toBeNull()
    expect(resourceProjectionFields('state')).toBeNull()
  })
})

describe('Phase 5 lorebook stubs (enableLorebookStubs)', () => {
  const characterWithLore = (extra: Record<string, unknown> = {}) => ({
    characters: [
      {
        chaId: 'char-a',
        name: 'Ada',
        globalLore: [{ key: 'k', content: 'secret lore' }],
      },
    ],
    language: 'en',
    ...extra,
  })

  it('keeps character globalLore resident by default (stubs off)', async () => {
    await importDatabase(characterWithLore())
    const body = (await getProjection('character')).json()
    expect(body.fields.characters[0]).toHaveProperty('globalLore')
    expect(body.fields.characters[0].globalLore).toHaveLength(1)
  })

  it('strips character globalLore from the projection when enableLorebookStubs is on', async () => {
    await importDatabase(characterWithLore({ enableLorebookStubs: true }))
    const body = (await getProjection('character')).json()
    expect(body.fields.characters[0]).not.toHaveProperty('globalLore')
  })

  it('serves the full globalLore via /projection/characterLorebook even when stubbed', async () => {
    await importDatabase(characterWithLore({ enableLorebookStubs: true }))
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/characterLorebook?id=char-a',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.mode).toBe('character-lorebook')
    expect(body.characterId).toBe('char-a')
    expect(body.globalLore).toHaveLength(1)
    expect(body.globalLore[0].content).toBe('secret lore')
  })

  it('returns mode:full for a missing characterLorebook id', async () => {
    await importDatabase(characterWithLore())
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/characterLorebook',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().mode).toBe('full')
  })
})
