import type { OpenAIChat } from '../process/index.svelte'
import { stripInternalReasoning } from '../process/internalReasoning'
import {
  defaultTranslatorPrompt,
  normalizeTranslatorPresetState,
  type TranslatorPresetStateLike,
  type TranslatorPresetStep,
  type TranslatorPresetStepModel,
} from './presets'

const TRANSLATOR_INPUT_SLOT_PATTERN = /{{(?:solt::content|slot::(?:content|prev|out::[^}]+))}}/
const TRANSLATOR_OUTPUT_SLOT_PATTERN = /{{slot::out::([^}]+)}}/g
const TRANSLATOR_HISTORY_SLOT_PATTERN = /{{slot::(history|historytrans)::([^}]*)}}/g
const TRANSLATOR_HISTORY_SLOT_START_PATTERN = /{{slot::(?:historytrans|history)/g

export type TranslatorHistoryResolver = (kind: 'source' | 'translated', n: number) => string

export interface TranslatorPipelineSignature {
  steps: Array<{
    prompt: string
    maxResponse: number
    model: TranslatorPresetStepModel
    outputKey: string | null
    enabled: boolean
  }>
}

export interface TranslatorStepRunInput {
  messages: OpenAIChat[]
  maxResponse: number
  model: TranslatorPresetStepModel
  signal?: AbortSignal | null
}

function cloneStateLike(stateLike: TranslatorPresetStateLike): TranslatorPresetStateLike {
  return {
    translatorPrompt: stateLike.translatorPrompt,
    translatorMaxResponse: stateLike.translatorMaxResponse,
    translatorPresetId: stateLike.translatorPresetId,
    translatorPresets: Array.isArray(stateLike.translatorPresets)
      ? stateLike.translatorPresets.map((preset) => {
          if (!preset || typeof preset !== 'object' || Array.isArray(preset)) return preset
          const record = preset as Record<string, unknown>
          return {
            ...record,
            steps: Array.isArray(record.steps)
              ? record.steps.map((step) => {
                  if (!step || typeof step !== 'object' || Array.isArray(step)) return step
                  const stepRecord = step as Record<string, unknown>
                  return {
                    ...stepRecord,
                    model:
                      stepRecord.model && typeof stepRecord.model === 'object' && !Array.isArray(stepRecord.model)
                        ? { ...(stepRecord.model as Record<string, unknown>) }
                        : stepRecord.model,
                  }
                })
              : record.steps,
          }
        })
      : stateLike.translatorPresets,
  }
}

function parseTranslatorChatML(data: string): OpenAIChat[] | null {
  const starter = '<|im_start|>'
  const separator = '<|im_sep|>'
  const ender = '<|im_end|>'
  const trimmed = data.trim()
  if (!trimmed.startsWith(starter)) return null

  return trimmed
    .split(starter)
    .filter(Boolean)
    .map((part) => {
      let role: OpenAIChat['role'] = 'user'
      let content = part
      for (const candidate of ['system', 'user', 'assistant'] as const) {
        if (content.startsWith(`${candidate}${separator}`)) {
          role = candidate
          content = content.slice(candidate.length + separator.length)
          break
        }
        if (content.startsWith(`${candidate} `) || content.startsWith(`${candidate}\n`)) {
          role = candidate
          content = content.slice(candidate.length + 1)
          break
        }
      }
      content = content.trim()
      if (content.endsWith(ender)) content = content.slice(0, -ender.length)
      return { role, content: content.trim() }
    })
}

function stepsToRun(steps: readonly TranslatorPresetStep[]): TranslatorPresetStep[] {
  const enabled = steps.filter((step) => step.enabled)
  if (enabled.length > 0) return enabled
  return steps.length > 0 ? [steps[0]] : []
}

export function resolveTranslatorPipeline(stateLike: TranslatorPresetStateLike): TranslatorPresetStep[] {
  const normalized = normalizeTranslatorPresetState(cloneStateLike(stateLike))
  const preset = normalized.translatorPresets?.[normalized.translatorPresetId ?? 0]
  if (!preset || typeof preset !== 'object' || !Array.isArray((preset as { steps?: unknown }).steps)) return []
  return (preset as { steps: TranslatorPresetStep[] }).steps.map((step) => ({
    ...step,
    model: { ...step.model },
  }))
}

export function buildTranslatorStepMessages(input: {
  step: TranslatorPresetStep
  sourceText: string
  prevOutput: string
  outputsByKey: Readonly<Record<string, string>>
  to: string
  from: string
  translatorNote: string
  historyResolver?: TranslatorHistoryResolver
}): OpenAIChat[] {
  const promptTemplate = input.step.prompt || defaultTranslatorPrompt
  const hasEmbeddedInput = TRANSLATOR_INPUT_SLOT_PATTERN.test(promptTemplate)
  const prompt = promptTemplate
    .replaceAll('{{slot::from}}', input.from)
    .replaceAll('{{slot}}', input.to)
    .replaceAll('{{solt::content}}', input.sourceText)
    .replaceAll('{{slot::content}}', input.sourceText)
    .replaceAll('{{slot::prev}}', input.prevOutput)
    .replace(TRANSLATOR_OUTPUT_SLOT_PATTERN, (_match, key: string) => input.outputsByKey[key] ?? '')
    .replaceAll('{{slot::tnote}}', input.translatorNote)
    .replace(TRANSLATOR_HISTORY_SLOT_PATTERN, (_match, slot: string, rawCount: string) => {
      if (!/^\d+$/.test(rawCount)) return ''
      const count = Number(rawCount)
      if (!Number.isInteger(count) || count < 1 || count > 50) return ''
      return input.historyResolver?.(slot === 'history' ? 'source' : 'translated', count) ?? ''
    })
  const parsed = parseTranslatorChatML(prompt)
  if (parsed) return parsed
  if (hasEmbeddedInput) return [{ role: 'system', content: prompt }]
  return [
    { role: 'system', content: prompt },
    { role: 'user', content: input.prevOutput },
  ]
}

export function hasMalformedTranslatorHistorySlot(prompt: string): boolean {
  TRANSLATOR_HISTORY_SLOT_START_PATTERN.lastIndex = 0
  for (const match of prompt.matchAll(TRANSLATOR_HISTORY_SLOT_START_PATTERN)) {
    const candidate = prompt.slice(match.index)
    const slot = /^{{slot::(?:historytrans|history)::([^}]*)}}/.exec(candidate)
    if (!slot || !/^\d+$/.test(slot[1])) return true
    const count = Number(slot[1])
    if (!Number.isInteger(count) || count < 1 || count > 50) return true
  }
  return false
}

export function translatorPipelineSignature(steps: readonly TranslatorPresetStep[]): TranslatorPipelineSignature {
  return {
    steps: steps.map((step) => ({
      prompt: step.prompt,
      maxResponse: step.maxResponse,
      model:
        step.model.mode === 'modelProfile'
          ? { mode: 'modelProfile', profileId: step.model.profileId }
          : { mode: 'inheritTranslate' },
      outputKey: step.outputKey ?? null,
      enabled: step.enabled,
    })),
  }
}

export async function runTranslatorPipeline(
  input: {
    steps: readonly TranslatorPresetStep[]
    sourceText: string
    to: string
    from: string
    translatorNote: string
    historyResolver?: TranslatorHistoryResolver
    signal?: AbortSignal | null
  },
  runStep: (input: TranslatorStepRunInput) => Promise<string>,
): Promise<string> {
  let previousOutput = input.sourceText
  const outputsByKey: Record<string, string> = {}

  for (const step of stepsToRun(input.steps)) {
    const output = stripInternalReasoning(
      await runStep({
        messages: buildTranslatorStepMessages({
          step,
          sourceText: input.sourceText,
          prevOutput: previousOutput,
          outputsByKey,
          to: input.to,
          from: input.from,
          translatorNote: input.translatorNote,
          historyResolver: input.historyResolver,
        }),
        maxResponse: step.maxResponse,
        model: step.model,
        signal: input.signal,
      }),
      { preserveUnchanged: true },
    )
    previousOutput = output
    if (step.outputKey) outputsByKey[step.outputKey] = output
  }

  return previousOutput
}
