import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import {
  executeOpenAITranscription,
  OPENAI_TRANSCRIPTION_MAX_FILE_BYTES,
  validateOpenAITranscriptionInput,
} from '../src/openAITranscription.js'

const VTT = 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n'

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name)
}

describe('OpenAI transcription operation', () => {
  it('uses the raw stored key and a fixed Whisper VTT request', async () => {
    const fetchImpl = vi.fn(async () => new Response(VTT, { headers: { 'content-type': 'text/vtt' } }))

    await expect(
      executeOpenAITranscription(
        { bytes: new TextEncoder().encode('audio'), filename: '../sample.mp3' },
        { openAIKey: 'server-only-openai-key' },
        { fetchImpl: fetchImpl as typeof fetch },
      ),
    ).resolves.toBe(VTT)

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    expect(header(init, 'authorization')).toBe('Bearer server-only-openai-key')
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('response_format')).toBe('vtt')
    expect((form.get('file') as File).name).toBe('sample.mp3')
    expect(await (form.get('file') as File).text()).toBe('audio')
  })

  it('rejects missing/masked credentials, unsupported files, and oversized media', async () => {
    const input = { bytes: new Uint8Array([1]), filename: 'sample.mp3' }
    await expect(executeOpenAITranscription(input, {})).rejects.toMatchObject({
      code: 'openai_transcription_credential_unavailable',
    })
    await expect(executeOpenAITranscription(input, { openAIKey: '__RISU_SECRET_MASKED__' })).rejects.toMatchObject({
      code: 'openai_transcription_credential_unavailable',
    })
    expect(() => validateOpenAITranscriptionInput({ bytes: new Uint8Array([1]), filename: 'sample.exe' })).toThrow(
      expect.objectContaining({ code: 'invalid_openai_transcription_request' }),
    )
    const oversizedBytes = new Proxy(new Uint8Array([1]), {
      get(target, property) {
        if (property === 'byteLength') return OPENAI_TRANSCRIPTION_MAX_FILE_BYTES + 1
        return Reflect.get(target, property, target)
      },
    })
    expect(() =>
      validateOpenAITranscriptionInput({
        bytes: oversizedBytes,
        filename: 'sample.mp3',
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_openai_transcription_request' }))
  })

  it('sanitizes upstream failures and bounds/validates VTT responses', async () => {
    const input = { bytes: new Uint8Array([1]), filename: 'sample.wav' }
    const settings = { openAIKey: 'server-only-openai-key' }
    await expect(
      executeOpenAITranscription(input, settings, {
        fetchImpl: (async () => new Response('secret provider detail', { status: 401 })) as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'openai_transcription_failed', upstreamStatus: 401 })
    await expect(
      executeOpenAITranscription(input, settings, {
        fetchImpl: (async () => new Response('{"text":"not vtt"}')) as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'openai_transcription_invalid_response' })
    await expect(
      executeOpenAITranscription(input, settings, {
        fetchImpl: (async () => new Response(VTT)) as typeof fetch,
        maxResponseBytes: 5,
      }),
    ).rejects.toMatchObject({ code: 'openai_transcription_invalid_response' })
  })
})

interface Harness {
  app: FastifyInstance
  dataDir: string
}

const harnesses: Harness[] = []

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop()!
    await harness.app.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  }
})

async function startHarness(fetchImpl: typeof fetch): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-openai-transcription-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 32 * 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
      agentDevAuthBypass: true,
    },
    memoryWorker: false,
    assetGc: false,
    openAITranscription: { fetchImpl },
  })
  await app.ready()
  const harness = { app, dataDir }
  harnesses.push(harness)
  return harness
}

async function seedOpenAIKey(app: FastifyInstance, openAIKey: string): Promise<void> {
  const initialized = await app.inject({ method: 'POST', url: '/api/v1/commands/state/initialize', payload: {} })
  expect(initialized.statusCode, initialized.body).toBe(200)
  const patched = await app.inject({
    method: 'PATCH',
    url: '/api/v1/commands/settings/providers',
    payload: { baseRevision: initialized.json().revision, patch: { openAIKey } },
  })
  expect(patched.statusCode, patched.body).toBe(200)
}

async function multipartFile(
  filename: string,
  body: string,
): Promise<{ payload: Buffer; headers: Record<string, string> }> {
  const form = new FormData()
  form.append('file', new Blob([body], { type: 'audio/mpeg' }), filename)
  const request = new Request('http://localhost/upload', { method: 'POST', body: form })
  return {
    payload: Buffer.from(await request.arrayBuffer()),
    headers: { 'content-type': request.headers.get('content-type')! },
  }
}

describe('POST /api/v1/media/openai/transcriptions', () => {
  it('loads the raw SQLite key without exposing it to the client', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(VTT))
    const harness = await startHarness(fetchImpl as typeof fetch)
    await seedOpenAIKey(harness.app, 'server-only-openai-key')
    const upload = await multipartFile('sample.mp3', 'audio')

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/media/openai/transcriptions',
      headers: upload.headers,
      payload: upload.payload,
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['content-type']).toContain('text/vtt')
    expect(response.body).toBe(VTT)
    expect(response.body).not.toContain('server-only-openai-key')
    expect(header(fetchImpl.mock.calls[0][1] as RequestInit, 'authorization')).toBe('Bearer server-only-openai-key')
  })

  it('rejects unsupported media before contacting OpenAI', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(VTT))
    const harness = await startHarness(fetchImpl as typeof fetch)
    await seedOpenAIKey(harness.app, 'server-only-openai-key')
    const upload = await multipartFile('sample.exe', 'not audio')

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/media/openai/transcriptions',
      headers: upload.headers,
      payload: upload.payload,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_openai_transcription_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
