import { describe, expect, it } from 'vitest'
import {
  MASKED_PROVIDER_SECRET,
  resolveMaskedProviderSecretPlaceholders,
} from '../src/providerSecrets.js'

describe('provider secret masking', () => {
  it('restores bot preset masked secrets by preset id after reorder', () => {
    const resolved = resolveMaskedProviderSecretPlaceholders(
      {
        botPresets: [
          { id: 'preset-a', name: 'A', openAIKey: 'openai-a', proxyKey: 'proxy-a' },
          { id: 'preset-b', name: 'B', openAIKey: 'openai-b', proxyKey: 'proxy-b' },
        ],
      },
      {
        botPresets: [
          {
            id: 'preset-b',
            name: 'B renamed',
            openAIKey: MASKED_PROVIDER_SECRET,
            proxyKey: MASKED_PROVIDER_SECRET,
          },
          {
            id: 'preset-a',
            name: 'A renamed',
            openAIKey: MASKED_PROVIDER_SECRET,
            proxyKey: MASKED_PROVIDER_SECRET,
          },
        ],
      },
    )

    expect(resolved.botPresets).toEqual([
      { id: 'preset-b', name: 'B renamed', openAIKey: 'openai-b', proxyKey: 'proxy-b' },
      { id: 'preset-a', name: 'A renamed', openAIKey: 'openai-a', proxyKey: 'proxy-a' },
    ])
  })

  it('rejects bot preset masked placeholders when row identity is missing', () => {
    expect(() =>
      resolveMaskedProviderSecretPlaceholders(
        {
          botPresets: [{ id: 'preset-a', name: 'A', openAIKey: 'openai-a' }],
        },
        {
          botPresets: [{ name: 'A without id', openAIKey: MASKED_PROVIDER_SECRET }],
        },
      ),
    ).toThrow('without id')
  })

  it('restores character-owned TTS secrets by character id', () => {
    const resolved = resolveMaskedProviderSecretPlaceholders(
      {
        characters: [
          { chaId: 'char-a', name: 'A', oaiTTSConfig: { apiKey: 'tts-a' } },
          { chaId: 'char-b', name: 'B', oaiTTSConfig: { apiKey: 'tts-b' } },
        ],
      },
      {
        characters: [
          { chaId: 'char-b', name: 'B renamed', oaiTTSConfig: { apiKey: MASKED_PROVIDER_SECRET } },
          { chaId: 'char-a', name: 'A renamed', oaiTTSConfig: { apiKey: MASKED_PROVIDER_SECRET } },
        ],
      },
    )

    expect(resolved.characters).toEqual([
      { chaId: 'char-b', name: 'B renamed', oaiTTSConfig: { apiKey: 'tts-b' } },
      { chaId: 'char-a', name: 'A renamed', oaiTTSConfig: { apiKey: 'tts-a' } },
    ])
  })
})
