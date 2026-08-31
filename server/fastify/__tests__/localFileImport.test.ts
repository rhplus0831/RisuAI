import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs, { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import * as fflate from 'fflate'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { getSchemaState } from '../src/db.js'
import { getAllAssetMetadata, loadPersisted } from '../src/repository.js'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
}

const rpackMap = readFileSync(path.join(process.cwd(), 'src/ts/rpack/rpack_map.bin'))
const rpackEncodeMap = rpackMap.subarray(0, 256)

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-local-file-import-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: 16 * 1024 * 1024,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    memoryWorker: false,
  })
  return { app, dataDir }
}

function currentRevision(dataDir: string): number {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    return getSchemaState(db).revision
  } finally {
    db.close()
  }
}

function persistedState(dataDir: string) {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    return {
      database: loadPersisted(db, dataDir).database as Record<string, unknown>,
      assets: getAllAssetMetadata(db),
    }
  } finally {
    db.close()
  }
}

function multipartFile(bytes: Uint8Array, filename: string) {
  const boundary = `risu-local-import-${Date.now()}`
  const head = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: application/octet-stream',
      '',
      '',
    ].join('\r\n'),
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    payload: Buffer.concat([head, Buffer.from(bytes), tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function encodeRpack(data: Uint8Array): Buffer {
  const encoded = Buffer.alloc(data.byteLength)
  for (let index = 0; index < data.byteLength; index += 1) encoded[index] = rpackEncodeMap[data[index]]
  return encoded
}

function risum(module: Record<string, unknown>, assets: readonly Uint8Array[] = []): Buffer {
  const headerPayload = encodeRpack(Buffer.from(JSON.stringify({ type: 'risuModule', module })))
  const header = Buffer.alloc(6)
  header.writeUInt8(111, 0)
  header.writeUInt8(0, 1)
  header.writeUInt32LE(headerPayload.length, 2)
  const chunks: Buffer[] = [header, headerPayload]
  for (const asset of assets) {
    const encoded = encodeRpack(asset)
    const length = Buffer.alloc(4)
    length.writeUInt32LE(encoded.length, 0)
    chunks.push(Buffer.from([1]), length, encoded)
  }
  chunks.push(Buffer.from([0]))
  return Buffer.concat(chunks)
}

function characterArchive(mainImage: Uint8Array): Uint8Array {
  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: 'Uploaded Character',
      description: 'Processed by Fastify',
      personality: '',
      scenario: '',
      first_mes: 'Hello',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '1',
      extensions: { risuai: {} },
      assets: [{ type: 'icon', uri: 'embeded://assets/main.png', name: 'main', ext: 'png' }],
    },
  }
  return fflate.zipSync(
    {
      'card.json': Buffer.from(JSON.stringify(card)),
      'assets/main.png': mainImage,
    },
    { level: 0 },
  )
}

let harness: Harness
let assertion: string

beforeEach(async () => {
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
  const initialized = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/commands/state/initialize',
    headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
    payload: {},
  })
  expect(initialized.statusCode, initialized.body).toBe(200)
})

afterEach(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

describe('local character and module file imports', () => {
  it('uploads one CharX file, persists its assets, and creates the character server-side', async () => {
    const mainImage = Buffer.from('server-side character image')
    const upload = multipartFile(characterArchive(mainImage), 'character.charx')
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/import/character-card?baseRevision=${currentRevision(harness.dataDir)}`,
      headers: {
        'content-type': upload.contentType,
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
      },
      payload: upload.payload,
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      event: { type: 'character.created', resource: 'character' },
      characterId: expect.any(String),
      importReport: { droppedArchiveEntries: [], droppedInlineAssets: [] },
    })
    const state = persistedState(harness.dataDir)
    const characters = state.database.characters as Array<Record<string, unknown>>
    expect(characters).toHaveLength(1)
    expect(characters[0]).toMatchObject({
      name: 'Uploaded Character',
      image: createHash('sha256').update(mainImage).digest('hex'),
    })
    expect(state.assets).toHaveLength(1)
  })

  it('keeps a low-level .risum on the server, then creates it after token confirmation', async () => {
    const assetBytes = Buffer.from('module webp bytes')
    const moduleBytes = risum(
      {
        id: 'source-module-id',
        name: 'Uploaded Module',
        description: 'Processed by Fastify',
        lowLevelAccess: true,
        assets: [['portrait', '', 'portrait.webp']],
      },
      [assetBytes],
    )
    const upload = multipartFile(moduleBytes, 'module.risum')
    const baseRevision = currentRevision(harness.dataDir)
    const challenge = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/import/module?baseRevision=${baseRevision}`,
      headers: {
        'content-type': upload.contentType,
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
      },
      payload: upload.payload,
    })

    expect(challenge.statusCode).toBe(409)
    const challengeBody = challenge.json() as { pendingImportToken: string }
    expect(challengeBody).toMatchObject({
      code: 'low_level_access_confirmation_required',
      pendingImportToken: expect.any(String),
    })
    expect(persistedState(harness.dataDir).database.modules as unknown[]).toHaveLength(0)
    expect(persistedState(harness.dataDir).assets).toHaveLength(0)

    const confirmed = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/module',
      headers: {
        'content-type': 'application/json',
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
      },
      payload: {
        baseRevision,
        pendingImportToken: challengeBody.pendingImportToken,
        allowLowLevelAccess: true,
      },
    })

    expect(confirmed.statusCode, confirmed.body).toBe(200)
    expect(confirmed.json()).toMatchObject({
      event: { type: 'module.created', resource: 'moduleCreated' },
      moduleId: expect.any(String),
    })
    const state = persistedState(harness.dataDir)
    const modules = state.database.modules as Array<Record<string, unknown>>
    expect(modules).toHaveLength(1)
    expect(modules[0]).toMatchObject({
      id: expect.not.stringMatching(/^source-module-id$/),
      name: 'Uploaded Module',
      lowLevelAccess: true,
      assets: [['portrait', createHash('sha256').update(assetBytes).digest('hex'), 'portrait.webp']],
    })
    expect(state.assets).toHaveLength(1)
  })

  it('accepts the existing top-level JSON risuModule interchange shape', async () => {
    const upload = multipartFile(
      Buffer.from(
        JSON.stringify({
          type: 'risuModule',
          id: 'source-json-id',
          name: 'JSON Module',
          description: 'Existing JSON interchange shape',
        }),
      ),
      'module.json',
    )
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/import/module?baseRevision=${currentRevision(harness.dataDir)}`,
      headers: {
        'content-type': upload.contentType,
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
      },
      payload: upload.payload,
    })

    expect(response.statusCode, response.body).toBe(200)
    const modules = persistedState(harness.dataDir).database.modules as Array<Record<string, unknown>>
    expect(modules).toHaveLength(1)
    expect(modules[0]).toMatchObject({
      id: expect.not.stringMatching(/^source-json-id$/),
      name: 'JSON Module',
      description: 'Existing JSON interchange shape',
    })
  })
})
