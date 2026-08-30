import {
  type OpenAICompatibleOptions,
  type OpenAICompatibleProvider,
  resolveOpenAICompatibleVariant,
} from './generation/openaiCompatible.js'
import { resolveOpenAIRequest, runOpenAI } from './generation/openai.js'
import type { PromptMessage } from './prompt/promptMessage.js'
import { scrubThinkSummaryOutput, scrubThoughtsSummaryOutput } from './memorySummaryPrompt.js'

export interface SummarizeOnceOptions {
  provider: OpenAICompatibleProvider
  model: string
  options?: OpenAICompatibleOptions
  maxTokens?: number
  temperature?: number
  signal: AbortSignal
}

export type SummaryAdapterResult = { text: string; tokens: number } | { error: string }

export async function summarizeOnce(
  messages: readonly PromptMessage[],
  opts: SummarizeOnceOptions,
): Promise<SummaryAdapterResult> {
  const variantResult = resolveOpenAICompatibleVariant(opts.provider, opts.options ?? {})
  if (variantResult.ok === false) return { error: variantResult.error }

  const variant = variantResult.variant
  const request = resolveOpenAIRequest({
    model: opts.model,
    messages: [...messages],
    apiKey: variant.apiKey,
    baseUrl: variant.baseUrl,
    maxTokens: opts.maxTokens ?? variant.maxTokens,
    temperature: opts.temperature ?? variant.temperature,
    extraHeaders: variant.extraHeaders,
    additionalParams: variant.additionalParams,
    oobaSystemHoist: variant.oobaSystemHoist,
    signal: opts.signal,
  })
  if (!request) return { error: 'apiKey is required' }

  const result = await runOpenAI(request)
  if (result.aborted === true) return { error: 'aborted' }
  if (result.type === 'fail') return { error: normalizeSummaryAdapterError(result.result) }

  const text = scrubSummaryText(result.result)
  if ('error' in text) return text
  return { text: text.text, tokens: 0 }
}

function normalizeSummaryAdapterError(error: string): string {
  const match = /^Provider request failed: HTTP \d+(?: [^:]+)?(?: from \S+)?(?: \([^)]+\))?: (.*)$/.exec(error)
  return match?.[1] ?? error
}

function scrubSummaryText(content: string): { text: string } | { error: string } {
  try {
    return { text: scrubThinkSummaryOutput(scrubThoughtsSummaryOutput(content)) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
