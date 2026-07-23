import { describe, expect, it } from 'vitest'
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
