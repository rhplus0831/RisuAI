import { describe, expect, it } from 'vitest'
import {
  OPENAI_TTS_FORMATS,
  TTS_SYNTHESIS_OPERATIONS,
  isTtsSynthesisOperation,
  isTtsSynthesisRequest,
} from '@risuai/protocol/tts-synthesis'

describe('TTS synthesis protocol', () => {
  it('publishes the complete operation and OpenAI format taxonomies', () => {
    expect(TTS_SYNTHESIS_OPERATIONS).toEqual([
      'elevenlabs.synthesize',
      'fish.synthesize',
      'huggingface.synthesize',
      'novelai.synthesize',
      'openai.synthesize',
    ])
    expect(OPENAI_TTS_FORMATS).toEqual(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'])
    for (const operation of TTS_SYNTHESIS_OPERATIONS) expect(isTtsSynthesisOperation(operation)).toBe(true)
    expect(isTtsSynthesisOperation('voicevox.synthesize')).toBe(false)
  })

  it.each([
    {
      operation: 'elevenlabs.synthesize',
      credential: { source: 'stored' },
      input: { text: 'hello', voiceId: 'voice-a' },
    },
    {
      operation: 'fish.synthesize',
      credential: { source: 'provided', apiKey: 'draft' },
      input: { text: 'hello', referenceId: 'voice-a', chunkLength: 200, normalize: true },
    },
    {
      operation: 'huggingface.synthesize',
      credential: { source: 'stored' },
      input: { text: 'hello', model: 'owner/model' },
    },
    {
      operation: 'novelai.synthesize',
      credential: { source: 'stored' },
      input: { text: 'hello', seed: 'Aini', version: 'v2' },
    },
    {
      operation: 'openai.synthesize',
      credential: { source: 'stored-character', characterId: 'char-1' },
      input: { text: 'hello' },
    },
    {
      operation: 'openai.synthesize',
      credential: { source: 'none' },
      input: {
        text: 'hello',
        config: { baseUrl: 'http://127.0.0.1:8080/v1', model: 'local-tts', voice: 'alloy', format: 'opus' },
      },
    },
  ] as const)('accepts the $operation request envelope', (request) => {
    expect(isTtsSynthesisRequest(request)).toBe(true)
  })

  it.each([
    { source: 'none' },
    { source: 'stored' },
    { source: 'provided', apiKey: 'draft' },
    { source: 'stored-character', characterId: 'char-1' },
  ] as const)('accepts the $source credential variant', (credential) => {
    expect(
      isTtsSynthesisRequest({
        operation: 'openai.synthesize',
        credential,
        input: { text: 'hello' },
      }),
    ).toBe(true)
  })

  it('rejects operation/input cross-pairings and unknown request fields', () => {
    expect(
      isTtsSynthesisRequest({
        operation: 'fish.synthesize',
        credential: { source: 'stored' },
        input: { text: 'hello', voiceId: 'voice-a' },
      }),
    ).toBe(false)
    expect(
      isTtsSynthesisRequest({
        operation: 'elevenlabs.synthesize',
        credential: { source: 'stored' },
        input: { text: 'hello', voiceId: 'voice-a' },
        url: 'https://attacker.example',
      }),
    ).toBe(false)
  })

  it('rejects malformed credentials and nested OpenAI configuration', () => {
    expect(
      isTtsSynthesisRequest({
        operation: 'openai.synthesize',
        credential: { source: 'stored', apiKey: 'unexpected' },
        input: { text: 'hello' },
      }),
    ).toBe(false)
    expect(
      isTtsSynthesisRequest({
        operation: 'openai.synthesize',
        credential: { source: 'none' },
        input: {
          text: 'hello',
          config: {
            baseUrl: 'http://127.0.0.1:8080/v1',
            model: 'local-tts',
            voice: 'alloy',
            format: 'ogg',
          },
        },
      }),
    ).toBe(false)
    expect(
      isTtsSynthesisRequest({
        operation: 'openai.synthesize',
        credential: { source: 'none' },
        input: {
          text: 'hello',
          config: {
            baseUrl: 'http://127.0.0.1:8080/v1',
            model: 'local-tts',
            voice: 'alloy',
            format: 'wav',
            headers: { authorization: 'secret' },
          },
        },
      }),
    ).toBe(false)
  })

  it('keeps all six OpenAI formats valid', () => {
    for (const format of OPENAI_TTS_FORMATS) {
      expect(
        isTtsSynthesisRequest({
          operation: 'openai.synthesize',
          credential: { source: 'provided', apiKey: 'draft' },
          input: {
            text: 'hello',
            config: { baseUrl: 'https://tts.example/v1', model: 'tts', voice: 'alloy', format },
          },
        }),
      ).toBe(true)
    }
  })
})
