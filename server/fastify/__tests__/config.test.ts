import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { DEFAULT_GENERATION_TRACE_MAX_GZIP_BYTES } from '../src/generation/generationTraceSidecar.js'

const BASE_ENV = { RISU_API_DATA_DIR: '/tmp/risu-config-test' }

describe('loadConfig importMaxBytes', () => {
  it('defaults to unlimited so large backups import without per-deployment tuning', () => {
    expect(loadConfig({ ...BASE_ENV }).importMaxBytes).toBe(Number.POSITIVE_INFINITY)
  })

  it('treats 0 / unlimited / none / infinity as an explicit no-ceiling opt-out', () => {
    for (const raw of ['0', 'unlimited', 'UNLIMITED', 'none', ' Infinity ']) {
      expect(loadConfig({ ...BASE_ENV, RISU_API_IMPORT_MAX_BYTES: raw }).importMaxBytes).toBe(Number.POSITIVE_INFINITY)
    }
  })

  it('accepts a finite positive byte ceiling', () => {
    expect(loadConfig({ ...BASE_ENV, RISU_API_IMPORT_MAX_BYTES: '8000000000' }).importMaxBytes).toBe(8000000000)
  })

  it('rejects non-positive or non-numeric ceilings', () => {
    for (const raw of ['abc', '-1']) {
      expect(() => loadConfig({ ...BASE_ENV, RISU_API_IMPORT_MAX_BYTES: raw })).toThrow(
        /Invalid RISU_API_IMPORT_MAX_BYTES/,
      )
    }
  })
})

describe('loadConfig request trace', () => {
  it('leaves request tracing disabled by default', () => {
    expect(loadConfig({ ...BASE_ENV }).requestTrace).toBeUndefined()
  })

  it('enables agent and human request trace modes', () => {
    expect(loadConfig({ ...BASE_ENV, RISU_API_TRACE_MODE: 'agent' }).requestTrace).toEqual({ mode: 'agent' })
    expect(loadConfig({ ...BASE_ENV, RISU_API_TRACE_MODE: 'human' }).requestTrace).toEqual({ mode: 'human' })
  })

  it('accepts explicit off values', () => {
    for (const raw of ['0', 'false', 'off', 'none']) {
      expect(loadConfig({ ...BASE_ENV, RISU_API_TRACE_MODE: raw }).requestTrace).toBeUndefined()
    }
  })

  it('rejects unknown request trace modes', () => {
    expect(() => loadConfig({ ...BASE_ENV, RISU_API_TRACE_MODE: 'debug' })).toThrow(/Invalid RISU_API_TRACE_MODE/)
  })
})

describe('loadConfig generation trace', () => {
  it('leaves full prompt sidecars disabled by default with the default cap', () => {
    expect(loadConfig({ ...BASE_ENV }).generationTrace).toEqual({
      fullPrompt: false,
      maxGzipBytes: DEFAULT_GENERATION_TRACE_MAX_GZIP_BYTES,
    })
  })

  it('enables full prompt sidecars only with the explicit flag', () => {
    expect(loadConfig({ ...BASE_ENV, RISU_GENERATION_TRACE_FULL_PROMPT: '1' }).generationTrace).toEqual({
      fullPrompt: true,
      maxGzipBytes: DEFAULT_GENERATION_TRACE_MAX_GZIP_BYTES,
    })
  })

  it('accepts a custom gzip cap', () => {
    expect(
      loadConfig({
        ...BASE_ENV,
        RISU_GENERATION_TRACE_FULL_PROMPT: '1',
        RISU_GENERATION_TRACE_FULL_PROMPT_MAX_GZIP_BYTES: '4096',
      }).generationTrace,
    ).toEqual({ fullPrompt: true, maxGzipBytes: 4096 })
  })

  it('rejects invalid gzip caps', () => {
    for (const raw of ['0', '-1', '1.5', 'abc']) {
      expect(() => loadConfig({ ...BASE_ENV, RISU_GENERATION_TRACE_FULL_PROMPT_MAX_GZIP_BYTES: raw })).toThrow(
        /Invalid RISU_GENERATION_TRACE_FULL_PROMPT_MAX_GZIP_BYTES/,
      )
    }
  })
})
