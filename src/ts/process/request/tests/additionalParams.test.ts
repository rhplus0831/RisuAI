import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  additionalParams: [] as [string, string][],
  applyAdditionalParamsToAll: false,
  customModels: [] as Array<{ id: string; params?: string }>,
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => database,
}))

import { parseAdditionalParamJsonValue } from '../additionalParams'
import { getAdditionalParameters, getRequestAdditionalParameters } from '../shared'

beforeEach(() => {
  database.additionalParams = [['global', 'true']]
  database.applyAdditionalParamsToAll = false
  database.customModels = []
})

describe('parseAdditionalParamJsonValue', () => {
  it('parses standard JSON additional parameter values', () => {
    expect(parseAdditionalParamJsonValue('{"enable_thinking":true,"budget_tokens":0}')).toEqual({
      enable_thinking: true,
      budget_tokens: 0,
    })
  })

  it('accepts Python-style booleans and null in json:: values', () => {
    expect(
      parseAdditionalParamJsonValue('{"enable_thinking": True, "nested": {"flag": False, "value": None}}'),
    ).toEqual({
      enable_thinking: true,
      nested: {
        flag: false,
        value: null,
      },
    })
  })

  it('does not rewrite quoted keyword strings', () => {
    expect(
      parseAdditionalParamJsonValue('{"string_true": "True", "string_false": "False", "string_none": "None"}'),
    ).toEqual({
      string_true: 'True',
      string_false: 'False',
      string_none: 'None',
    })
  })

  it('returns undefined for invalid json:: payloads', () => {
    expect(parseAdditionalParamJsonValue('{"enable_thinking": Truthy}')).toBeUndefined()
  })
})

describe('getAdditionalParameters', () => {
  it('requires the literal opt-in for ordinary models', () => {
    expect(getAdditionalParameters('gpt-4o')).toEqual([])

    database.applyAdditionalParamsToAll = true
    expect(getAdditionalParameters('gpt-4o')).toEqual([['global', 'true']])
  })

  it('returns no parameters without a model', () => {
    database.applyAdditionalParamsToAll = true
    expect(getAdditionalParameters()).toEqual([])
  })

  it('keeps reverse-proxy and custom-model sources isolated from the opt-in', () => {
    database.customModels = [{ id: 'xcustom:::local', params: 'temperature=0.2\nheader::X-Custom=yes' }]

    expect(getAdditionalParameters('reverse_proxy')).toEqual([['global', 'true']])
    expect(getAdditionalParameters('xcustom:::local')).toEqual([
      ['temperature', '0.2'],
      ['header::X-Custom', 'yes'],
    ])
  })
})

describe('getRequestAdditionalParameters', () => {
  it('puts profile values after globals and lets profile extra headers keep precedence', () => {
    database.applyAdditionalParamsToAll = true
    database.additionalParams = [
      ['temperature', '0.8'],
      ['header::X-Shared', 'global'],
      ['header::X-Global', 'kept'],
    ]

    expect(
      getRequestAdditionalParameters(
        'gpt-4o',
        [
          ['temperature', '0.3'],
          ['profile_flag', 'true'],
        ],
        { 'x-shared': 'profile' },
      ),
    ).toEqual([
      ['temperature', '0.8'],
      ['header::X-Global', 'kept'],
      ['temperature', '0.3'],
      ['profile_flag', 'true'],
    ])
  })

  it('uses the resolved profile snapshot exclusively for special models', () => {
    database.applyAdditionalParamsToAll = true

    expect(getRequestAdditionalParameters('reverse_proxy', [['profile', 'true']])).toEqual([['profile', 'true']])
    expect(getRequestAdditionalParameters('xcustom:::local', [['custom', 'true']])).toEqual([['custom', 'true']])
  })
})
