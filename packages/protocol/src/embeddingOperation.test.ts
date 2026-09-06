import { describe, expect, it } from 'vitest'
import {
  CONTEXTUAL_REMOTE_EMBEDDING_MODELS,
  REMOTE_EMBEDDING_MODELS,
  isContextualRemoteEmbeddingModel,
  isEmbeddingOperationRequest,
  isEmbeddingOperationSuccess,
  isRemoteEmbeddingModel,
} from '@risuai/protocol/embedding-operation'

describe('embedding operation protocol', () => {
  it('publishes the complete remote and contextual model taxonomies', () => {
    expect(REMOTE_EMBEDDING_MODELS).toEqual([
      'custom',
      'ada',
      'openai3small',
      'openai3large',
      'voyageContext3',
      'voyageContext4',
    ])
    expect(CONTEXTUAL_REMOTE_EMBEDDING_MODELS).toEqual(['voyageContext3', 'voyageContext4'])
    for (const model of REMOTE_EMBEDDING_MODELS) expect(isRemoteEmbeddingModel(model)).toBe(true)
    for (const model of CONTEXTUAL_REMOTE_EMBEDDING_MODELS) expect(isContextualRemoteEmbeddingModel(model)).toBe(true)
  })

  it.each([
    {
      operation: 'texts',
      model: 'openai3small',
      inputType: 'document',
      input: ['first'],
      credential: { source: 'stored' },
    },
    {
      operation: 'texts',
      model: 'custom',
      inputType: 'query',
      input: ['first'],
      credential: { source: 'provided', apiKey: 'draft-key' },
      custom: { source: 'provided', url: 'https://embedding.example/v1', model: 'custom-model' },
    },
    {
      operation: 'groups',
      model: 'voyageContext4',
      inputType: 'query',
      groups: [['first', 'second']],
      credential: { source: 'none' },
    },
  ] as const)('accepts the $operation/$model request shape', (request) => {
    expect(isEmbeddingOperationRequest(request)).toBe(true)
  })

  it('rejects invalid model/discriminator pairings and custom configuration placement', () => {
    expect(
      isEmbeddingOperationRequest({
        operation: 'groups',
        model: 'openai3small',
        inputType: 'document',
        groups: [['first']],
        credential: { source: 'stored' },
      }),
    ).toBe(false)
    expect(
      isEmbeddingOperationRequest({
        operation: 'texts',
        model: 'voyageContext3',
        inputType: 'document',
        input: ['first'],
        credential: { source: 'stored' },
      }),
    ).toBe(false)
    expect(
      isEmbeddingOperationRequest({
        operation: 'texts',
        model: 'custom',
        inputType: 'document',
        input: ['first'],
        credential: { source: 'stored' },
      }),
    ).toBe(false)
    expect(
      isEmbeddingOperationRequest({
        operation: 'texts',
        model: 'ada',
        inputType: 'document',
        input: ['first'],
        credential: { source: 'stored' },
        custom: { source: 'stored' },
      }),
    ).toBe(false)
  })

  it('rejects empty inputs, unknown fields, and malformed credentials', () => {
    expect(
      isEmbeddingOperationRequest({
        operation: 'texts',
        model: 'ada',
        inputType: 'document',
        input: [],
        credential: { source: 'stored' },
      }),
    ).toBe(false)
    expect(
      isEmbeddingOperationRequest({
        operation: 'groups',
        model: 'voyageContext3',
        inputType: 'document',
        groups: [[]],
        credential: { source: 'stored' },
      }),
    ).toBe(false)
    expect(
      isEmbeddingOperationRequest({
        operation: 'texts',
        model: 'ada',
        inputType: 'document',
        input: ['first'],
        credential: { source: 'stored', apiKey: 'unexpected' },
      }),
    ).toBe(false)
  })

  it('validates vector nesting and dimension coherence for both results', () => {
    expect(isEmbeddingOperationSuccess({ operation: 'texts', model: 'ada', dimension: 2, vectors: [[1, 2]] })).toBe(
      true,
    )
    expect(
      isEmbeddingOperationSuccess({ operation: 'groups', model: 'voyage', dimension: 2, groups: [[[1, 2]]] }),
    ).toBe(true)
    expect(isEmbeddingOperationSuccess({ operation: 'texts', model: 'ada', dimension: 2, vectors: [[1]] })).toBe(false)
    expect(
      isEmbeddingOperationSuccess({
        operation: 'groups',
        model: 'voyage',
        dimension: 2,
        groups: [[[1, Number.NaN]]],
      }),
    ).toBe(false)
  })
})
