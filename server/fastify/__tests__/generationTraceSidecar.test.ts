import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  generationTraceSidecarMetricField,
  writeGenerationTraceSidecar,
  type GenerationTraceSidecarEntry,
} from '../src/generation/generationTraceSidecar.js'

function readSidecar(dataDir: string, entry: GenerationTraceSidecarEntry | undefined): string {
  expect(entry).toMatchObject({ status: 'written', path: expect.stringMatching(/^trace\/generation\/.+\.json\.gz$/) })
  const written = entry as Extract<GenerationTraceSidecarEntry, { status: 'written' }>
  return gunzipSync(readFileSync(path.join(dataDir, written.path))).toString('utf8')
}

afterEach(() => {
  delete process.env.RISU_PROTOCOL_METRICS
})

describe('generation trace sidecar redaction', () => {
  it('redacts consecutive PEM private-key strings from sidecars and metric fields', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-generation-trace-sidecar-'))
    const firstPem = [
      '-----BEGIN PRIVATE KEY-----',
      'FIRST_PRIVATE_KEY_MATERIAL_MUST_NOT_LEAK',
      '-----END PRIVATE KEY-----',
    ].join('\n')
    const secondPem = [
      '-----BEGIN PRIVATE KEY-----',
      'SECOND_PRIVATE_KEY_MATERIAL_MUST_NOT_LEAK',
      '-----END PRIVATE KEY-----',
    ].join('\n')

    process.env.RISU_PROTOCOL_METRICS = '1'

    try {
      const entry = await writeGenerationTraceSidecar({
        context: {
          dataDir,
          options: { fullPrompt: true, maxGzipBytes: 10 * 1024 * 1024 },
          generationId: 'pem-redaction',
        },
        kind: 'provider',
        value: {
          first: firstPem,
          second: secondPem,
          pair: [firstPem, secondPem],
          visible: 'visible prompt text',
        },
      })

      const sidecarText = readSidecar(dataDir, entry)
      const metricLine = `[protocol-metric] ${JSON.stringify({
        metric: 'generation_provider_request_body',
        ...generationTraceSidecarMetricField('providerBodySidecar', entry),
      })}`

      expect(JSON.parse(sidecarText)).toEqual({
        first: '[redacted]',
        second: '[redacted]',
        pair: ['[redacted]', '[redacted]'],
        visible: 'visible prompt text',
      })
      expect(`${sidecarText}\n${metricLine}`).not.toContain('FIRST_PRIVATE_KEY_MATERIAL_MUST_NOT_LEAK')
      expect(`${sidecarText}\n${metricLine}`).not.toContain('SECOND_PRIVATE_KEY_MATERIAL_MUST_NOT_LEAK')
      expect(`${sidecarText}\n${metricLine}`).not.toContain('-----BEGIN PRIVATE KEY-----')
      expect(`${sidecarText}\n${metricLine}`).not.toContain('-----END PRIVATE KEY-----')
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
