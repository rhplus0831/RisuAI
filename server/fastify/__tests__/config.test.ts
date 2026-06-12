import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

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
