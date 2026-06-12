import { describe, expect, it } from 'vitest'
import {
  applyAdditionalParameters,
  coerceAdditionalParams,
  parseAdditionalParamJsonValue,
} from '../src/generation/additionalParams.js'

describe('parseAdditionalParamJsonValue', () => {
  it('parses strict JSON', () => {
    expect(parseAdditionalParamJsonValue('{"a": 1}')).toEqual({ a: 1 })
    expect(parseAdditionalParamJsonValue('[1, 2, 3]')).toEqual([1, 2, 3])
    expect(parseAdditionalParamJsonValue('42')).toBe(42)
  })

  it('normalizes Python-style True/False/None to JSON', () => {
    expect(parseAdditionalParamJsonValue('{"flag": True}')).toEqual({ flag: true })
    expect(parseAdditionalParamJsonValue('{"flag": False}')).toEqual({ flag: false })
    expect(parseAdditionalParamJsonValue('{"value": None}')).toEqual({ value: null })
  })

  it('leaves quoted True/False/None inside JSON strings untouched', () => {
    expect(parseAdditionalParamJsonValue('"True"')).toBe('True')
    expect(parseAdditionalParamJsonValue('{"k": "False is fine"}')).toEqual({
      k: 'False is fine',
    })
  })

  it('returns undefined when the value is unparseable even after relaxation', () => {
    expect(parseAdditionalParamJsonValue('not json at all')).toBeUndefined()
    expect(parseAdditionalParamJsonValue('')).toBeUndefined()
  })
})

describe('applyAdditionalParameters DSL', () => {
  function setup(): { body: Record<string, unknown>; headers: Record<string, string> } {
    return {
      body: {
        model: 'gpt-x',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.7,
      },
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer original',
      },
    }
  }

  it('skips entries with empty key or value', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [
      ['', 'x'],
      ['key', ''],
    ])
    expect(body).toEqual({
      model: 'gpt-x',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
    })
    expect(headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer original',
    })
  })

  it('sets a header via the header:: key prefix', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [['header::X-Custom', 'hello']])
    expect(headers['X-Custom']).toBe('hello')
  })

  it('removes a header when value is {{none}}', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [['header::authorization', '{{none}}']])
    expect(headers.authorization).toBeUndefined()
  })

  it('removes a top-level body field when value is {{none}}', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [['temperature', '{{none}}']])
    expect(body.temperature).toBeUndefined()
  })

  it('coerces numeric strings to numbers', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [['top_p', '0.9']])
    expect(body.top_p).toBe(0.9)
  })

  it('coerces "true" / "false" / "null" to typed values', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [
      ['stream_options.include_usage', 'true'],
      ['safe_mode', 'false'],
      ['suffix', 'null'],
    ])
    expect((body.stream_options as Record<string, unknown>).include_usage).toBe(true)
    expect(body.safe_mode).toBe(false)
    expect(body.suffix).toBeNull()
  })

  it('treats single- or double-quoted values as literal strings (preserves embedded "=")', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [
      ['title', '"hello=world"'],
      ['sub', "'single quoted'"],
    ])
    expect(body.title).toBe('hello=world')
    expect(body.sub).toBe('single quoted')
  })

  it('JSON-parses json:: values (strict)', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [['extra.nested', 'json::{"arr": [1, 2, 3]}']])
    expect(body.extra).toEqual({ nested: { arr: [1, 2, 3] } })
  })

  it('JSON-parses json:: values with relaxed True/False/None', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [['extra.flag', 'json::{"on": True}']])
    expect(body.extra).toEqual({ flag: { on: true } })
  })

  it('silently skips json:: values that cannot be parsed', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [['extra.bad', 'json::not actually json']])
    // setObjectValue was never called for this entry
    expect(body.extra).toBeUndefined()
  })

  it('falls back to a plain string when Number(value) is NaN and not bool/null/quoted/json', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [['stop_word', 'banana']])
    expect(body.stop_word).toBe('banana')
  })

  it('overrides existing top-level fields', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [['temperature', '0.0']])
    expect(body.temperature).toBe(0)
  })

  it('creates intermediate objects for dot-path keys', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [['a.b.c', '5']])
    expect(body.a).toEqual({ b: { c: 5 } })
  })

  it('preserves an existing intermediate object instead of overwriting it', () => {
    const { body, headers } = setup()
    body.a = { existing: 'value' }
    applyAdditionalParameters(body, headers, [['a.added', '1']])
    expect(body.a).toEqual({ existing: 'value', added: 1 })
  })

  it('applies entries in order; later entries can override earlier ones', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [
      ['x', '1'],
      ['x', '2'],
      ['x', '{{none}}'],
    ])
    expect(body.x).toBeUndefined()
  })

  it('L24: setObjectValue cannot pollute Object.prototype via dotted prototype keys', () => {
    const { body, headers } = setup()
    applyAdditionalParameters(body, headers, [
      // Walks to Object.prototype then writes onto it without the guard.
      ['__proto__.polluted', '"yes"'],
      ['a.__proto__.polluted', '"yes"'],
      ['constructor.prototype.polluted', '"yes"'],
      ['a.constructor.prototype.polluted', 'json::{"deep": true}'],
      // Single-segment prototype keys are dropped too (they would flip the
      // body's prototype rather than set a data field).
      ['__proto__', 'json::{"polluted": "yes"}'],
    ])
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('polluted')
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype)
    // The guard drops the entry whole — no partial intermediate objects.
    expect(body.a).toBeUndefined()
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'temperature'])
  })
})

describe('coerceAdditionalParams', () => {
  it('returns null for undefined / null', () => {
    expect(coerceAdditionalParams(undefined)).toBeNull()
    expect(coerceAdditionalParams(null)).toBeNull()
  })

  it('returns null when the outer value is not an array', () => {
    expect(coerceAdditionalParams('oops')).toBeNull()
    expect(coerceAdditionalParams({})).toBeNull()
  })

  it('returns null when any entry is not a two-string tuple', () => {
    expect(coerceAdditionalParams([['k', 1]])).toBeNull()
    expect(coerceAdditionalParams([['k']])).toBeNull()
    expect(coerceAdditionalParams([['k', 'v', 'extra']])).toBeNull()
    expect(coerceAdditionalParams([null])).toBeNull()
  })

  it('returns the coerced array when shape is valid', () => {
    expect(
      coerceAdditionalParams([
        ['header::X', 'y'],
        ['top_p', '0.9'],
      ]),
    ).toEqual([
      ['header::X', 'y'],
      ['top_p', '0.9'],
    ])
  })

  it('accepts an empty array', () => {
    expect(coerceAdditionalParams([])).toEqual([])
  })
})
