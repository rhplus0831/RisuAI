export const canonicalModelProfileFixture = {
  staleFlat: {
    aiModel: 'flat-stale-model',
    subModel: 'flat-stale-model',
    openAIKey: 'sk-flat-stale-secret',
    temperature: 99,
  },
  credential: {
    id: 'credential-canonical',
    name: 'Canonical OpenAI',
    type: 'apiKey',
    apiKey: 'sk-canonical-secret',
  },
  profile: {
    id: 'profile-canonical',
    name: 'Canonical OpenAI',
    providerId: 'openai',
    modelId: 'gpt-5',
    providerOptions: {
      credentialId: 'credential-canonical',
      requestModel: 'durable-gpt-5',
    },
    runtimeOptions: {
      maxContext: 8192,
      temperature: 0.31,
    },
  },
  bindings: {
    memory: { mode: 'profile', profileId: 'profile-canonical' },
  },
} as const
