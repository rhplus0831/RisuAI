import { describe, expect, it } from 'vitest'
import { MODEL_ROLES } from './modelRoles'
import { LLMFlags, LLMFormat, LLMTokenizer } from './types'
import {
  createDefaultModelRoleProfiles,
  modelProfileListItems,
  normalizeModelProfileOrder,
  normalizeModelRuntimeDefaults,
  normalizeModelProfiles,
  normalizeModelRoleProfiles,
  readModelProfileOrder,
  readModelRuntimeDefaults,
  readModelProfiles,
  readModelRoleProfiles,
} from './modelProfileRecords'

describe('model profile records', () => {
  it('defaults every role binding to legacy mode', () => {
    expect(createDefaultModelRoleProfiles()).toEqual(
      Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    )
  })

  it('normalizes mixed profile and divider ordering without turning dividers into profiles', () => {
    const profiles = [
      { id: 'profile-a', name: 'A' },
      { id: 'profile-b', name: 'B' },
    ]
    const order = normalizeModelProfileOrder(
      [
        { kind: 'profile', profileId: 'profile-b' },
        { kind: 'divider', id: ' divider-a ' },
        { kind: 'divider', id: 'divider-a' },
        { kind: 'profile', profileId: 'missing' },
        { kind: 'unknown', id: 'drop' },
      ],
      profiles,
    )

    expect(order).toEqual([
      { kind: 'profile', profileId: 'profile-b' },
      { kind: 'divider', id: 'divider-a' },
      { kind: 'profile', profileId: 'profile-a' },
    ])
    expect(modelProfileListItems(profiles, order)).toEqual([
      { kind: 'profile', profile: profiles[1] },
      { kind: 'divider', id: 'divider-a' },
      { kind: 'profile', profile: profiles[0] },
    ])
  })

  it('strictly validates complete model profile ordering', () => {
    const profiles = [
      { id: 'profile-a', name: 'A' },
      { id: 'profile-b', name: 'B' },
    ]
    expect(
      readModelProfileOrder(
        [
          { kind: 'profile', profileId: 'profile-a' },
          { kind: 'divider', id: 'divider-a' },
          { kind: 'profile', profileId: 'profile-b' },
        ],
        profiles,
      ),
    ).toEqual([
      { kind: 'profile', profileId: 'profile-a' },
      { kind: 'divider', id: 'divider-a' },
      { kind: 'profile', profileId: 'profile-b' },
    ])
    expect(() => readModelProfileOrder([{ kind: 'profile', profileId: 'profile-a' }], profiles)).toThrow(
      'modelProfileOrder must include every model profile exactly once',
    )
    expect(() =>
      readModelProfileOrder(
        [
          { kind: 'profile', profileId: 'profile-a' },
          { kind: 'divider', id: 'divider-a' },
          { kind: 'divider', id: 'divider-a' },
          { kind: 'profile', profileId: 'profile-b' },
        ],
        profiles,
      ),
    ).toThrow('modelProfileOrder[2].id must not duplicate divider-a')
    expect(() =>
      readModelProfileOrder(
        [
          { kind: 'profile', profileId: 'profile-a' },
          { kind: 'profile', profileId: 'missing' },
        ],
        profiles,
      ),
    ).toThrow('modelProfileOrder[1].profileId references an unknown model profile')
  })

  it('leniently normalizes missing and old persisted profile shapes', () => {
    expect(normalizeModelProfiles(undefined)).toEqual([])
    expect(
      normalizeModelProfiles([
        {
          id: ' profile-a ',
          name: ' Primary ',
          providerId: ' openai ',
          modelId: ' gpt-5 ',
          providerOptions: {
            credentialId: ' cred-primary ',
            requestModel: ' wire-model ',
            baseUrl: ' risu::https://proxy.example.com ',
            extraHeaders: { ' X-Key ': ' value ', '   ': 'drop', 'X-Bad': 7 },
            additionalParams: [
              [' header::Authorization ', ' bearer '],
              ['   ', 'drop'],
              ['body::trace', ' enabled '],
              ['bad'],
              [7, 'drop'],
            ],
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
            vertex: {
              projectId: ' project-a ',
              region: ' us-central1 ',
              clientEmail: ' svc@example.iam.gserviceaccount.com ',
              privateKey: ' -----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY----- ',
              accessToken: 'must-drop',
            },
            customApi: {
              tokenizer: LLMTokenizer.Mistral,
              flags: [LLMFlags.hasStreaming, 999, 'bad', LLMFlags.hasFirstSystemPrompt],
              url: 'must-drop',
            },
            apiKey: ' profile-api-key ',
            headers: { Authorization: 'must-drop' },
          },
          runtimeOptions: {
            maxContext: 32768,
            maxResponse: 2048,
            temperature: 70,
            topP: 0.9,
            topK: 40,
            minP: 0.1,
            topA: 0.2,
            repetitionPenalty: 1.05,
            frequencyPenalty: -25,
            presencePenalty: 30,
            reasoningEffort: 2,
            thinkingTokens: 512,
            verbosity: 1,
            genTime: 3,
            thinkingType: ' enabled ',
            deepseekThinkingType: ' deepseek ',
            adaptiveThinkingEffort: ' medium ',
            deepseekReasoningEffort: ' high ',
            extractJson: ' object ',
            jsonSchema: ' {"type":"object"} ',
            customTokenizer: ' cl100k_base ',
            useStreaming: false,
            jsonSchemaEnabled: true,
            strictJsonSchema: true,
            outputImageModal: true,
            enableCustomFlags: true,
            dynamicOutput: { mode: 'json' },
            modelTools: [' tool-a ', '', 7, 'tool-b'],
            customFlags: [LLMFlags.hasImageInput, 999, 'bad', LLMFlags.hasStreaming],
            unsupportedRuntimeField: 'must-drop',
          },
          fallbacks: [
            { mode: 'profile', profileId: ' fallback-a ' },
            { mode: 'profile', profileId: 'fallback-a' },
            { mode: 'model', modelId: ' fallback-model ' },
            { mode: 'model', modelId: 'fallback-model' },
            { mode: 'legacy', profileId: 'must-drop' },
            { mode: 'profile', profileId: '   ' },
            { mode: 'model', modelId: '   ' },
            { mode: 'profile', profileId: 42 },
            { profileId: 'must-drop' },
          ],
        },
        { id: 'profile-a', name: 'Duplicate' },
        { id: 'profile-b', name: 'Identity Only', modelId: '   ' },
        { id: 'profile-c' },
        { id: 'profile-d', name: 'Blank Request Model', providerOptions: { requestModel: '   ' } },
        { id: 'profile-e', name: 'Empty Runtime', runtimeOptions: { extractJson: '   ', modelTools: [''] } },
        { name: 'Missing Id' },
        'bad-row',
      ]),
    ).toEqual([
      {
        id: 'profile-a',
        name: 'Primary',
        providerId: 'openai',
        modelId: 'gpt-5',
        providerOptions: {
          credentialId: 'cred-primary',
          requestModel: 'wire-model',
          baseUrl: 'risu::https://proxy.example.com',
          extraHeaders: { 'X-Key': 'value' },
          additionalParams: [
            ['header::Authorization', 'bearer'],
            ['body::trace', 'enabled'],
          ],
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
          vertex: {
            projectId: 'project-a',
            region: 'us-central1',
          },
          customApi: {
            tokenizer: LLMTokenizer.Mistral,
            flags: [LLMFlags.hasStreaming, LLMFlags.hasFirstSystemPrompt],
          },
        },
        runtimeOptions: {
          maxContext: 32768,
          maxResponse: 2048,
          temperature: 70,
          topP: 0.9,
          topK: 40,
          minP: 0.1,
          topA: 0.2,
          repetitionPenalty: 1.05,
          frequencyPenalty: -25,
          presencePenalty: 30,
          reasoningEffort: 2,
          thinkingTokens: 512,
          verbosity: 1,
          genTime: 3,
          thinkingType: 'enabled',
          deepseekThinkingType: 'deepseek',
          adaptiveThinkingEffort: 'medium',
          deepseekReasoningEffort: 'high',
          extractJson: 'object',
          jsonSchema: '{"type":"object"}',
          customTokenizer: 'cl100k_base',
          useStreaming: false,
          jsonSchemaEnabled: true,
          strictJsonSchema: true,
          outputImageModal: true,
          enableCustomFlags: true,
          dynamicOutput: { mode: 'json' },
          modelTools: ['tool-a', 'tool-b'],
          customFlags: [LLMFlags.hasImageInput, LLMFlags.hasStreaming],
        },
        fallbacks: [
          { mode: 'profile', profileId: 'fallback-a' },
          { mode: 'model', modelId: 'fallback-model' },
        ],
      },
      { id: 'profile-b', name: 'Identity Only' },
      { id: 'profile-c', name: 'profile-c' },
      { id: 'profile-d', name: 'Blank Request Model' },
      { id: 'profile-e', name: 'Empty Runtime', runtimeOptions: { modelTools: [] } },
    ])
  })

  it('accepts strict selected-model profile rows and normalized profile role bindings', () => {
    expect(
      readModelProfiles([
        {
          id: ' profile-a ',
          name: ' Primary ',
          providerId: ' vertex ',
          modelId: ' gpt-5 ',
          providerOptions: {
            credentialId: ' cred-vertex ',
            requestModel: ' wire ',
            baseUrl: ' https://proxy.example.com/v1 ',
            extraHeaders: { 'X-Test': ' yes ' },
            additionalParams: [[' header::X-Test ', ' true ']],
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
            llmGateway: {
              reasoningEffort: 'max',
              verbosity: 'high',
              serviceTier: 'priority',
              routing: 'throughput',
            },
            ollama: {
              url: ' http://localhost:11434 ',
              requestFormat: LLMFormat.Anthropic,
              modelSource: ' cloud ',
              thinkingMode: ' high ',
            },
            vertex: {
              projectId: ' project-a ',
              region: ' us-central1 ',
            },
            customApi: {
              tokenizer: LLMTokenizer.Cohere,
              flags: [LLMFlags.hasFirstSystemPrompt],
            },
          },
          runtimeOptions: {
            maxContext: 65536,
            maxResponse: 4096,
            temperature: 65,
            topP: 0.8,
            frequencyPenalty: -10,
            useStreaming: false,
            genTime: 4,
            extractJson: ' object ',
            jsonSchemaEnabled: true,
            modelTools: [' tool-a ', ''],
            customFlags: [LLMFlags.hasImageInput],
            customTokenizer: ' custom-tokenizer ',
          },
          fallbacks: [
            { mode: 'profile', profileId: ' fallback-profile ' },
            { mode: 'model', modelId: ' fallback-model ' },
          ],
        },
        { id: ' identity-only ', name: ' Identity Only ', modelId: '   ', providerOptions: { requestModel: '   ' } },
      ]),
    ).toEqual([
      {
        id: 'profile-a',
        name: 'Primary',
        providerId: 'vertex',
        modelId: 'gpt-5',
        providerOptions: {
          credentialId: 'cred-vertex',
          requestModel: 'wire',
          baseUrl: 'https://proxy.example.com/v1',
          extraHeaders: { 'X-Test': 'yes' },
          additionalParams: [['header::X-Test', 'true']],
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
          llmGateway: {
            reasoningEffort: 'max',
            verbosity: 'high',
            serviceTier: 'priority',
            routing: 'throughput',
          },
          ollama: {
            url: 'http://localhost:11434',
            requestFormat: LLMFormat.Anthropic,
            modelSource: 'cloud',
            thinkingMode: 'high',
          },
          vertex: {
            projectId: 'project-a',
            region: 'us-central1',
          },
          customApi: {
            tokenizer: LLMTokenizer.Cohere,
            flags: [LLMFlags.hasFirstSystemPrompt],
          },
        },
        runtimeOptions: {
          maxContext: 65536,
          maxResponse: 4096,
          temperature: 65,
          topP: 0.8,
          frequencyPenalty: -10,
          useStreaming: false,
          genTime: 4,
          extractJson: 'object',
          jsonSchemaEnabled: true,
          modelTools: ['tool-a'],
          customFlags: [LLMFlags.hasImageInput],
          customTokenizer: 'custom-tokenizer',
        },
        fallbacks: [
          { mode: 'profile', profileId: 'fallback-profile' },
          { mode: 'model', modelId: 'fallback-model' },
        ],
      },
      { id: 'identity-only', name: 'Identity Only' },
    ])
    expect(
      readModelRoleProfiles({
        memory: { mode: 'profile', profileId: ' profile-a ' },
        scriptMain: { mode: 'inherit' },
      }),
    ).toEqual({
      ...Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
      memory: { mode: 'profile', profileId: 'profile-a' },
      scriptMain: { mode: 'inherit' },
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
    ]) {
      expect(() =>
        readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { [field]: 'secret' } }]),
      ).toThrow(`modelProfiles[0].providerOptions.${field} is not supported`)
    }

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { apiKey: 'legacy-secret' } }]),
    ).toThrow(
      'modelProfiles[0].providerOptions.apiKey is no longer supported; reference a credential via modelProfiles[0].providerOptions.credentialId',
    )

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { credentialId: '   ' } }]),
    ).toThrow('modelProfiles[0].providerOptions.credentialId must be a non-empty string when present')

    expect(() => readModelProfiles([{ id: 'profile-a', name: '' }])).toThrow(
      'modelProfiles[0].name must be a non-empty string',
    )

    expect(() => readModelProfiles([{ id: 'profile-a', name: 'Primary', modelId: 123 }])).toThrow(
      'modelProfiles[0].modelId must be a string when present',
    )

    expect(() => readModelProfiles([{ id: 'profile-a', name: 'Primary', providerId: 123 }])).toThrow(
      'modelProfiles[0].providerId must be a string when present',
    )

    expect(() => readModelProfiles([{ id: 'profile-a', name: 'Primary', fallbacks: {} }])).toThrow(
      'modelProfiles[0].fallbacks must be an array when present',
    )

    expect(() => readModelProfiles([{ id: 'profile-a', name: 'Primary', fallbacks: ['bad'] }])).toThrow(
      'modelProfiles[0].fallbacks[0] must be an object',
    )

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', fallbacks: [{ mode: 'profile', profileId: 'x', x: 1 }] }]),
    ).toThrow('modelProfiles[0].fallbacks[0].x is not supported')

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', fallbacks: [{ mode: 'legacy', profileId: 'x' }] }]),
    ).toThrow('modelProfiles[0].fallbacks[0].mode must be profile or model')

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', fallbacks: [{ mode: 'profile', profileId: '' }] }]),
    ).toThrow('modelProfiles[0].fallbacks[0].profileId must be a non-empty string')

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', fallbacks: [{ mode: 'model', modelId: '' }] }]),
    ).toThrow('modelProfiles[0].fallbacks[0].modelId must be a non-empty string')

    expect(() =>
      readModelProfiles([
        { id: 'profile-a', name: 'Primary', fallbacks: [{ mode: 'profile', profileId: 'x', modelId: 'y' }] },
      ]),
    ).toThrow('modelProfiles[0].fallbacks[0].modelId is only supported for model mode')

    expect(() =>
      readModelProfiles([
        { id: 'profile-a', name: 'Primary', fallbacks: [{ mode: 'model', modelId: 'x', profileId: 'y' }] },
      ]),
    ).toThrow('modelProfiles[0].fallbacks[0].profileId is only supported for profile mode')

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          fallbacks: [
            { mode: 'profile', profileId: 'fallback-a' },
            { mode: 'profile', profileId: ' fallback-a ' },
          ],
        },
      ]),
    ).toThrow('modelProfiles[0].fallbacks[1].profileId must not duplicate fallback-a')

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          fallbacks: [
            { mode: 'model', modelId: 'fallback-a' },
            { mode: 'model', modelId: ' fallback-a ' },
          ],
        },
      ]),
    ).toThrow('modelProfiles[0].fallbacks[1].modelId must not duplicate fallback-a')

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { requestModel: 123 } }]),
    ).toThrow('modelProfiles[0].providerOptions.requestModel must be a string when present')

    expect(() => readModelProfiles([{ id: 'profile-a', name: 'Primary', runtimeOptions: { unknown: true } }])).toThrow(
      'modelProfiles[0].runtimeOptions.unknown is not supported',
    )

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', runtimeOptions: { temperature: Number.NaN } }]),
    ).toThrow('modelProfiles[0].runtimeOptions.temperature must be a finite number when present')

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', runtimeOptions: { useStreaming: 'yes' } }]),
    ).toThrow('modelProfiles[0].runtimeOptions.useStreaming must be a boolean when present')

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', runtimeOptions: { extractJson: 42 } }]),
    ).toThrow('modelProfiles[0].runtimeOptions.extractJson must be a string when present')

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', runtimeOptions: { modelTools: ['tool-a', 42] } }]),
    ).toThrow('modelProfiles[0].runtimeOptions.modelTools must be an array of strings when present')

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', runtimeOptions: { customFlags: [999] } }]),
    ).toThrow(
      'modelProfiles[0].runtimeOptions.customFlags must be an array of valid LLMFlags numeric values when present',
    )

    expect(() => readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { baseUrl: 123 } }])).toThrow(
      'modelProfiles[0].providerOptions.baseUrl must be a string when present',
    )

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { extraHeaders: [] } }]),
    ).toThrow('modelProfiles[0].providerOptions.extraHeaders must be an object with string values when present')

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { extraHeaders: { 'X-Test': 42 } } }]),
    ).toThrow('modelProfiles[0].providerOptions.extraHeaders must be an object with string values when present')

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { additionalParams: ['bad'] } }]),
    ).toThrow(
      'modelProfiles[0].providerOptions.additionalParams must be an array of [string, string] pairs when present',
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
          providerOptions: { llmGateway: { reasoningEffort: 'extreme' } },
        },
      ]),
    ).toThrow(
      'modelProfiles[0].providerOptions.llmGateway.reasoningEffort must be one of none, minimal, low, medium, high, xhigh, max when present',
    )

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { llmGateway: { serviceTier: 'turbo' } },
        },
      ]),
    ).toThrow(
      'modelProfiles[0].providerOptions.llmGateway.serviceTier must be one of auto, default, flex, priority when present',
    )

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { llmGateway: { routing: 'random' } },
        },
      ]),
    ).toThrow(
      'modelProfiles[0].providerOptions.llmGateway.routing must be one of auto, price, throughput, latency when present',
    )

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

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { vertex: { privateKey: 42 } },
        },
      ]),
    ).toThrow(
      'modelProfiles[0].providerOptions.vertex.privateKey is no longer supported; reference a credential via providerOptions.credentialId',
    )

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { vertex: { clientEmail: 'service@example.com' } },
        },
      ]),
    ).toThrow(
      'modelProfiles[0].providerOptions.vertex.clientEmail is no longer supported; reference a credential via providerOptions.credentialId',
    )

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { vertex: { accessToken: 'not-supported' } },
        },
      ]),
    ).toThrow('modelProfiles[0].providerOptions.vertex.accessToken is not supported')

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { customApi: { tokenizer: 999 } },
        },
      ]),
    ).toThrow('modelProfiles[0].providerOptions.customApi.tokenizer must be a valid LLMTokenizer when present')

    expect(() =>
      readModelProfiles([
        {
          id: 'profile-a',
          name: 'Primary',
          providerOptions: { customApi: { flags: [999] } },
        },
      ]),
    ).toThrow(
      'modelProfiles[0].providerOptions.customApi.flags must be an array of valid LLMFlags numeric values when present',
    )
  })

  it('normalizes and reads model runtime defaults with the profile runtime schema', () => {
    expect(normalizeModelRuntimeDefaults(undefined)).toEqual({})
    expect(
      normalizeModelRuntimeDefaults({
        maxContext: 8192,
        temperature: 55,
        extractJson: ' object ',
        useStreaming: false,
        stripCoT: true,
        modelTools: [' tool-a ', '', 7],
        customFlags: [LLMFlags.hasStreaming, 999, 'bad'],
        unsupportedRuntimeField: true,
      }),
    ).toEqual({
      maxContext: 8192,
      temperature: 55,
      extractJson: 'object',
      useStreaming: false,
      stripCoT: true,
      modelTools: ['tool-a'],
      customFlags: [LLMFlags.hasStreaming],
    })

    expect(
      readModelRuntimeDefaults({
        topP: 0.8,
        customTokenizer: ' cl100k_base ',
        enableCustomFlags: true,
        stripCoT: false,
        customFlags: [LLMFlags.hasImageInput],
      }),
    ).toEqual({
      topP: 0.8,
      customTokenizer: 'cl100k_base',
      enableCustomFlags: true,
      stripCoT: false,
      customFlags: [LLMFlags.hasImageInput],
    })

    expect(() => readModelRuntimeDefaults({ unknown: true })).toThrow('modelRuntimeDefaults.unknown is not supported')
    expect(() => readModelRuntimeDefaults({ customFlags: [999] })).toThrow(
      'modelRuntimeDefaults.customFlags must be an array of valid LLMFlags numeric values when present',
    )
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
    expect(() => readModelRoleProfiles({ memory: { mode: 'inherit', profileId: 'profile-a' } })).toThrow(
      'modelRoleProfiles.memory.profileId is only supported for profile mode',
    )
    expect(() => readModelRoleProfiles({ chatMain: { mode: 'inherit' } })).toThrow(
      'modelRoleProfiles.chatMain.mode does not support inherit',
    )
    expect(() => readModelRoleProfiles({ chatAux: { mode: 'inherit' } })).toThrow(
      'modelRoleProfiles.chatAux.mode does not support inherit',
    )
  })

  it('leniently normalizes profile role bindings and restores malformed bindings to legacy', () => {
    expect(
      normalizeModelRoleProfiles({
        memory: { mode: 'profile', profileId: ' profile-a ' },
        emotion: { mode: 'profile', profileId: '   ' },
        translate: { mode: 'legacy' },
        otherAx: { mode: 'inherit' },
        scriptAux: { mode: 'inherit', profileId: 'profile-a' },
        chatMain: { mode: 'inherit' },
      }),
    ).toEqual({
      ...Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
      memory: { mode: 'profile', profileId: 'profile-a' },
      otherAx: { mode: 'inherit' },
    })
    expect(normalizeModelRoleProfiles(null)).toEqual(
      Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    )
    expect(normalizeModelRoleProfiles({ memory: { mode: 'inherit', providerOptions: {} } }).memory).toEqual({
      mode: 'legacy',
    })
  })
})
