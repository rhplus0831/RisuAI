import { describe, expect, it } from 'vitest'
import { MODEL_ROLES } from './modelRoles'
import { LLMFormat } from './types'
import {
  createDefaultModelRoleProfiles,
  normalizeModelProfiles,
  normalizeModelRoleProfiles,
  readModelProfiles,
  readModelRoleProfiles,
} from './modelProfileRecords'

describe('model profile records', () => {
  it('defaults every role binding to legacy mode', () => {
    expect(createDefaultModelRoleProfiles()).toEqual(
      Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    )
  })

  it('leniently normalizes missing and old persisted profile shapes', () => {
    expect(normalizeModelProfiles(undefined)).toEqual([])
    expect(
      normalizeModelProfiles([
        {
          id: ' profile-a ',
          name: ' Primary ',
          modelId: ' gpt-5 ',
          providerOptions: {
            requestModel: ' wire-model ',
            baseUrl: ' risu::https://proxy.example.com ',
            reverseProxy: {
              autofillRequestUrl: false,
              oobaSystemHoist: true,
              oobaArgs: { mode: 'chat' },
              headers: { Authorization: 'must-drop' },
            },
            openrouter: {
              fallback: false,
              middleOut: true,
              provider: {
                order: [' Anthropic ', '', 7],
                only: [' openrouter/only '],
                ignore: ['   '],
              },
              route: 'must-drop',
            },
            nanogpt: {
              providerHint: ' together ',
              useSubscriptionEndpoint: true,
              subscriptionState: ' active ',
              nanogptKey: 'must-drop',
            },
            ollama: {
              url: ' http://localhost:11434 ',
              requestFormat: LLMFormat.OpenAIResponseAPI,
              modelSource: ' cloud ',
              thinkingMode: ' medium ',
              ollamaApiKey: 'must-drop',
            },
            apiKey: ' profile-api-key ',
            headers: { Authorization: 'must-drop' },
            extraHeaders: { 'X-Key': 'must-drop' },
            additionalParams: [['header::Authorization', 'must-drop']],
          },
        },
        { id: 'profile-a', name: 'Duplicate' },
        { id: 'profile-b', name: 'Identity Only', modelId: '   ' },
        { id: 'profile-c' },
        { id: 'profile-d', name: 'Blank Request Model', providerOptions: { requestModel: '   ' } },
        { name: 'Missing Id' },
        'bad-row',
      ]),
    ).toEqual([
      {
        id: 'profile-a',
        name: 'Primary',
        modelId: 'gpt-5',
        providerOptions: {
          apiKey: 'profile-api-key',
          requestModel: 'wire-model',
          baseUrl: 'risu::https://proxy.example.com',
          reverseProxy: {
            autofillRequestUrl: false,
            oobaSystemHoist: true,
            oobaArgs: { mode: 'chat' },
          },
          openrouter: {
            fallback: false,
            middleOut: true,
            provider: {
              order: ['Anthropic'],
              only: ['openrouter/only'],
            },
          },
          nanogpt: {
            providerHint: 'together',
            useSubscriptionEndpoint: true,
            subscriptionState: 'active',
          },
          ollama: {
            url: 'http://localhost:11434',
            requestFormat: LLMFormat.OpenAIResponseAPI,
            modelSource: 'cloud',
            thinkingMode: 'medium',
          },
        },
      },
      { id: 'profile-b', name: 'Identity Only' },
      { id: 'profile-c', name: 'profile-c' },
      { id: 'profile-d', name: 'Blank Request Model' },
    ])
  })

  it('accepts strict selected-model profile rows and normalized profile role bindings', () => {
    expect(
      readModelProfiles([
        {
          id: ' profile-a ',
          name: ' Primary ',
          modelId: ' gpt-5 ',
          providerOptions: {
            requestModel: ' wire ',
            apiKey: ' profile-api-key ',
            baseUrl: ' https://proxy.example.com/v1 ',
            reverseProxy: { autofillRequestUrl: false, oobaSystemHoist: true, oobaArgs: { mode: 'chat' } },
            openrouter: {
              fallback: false,
              middleOut: true,
              provider: { order: [' Provider A '], only: [' profile-only '], ignore: [' profile-ignore '] },
            },
            nanogpt: {
              providerHint: ' nano-provider ',
              useSubscriptionEndpoint: true,
              subscriptionState: ' active ',
            },
            ollama: {
              url: ' http://localhost:11434 ',
              requestFormat: LLMFormat.Anthropic,
              modelSource: ' cloud ',
              thinkingMode: ' high ',
            },
          },
        },
        { id: ' identity-only ', name: ' Identity Only ', modelId: '   ', providerOptions: { requestModel: '   ' } },
      ]),
    ).toEqual([
      {
        id: 'profile-a',
        name: 'Primary',
        modelId: 'gpt-5',
        providerOptions: {
          apiKey: 'profile-api-key',
          requestModel: 'wire',
          baseUrl: 'https://proxy.example.com/v1',
          reverseProxy: { autofillRequestUrl: false, oobaSystemHoist: true, oobaArgs: { mode: 'chat' } },
          openrouter: {
            fallback: false,
            middleOut: true,
            provider: { order: ['Provider A'], only: ['profile-only'], ignore: ['profile-ignore'] },
          },
          nanogpt: {
            providerHint: 'nano-provider',
            useSubscriptionEndpoint: true,
            subscriptionState: 'active',
          },
          ollama: {
            url: 'http://localhost:11434',
            requestFormat: LLMFormat.Anthropic,
            modelSource: 'cloud',
            thinkingMode: 'high',
          },
        },
      },
      { id: 'identity-only', name: 'Identity Only' },
    ])
    expect(readModelRoleProfiles({ memory: { mode: 'profile', profileId: ' profile-a ' } })).toEqual({
      ...Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
      memory: { mode: 'profile', profileId: 'profile-a' },
    })
  })

  it('rejects duplicate and unsupported profile rows for settings commands', () => {
    expect(() =>
      readModelProfiles([
        { id: 'profile-a', name: 'Primary' },
        { id: ' profile-a ', name: 'Duplicate' },
      ]),
    ).toThrow('Duplicate model profile id: profile-a')

    for (const field of [
      'openAIKey',
      'proxyKey',
      'openrouterKey',
      'nanogptKey',
      'ollamaApiKey',
      'claudeAPIKey',
      'mistralKey',
      'cohereAPIKey',
      'hordeConfig',
      'google',
      'vertexPrivateKey',
      'OaiCompAPIKeys',
      'customModels',
      'headers',
      'extraHeaders',
      'additionalParams',
    ]) {
      expect(() =>
        readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { [field]: 'secret' } }]),
      ).toThrow(`modelProfiles[0].providerOptions.${field} is not supported`)
    }

    expect(() => readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { apiKey: 123 } }])).toThrow(
      'modelProfiles[0].providerOptions.apiKey must be a string when present',
    )

    expect(() => readModelProfiles([{ id: 'profile-a', name: '' }])).toThrow(
      'modelProfiles[0].name must be a non-empty string',
    )

    expect(() => readModelProfiles([{ id: 'profile-a', name: 'Primary', modelId: 123 }])).toThrow(
      'modelProfiles[0].modelId must be a string when present',
    )

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { requestModel: 123 } }]),
    ).toThrow('modelProfiles[0].providerOptions.requestModel must be a string when present')

    expect(() => readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { baseUrl: 123 } }])).toThrow(
      'modelProfiles[0].providerOptions.baseUrl must be a string when present',
    )

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { reverseProxy: { autofillRequestUrl: 'yes' } },
        },
      ]),
    ).toThrow('modelProfiles[0].providerOptions.reverseProxy.autofillRequestUrl must be a boolean when present')

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { openrouter: { provider: { order: ['ok', 42] } } },
        },
      ]),
    ).toThrow('modelProfiles[0].providerOptions.openrouter.provider.order must be an array of strings when present')

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { openrouter: { provider: { unknown: ['ok'] } } },
        },
      ]),
    ).toThrow('modelProfiles[0].providerOptions.openrouter.provider.unknown is not supported')

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { nanogpt: { useSubscriptionEndpoint: 'true' } },
        },
      ]),
    ).toThrow('modelProfiles[0].providerOptions.nanogpt.useSubscriptionEndpoint must be a boolean when present')

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { ollama: { requestFormat: 'Ollama' } },
        },
      ]),
    ).toThrow('modelProfiles[0].providerOptions.ollama.requestFormat must be a valid LLMFormat when present')

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { ollama: { requestFormat: 999 } },
        },
      ]),
    ).toThrow('modelProfiles[0].providerOptions.ollama.requestFormat must be a valid LLMFormat when present')
  })

  it('rejects unknown role keys and malformed binding shapes for settings commands', () => {
    expect(() => readModelRoleProfiles({ unknownRole: { mode: 'legacy' } })).toThrow(
      'Unknown model role profile binding: unknownRole',
    )
    expect(() => readModelRoleProfiles({ memory: { mode: 'profile', profileId: '' } })).toThrow(
      'modelRoleProfiles.memory.profileId must be a non-empty string',
    )
    expect(() => readModelRoleProfiles({ memory: { mode: 'profile' } })).toThrow(
      'modelRoleProfiles.memory.profileId must be a non-empty string',
    )
    expect(() =>
      readModelRoleProfiles({ memory: { mode: 'profile', profileId: 'profile-a', providerOptions: {} } }),
    ).toThrow('modelRoleProfiles.memory.providerOptions is not supported')
    expect(() => readModelRoleProfiles({ memory: { mode: 'legacy', profileId: 'profile-a' } })).toThrow(
      'modelRoleProfiles.memory.profileId is only supported for profile mode',
    )
    expect(() => readModelRoleProfiles({ memory: { mode: 'inherit' } })).toThrow(
      'modelRoleProfiles.memory.mode must be legacy or profile',
    )
  })

  it('leniently normalizes profile role bindings and restores malformed bindings to legacy', () => {
    expect(
      normalizeModelRoleProfiles({
        memory: { mode: 'profile', profileId: ' profile-a ' },
        emotion: { mode: 'profile', profileId: '   ' },
        translate: { mode: 'legacy' },
      }),
    ).toEqual({
      ...Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
      memory: { mode: 'profile', profileId: 'profile-a' },
    })
    expect(normalizeModelRoleProfiles(null)).toEqual(
      Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    )
  })
})
