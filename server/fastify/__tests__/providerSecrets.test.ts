import { describe, expect, it } from 'vitest'
import {
  MASKED_PROVIDER_SECRET,
  maskProviderSecrets,
  maskProviderSecretsInPlace,
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

  it('restores model preset and custom model masked secrets by stable row id after reorder', () => {
    const resolved = resolveMaskedProviderSecretPlaceholders(
      {
        modelPresets: [
          { id: 'model-a', name: 'A', openAIKey: 'openai-a', proxyKey: 'proxy-a' },
          { id: 'model-b', name: 'B', openAIKey: 'openai-b', proxyKey: 'proxy-b' },
        ],
        customModels: [
          { id: 'xcustom:::a', name: 'Custom A', key: 'custom-a' },
          { id: 'xcustom:::b', name: 'Custom B', key: 'custom-b' },
        ],
      },
      {
        modelPresets: [
          {
            id: 'model-b',
            name: 'B renamed',
            openAIKey: MASKED_PROVIDER_SECRET,
            proxyKey: MASKED_PROVIDER_SECRET,
          },
          {
            id: 'model-a',
            name: 'A renamed',
            openAIKey: MASKED_PROVIDER_SECRET,
            proxyKey: MASKED_PROVIDER_SECRET,
          },
        ],
        customModels: [
          { id: 'xcustom:::b', name: 'Custom B renamed', key: MASKED_PROVIDER_SECRET },
          { id: 'xcustom:::a', name: 'Custom A renamed', key: MASKED_PROVIDER_SECRET },
        ],
      },
    )

    expect(resolved.modelPresets).toEqual([
      { id: 'model-b', name: 'B renamed', openAIKey: 'openai-b', proxyKey: 'proxy-b' },
      { id: 'model-a', name: 'A renamed', openAIKey: 'openai-a', proxyKey: 'proxy-a' },
    ])
    expect(resolved.customModels).toEqual([
      { id: 'xcustom:::b', name: 'Custom B renamed', key: 'custom-b' },
      { id: 'xcustom:::a', name: 'Custom A renamed', key: 'custom-a' },
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

  it('masks and restores model profile API keys by profile id after reorder', () => {
    const database = {
      modelProfiles: [
        { id: 'profile-a', name: 'A', providerOptions: { apiKey: 'profile-a-key', requestModel: 'a-wire' } },
        { id: 'profile-b', name: 'B', providerOptions: { apiKey: 'profile-b-key', requestModel: 'b-wire' } },
        { id: 'profile-c', name: 'C', providerOptions: { apiKey: '', requestModel: 'c-wire' } },
      ],
    }

    expect(maskProviderSecrets(database)).toEqual({
      modelProfiles: [
        { id: 'profile-a', name: 'A', providerOptions: { apiKey: MASKED_PROVIDER_SECRET, requestModel: 'a-wire' } },
        { id: 'profile-b', name: 'B', providerOptions: { apiKey: MASKED_PROVIDER_SECRET, requestModel: 'b-wire' } },
        { id: 'profile-c', name: 'C', providerOptions: { apiKey: '', requestModel: 'c-wire' } },
      ],
    })

    const resolved = resolveMaskedProviderSecretPlaceholders(database, {
      modelProfiles: [
        {
          id: 'profile-b',
          name: 'B renamed',
          providerOptions: { apiKey: MASKED_PROVIDER_SECRET, requestModel: 'b-new-wire' },
        },
        {
          id: 'profile-a',
          name: 'A renamed',
          providerOptions: { apiKey: MASKED_PROVIDER_SECRET, requestModel: 'a-new-wire' },
        },
      ],
    })

    expect(resolved.modelProfiles).toEqual([
      { id: 'profile-b', name: 'B renamed', providerOptions: { apiKey: 'profile-b-key', requestModel: 'b-new-wire' } },
      { id: 'profile-a', name: 'A renamed', providerOptions: { apiKey: 'profile-a-key', requestModel: 'a-new-wire' } },
    ])
  })

  it('rejects model profile masked placeholders without a profile id', () => {
    expect(() =>
      resolveMaskedProviderSecretPlaceholders(
        {
          modelProfiles: [{ id: 'profile-a', name: 'A', providerOptions: { apiKey: 'profile-a-key' } }],
        },
        {
          modelProfiles: [{ name: 'A without id', providerOptions: { apiKey: MASKED_PROVIDER_SECRET } }],
        },
      ),
    ).toThrow('without id')
  })

  it('rejects model profile masked placeholders for duplicate or unknown profile ids', () => {
    expect(() =>
      resolveMaskedProviderSecretPlaceholders(
        {
          modelProfiles: [{ id: 'profile-a', name: 'A', providerOptions: { apiKey: 'profile-a-key' } }],
        },
        {
          modelProfiles: [
            { id: 'profile-a', name: 'A one', providerOptions: { apiKey: MASKED_PROVIDER_SECRET } },
            { id: 'profile-a', name: 'A two', providerOptions: { apiKey: MASKED_PROVIDER_SECRET } },
          ],
        },
      ),
    ).toThrow('Duplicate modelProfiles row identity: profile-a')

    expect(() =>
      resolveMaskedProviderSecretPlaceholders(
        {
          modelProfiles: [{ id: 'profile-a', name: 'A', providerOptions: { apiKey: 'profile-a-key' } }],
        },
        {
          modelProfiles: [
            { id: 'profile-missing', name: 'Missing', providerOptions: { apiKey: MASKED_PROVIDER_SECRET } },
          ],
        },
      ),
    ).toThrow('Cannot resolve masked provider secret for unknown modelProfiles row: profile-missing')
  })
})

describe('maskProviderSecretsInPlace (M4)', () => {
  const sample = () => ({
    openAIKey: 'sk-top',
    aiModel: 'gpt4o-chatgpt',
    OaiCompAPIKeys: { deepseek: 'ds-key' },
    botPresets: [{ id: 'preset-a', openAIKey: 'sk-preset', proxyKey: 'proxy-key' }],
    modelPresets: [{ id: 'model-a', openAIKey: 'sk-model-preset', proxyKey: 'model-proxy-key' }],
    modelProfiles: [{ id: 'profile-a', providerOptions: { apiKey: 'sk-profile' } }],
    customModels: [{ id: 'xcustom:::a', key: 'custom-key' }],
    characters: [{ chaId: 'char-a', name: 'Ada', oaiTTSConfig: { apiKey: 'tts-key' } }],
  })

  it('produces the same masked output as the copying variant', () => {
    const inPlace = maskProviderSecretsInPlace(sample())
    const copying = maskProviderSecrets(sample())
    expect(JSON.stringify(inPlace)).toBe(JSON.stringify(copying))
    expect(inPlace.openAIKey).toBe(MASKED_PROVIDER_SECRET)
    expect(inPlace.OaiCompAPIKeys.deepseek).toBe(MASKED_PROVIDER_SECRET)
    expect(inPlace.botPresets[0].openAIKey).toBe(MASKED_PROVIDER_SECRET)
    expect(inPlace.modelPresets[0].openAIKey).toBe(MASKED_PROVIDER_SECRET)
    expect(inPlace.modelPresets[0].proxyKey).toBe(MASKED_PROVIDER_SECRET)
    expect(inPlace.modelProfiles[0].providerOptions.apiKey).toBe(MASKED_PROVIDER_SECRET)
    expect(inPlace.customModels[0].key).toBe(MASKED_PROVIDER_SECRET)
    expect(inPlace.characters[0].oaiTTSConfig.apiKey).toBe(MASKED_PROVIDER_SECRET)
    expect(inPlace.aiModel).toBe('gpt4o-chatgpt')
  })

  it('mutates its owned argument, while the copying variant leaves the source intact', () => {
    const owned = sample()
    expect(maskProviderSecretsInPlace(owned)).toBe(owned)
    expect(owned.openAIKey).toBe(MASKED_PROVIDER_SECRET)

    const shared = sample()
    const masked = maskProviderSecrets(shared)
    expect(masked).not.toBe(shared)
    expect(shared.openAIKey).toBe('sk-top')
    expect(masked.openAIKey).toBe(MASKED_PROVIDER_SECRET)
  })
})
