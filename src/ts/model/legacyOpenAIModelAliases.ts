const LEGACY_OPENAI_MODEL_ALIASES: Readonly<Record<string, string>> = {
  gpt35: 'gpt-3.5-turbo',
  gpt35_0613: 'gpt-3.5-turbo-0613',
  gpt35_16k: 'gpt-3.5-turbo-16k',
  gpt35_16k_0613: 'gpt-3.5-turbo-16k-0613',
  gpt35_0125: 'gpt-3.5-turbo-0125',
  gpt35_1106: 'gpt-3.5-turbo-1106',
  gpt35_0301: 'gpt-3.5-turbo-0301',
  gpt4: 'gpt-4',
  gpt45: 'gpt-4.5-preview',
  gpt4_32k: 'gpt-4-32k',
  gpt4_0613: 'gpt-4-0613',
  gpt4_32k_0613: 'gpt-4-32k-0613',
  gpt4_1106: 'gpt-4-1106-preview',
  gpt4_0125: 'gpt-4-0125-preview',
  gpt4_0314: 'gpt-4-0314',
  gptvi4_1106: 'gpt-4-vision-preview',
  gpt4_turbo_20240409: 'gpt-4-turbo-2024-04-09',
  gpt4_turbo: 'gpt-4-turbo',
  gpt4o: 'gpt-4o',
  gpt4om: 'gpt-4o-mini',
  'gpt4om-2024-07-18': 'gpt-4o-mini-2024-07-18',
  'gpt4o-chatgpt': 'chatgpt-4o-latest',
  'gpt4o1-preview': 'o1-preview',
  'gpt4o1-mini': 'o1-mini',
}

/** Keep legacy selector IDs in stored data while normalizing provider wire payloads. */
export function normalizeLegacyOpenAIModelId(model: string): string {
  return LEGACY_OPENAI_MODEL_ALIASES[model] ?? model
}
