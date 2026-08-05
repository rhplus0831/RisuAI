import { describe, expect, it } from 'vitest'
import { MASKED_PROVIDER_SECRET } from '../providerSecretMask'
import { normalizeProviderCredentials, readProviderCredentials } from './providerCredentialRecords'

describe('provider credential records', () => {
  it('leniently normalizes persisted credentials and drops invalid rows', () => {
    expect(
      normalizeProviderCredentials([
        { id: ' cred-api ', name: ' OpenAI ', type: 'apiKey', apiKey: ' sk-test ' },
        {
          id: ' cred-vertex ',
          name: ' Vertex ',
          type: 'vertexServiceAccount',
          vertex: { clientEmail: ' service@example.com ', privateKey: ' private-key ' },
        },
        { id: 'cred-api', name: 'Duplicate', type: 'apiKey', apiKey: 'duplicate' },
        { id: 'missing-secret', name: 'Missing', type: 'apiKey', apiKey: ' ' },
        { id: 'bad-type', name: 'Bad', type: 'unknown', apiKey: 'secret' },
        'bad-row',
      ]),
    ).toEqual([
      { id: 'cred-api', name: 'OpenAI', type: 'apiKey', apiKey: 'sk-test' },
      {
        id: 'cred-vertex',
        name: 'Vertex',
        type: 'vertexServiceAccount',
        vertex: { clientEmail: 'service@example.com', privateKey: 'private-key' },
      },
    ])
  })

  it('strictly validates both credential types', () => {
    expect(
      readProviderCredentials([
        { id: ' cred-api ', name: ' OpenAI ', type: 'apiKey', apiKey: ' sk-test ' },
        {
          id: ' cred-vertex ',
          name: ' Vertex ',
          type: 'vertexServiceAccount',
          vertex: { clientEmail: ' service@example.com ', privateKey: ' private-key ' },
        },
      ]),
    ).toEqual([
      { id: 'cred-api', name: 'OpenAI', type: 'apiKey', apiKey: 'sk-test' },
      {
        id: 'cred-vertex',
        name: 'Vertex',
        type: 'vertexServiceAccount',
        vertex: { clientEmail: 'service@example.com', privateKey: 'private-key' },
      },
    ])
  })

  it('drops whole credential rows containing masked secret placeholders and keeps every other valid row', () => {
    expect(
      normalizeProviderCredentials([
        { id: 'valid-before', name: 'Valid Before', type: 'apiKey', apiKey: 'real-api-key' },
        { id: 'masked-api', name: 'Masked API', type: 'apiKey', apiKey: MASKED_PROVIDER_SECRET },
        {
          id: 'masked-private-key',
          name: 'Masked Private Key',
          type: 'vertexServiceAccount',
          vertex: { clientEmail: 'service@example.com', privateKey: MASKED_PROVIDER_SECRET },
        },
        {
          id: 'masked-client-email',
          name: 'Masked Client Email',
          type: 'vertexServiceAccount',
          vertex: { clientEmail: MASKED_PROVIDER_SECRET, privateKey: 'real-private-key' },
        },
        {
          id: 'valid-after',
          name: 'Valid After',
          type: 'vertexServiceAccount',
          vertex: { clientEmail: 'other@example.com', privateKey: 'other-private-key' },
        },
      ]),
    ).toEqual([
      { id: 'valid-before', name: 'Valid Before', type: 'apiKey', apiKey: 'real-api-key' },
      {
        id: 'valid-after',
        name: 'Valid After',
        type: 'vertexServiceAccount',
        vertex: { clientEmail: 'other@example.com', privateKey: 'other-private-key' },
      },
    ])
  })

  it('rejects invalid shapes and duplicate ids', () => {
    expect(() => readProviderCredentials({})).toThrow('providerCredentials must be an array')
    expect(() =>
      readProviderCredentials([
        { id: 'cred-a', name: 'A', type: 'apiKey', apiKey: 'one' },
        { id: ' cred-a ', name: 'B', type: 'apiKey', apiKey: 'two' },
      ]),
    ).toThrow('Duplicate provider credential id: cred-a')
    expect(() => readProviderCredentials([{ id: 'cred-a', name: 'A', type: 'apiKey', apiKey: ' ' }])).toThrow(
      'providerCredentials[0].apiKey must be a non-empty string',
    )
    expect(() =>
      readProviderCredentials([
        {
          id: 'cred-v',
          name: 'Vertex',
          type: 'vertexServiceAccount',
          vertex: { clientEmail: '', privateKey: 'key' },
        },
      ]),
    ).toThrow('providerCredentials[0].vertex.clientEmail must be a non-empty string')
    expect(() =>
      readProviderCredentials([{ id: 'cred-a', name: 'A', type: 'apiKey', apiKey: 'secret', vertex: {} }]),
    ).toThrow('providerCredentials[0].vertex is only supported for vertexServiceAccount')
  })
})
