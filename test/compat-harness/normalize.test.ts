import { describe, expect, it } from 'vitest'
import { FIXTURE_CHARACTER_ID, MOCK_OPENAI_KEY } from './fixture'
import { captureProviderRequest, normalizeTranscript } from './normalize'

describe('compatibility harness normalizer contract', () => {
  it('normalizes only documented IDs and non-null timestamps while preserving null, missing, roles, and metadata', () => {
    const normalized = normalizeTranscript([
      {
        role: 'tool',
        data: 'first',
        chatId: 'generated-a',
        saying: FIXTURE_CHARACTER_ID,
        time: 123,
        name: null,
        metadata: { z: 1, a: null, order: ['second', 'first', 'first'] },
        generationInfo: {
          generationId: 'generated-a',
          operationId: 'generated-b',
          unrelatedId: 'must-not-normalize',
          arbitrary: { z: false, a: true },
        },
      },
      { role: 'user', data: 'null timestamp', chatId: 'generated-b', time: null },
      { role: 'char', data: 'missing timestamp', chatId: 'generated-a' },
    ])

    expect(normalized).toEqual([
      {
        chatId: '<generated-id-1>',
        data: 'first',
        generationInfo: {
          arbitrary: { a: true, z: false },
          generationId: '<generated-id-1>',
          operationId: '<generated-id-2>',
          unrelatedId: 'must-not-normalize',
        },
        metadata: { a: null, order: ['second', 'first', 'first'], z: 1 },
        name: null,
        role: 'tool',
        saying: FIXTURE_CHARACTER_ID,
        time: '<present>',
      },
      { chatId: '<generated-id-2>', data: 'null timestamp', role: 'user', time: null },
      { chatId: '<generated-id-1>', data: 'missing timestamp', role: 'char' },
    ])
    expect('time' in normalized[2]).toBe(false)
  })

  it('preserves endpoints, headers, array order, repetitions, roles, nulls, and arbitrary request metadata', () => {
    const captured = captureProviderRequest('https://gateway.example/v9/custom-endpoint?route=blue', {
      method: 'post',
      headers: {
        Authorization: `Bearer ${MOCK_OPENAI_KEY}; duplicate=${MOCK_OPENAI_KEY}`,
        'X-Arbitrary-Metadata': 'keep-me',
      },
      body: JSON.stringify({
        z: null,
        messages: [
          { role: 'system', content: 'same' },
          { role: 'tool', content: 'same' },
          { role: 'tool', content: 'same' },
        ],
        metadata: { z: 2, a: 1 },
      }),
    })

    expect(captured).toEqual({
      url: 'https://gateway.example/v9/custom-endpoint?route=blue',
      method: 'post',
      headers: {
        authorization: 'Bearer <redacted>; duplicate=<redacted>',
        'x-arbitrary-metadata': 'keep-me',
      },
      body: {
        messages: [
          { content: 'same', role: 'system' },
          { content: 'same', role: 'tool' },
          { content: 'same', role: 'tool' },
        ],
        metadata: { a: 1, z: 2 },
        z: null,
      },
    })
  })

  it.each([
    ['missing versus null', [{ role: 'user', data: 'x' }], [{ role: 'user', data: 'x', name: null }]],
    [
      'message order and repetition',
      [
        { role: 'user', data: 'a' },
        { role: 'char', data: 'b' },
        { role: 'char', data: 'b' },
      ],
      [
        { role: 'char', data: 'b' },
        { role: 'user', data: 'a' },
        { role: 'char', data: 'b' },
      ],
    ],
    ['role', [{ role: 'user', data: 'x' }], [{ role: 'char', data: 'x' }]],
    [
      'arbitrary metadata',
      [{ role: 'user', data: 'x', metadata: { retained: true } }],
      [{ role: 'user', data: 'x', metadata: { retained: false } }],
    ],
  ])('does not erase a %s mutation', (_label, left, right) => {
    expect(normalizeTranscript(left)).not.toEqual(normalizeTranscript(right))
  })

  it('does not erase an endpoint mutation', () => {
    const request = (url: string) => captureProviderRequest(url, { method: 'POST', body: '{}' })
    expect(request('https://one.example/v1')).not.toEqual(request('https://two.example/v1'))
  })
})
