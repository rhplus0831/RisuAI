import { inlayTokenRegex } from '@risuai/shared-core/inlay-tokens'
import type { HypaV3Settings } from './memoryPlanner.js'
import type { PromptMessage } from './prompt/promptMessage.js'

export const DEFAULT_SUMMARIZATION_PROMPT =
  '[Summarize the ongoing role story, It must also remove redundancy and unnecessary text and content from the output.]'
export const DEFAULT_RESUMMARIZATION_PROMPT = 'Re-summarize this summaries.'

export interface SummaryPromptOptions {
  maxTokens: number
  temperature: number
  enableThinking: boolean
}

export interface BuildHypaV3SummaryPromptInput {
  messages?: readonly PromptMessage[]
  chunkText?: string
  settings?: Pick<HypaV3Settings, 'summarizationPrompt' | 'reSummarizationPrompt'> | null
  isResummarize?: boolean
}

export interface BuildHypaV3SummaryPromptResult {
  messages: PromptMessage[]
  chunkText: string
  prompt: string
  parsedChatML: boolean
  options: SummaryPromptOptions
}

export class SummaryPromptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SummaryPromptError'
  }
}

export function buildHypaV3SummaryPrompt(input: BuildHypaV3SummaryPromptInput): BuildHypaV3SummaryPromptResult {
  const chunkText = resolveChunkText(input)
  const prompt = resolveSummaryPrompt(input.settings, input.isResummarize ?? false)
  const promptWithSlot = prompt.replaceAll('{{slot}}', chunkText)
  const parsed = parseSummaryChatML(promptWithSlot)

  return {
    messages: parsed ?? [
      {
        role: 'user',
        content: chunkText,
      },
      {
        role: 'system',
        content: prompt,
      },
    ],
    chunkText,
    prompt,
    parsedChatML: parsed !== null,
    options: {
      maxTokens: 8192,
      temperature: 0,
      enableThinking: false,
    },
  }
}

export function buildSummaryChunkText(messages: readonly PromptMessage[]): string {
  return messages.map((message) => `${message.role}: ${sanitizeSummaryMessageContent(message.content)}`).join('\n')
}

export function sanitizeSummaryMessageContent(content: string): string {
  return content.replace(inlayTokenRegex, '[Image]').replaceAll('\r\n', '\n').trim()
}

export function scrubThoughtsSummaryOutput(content: string): string {
  return scrubSummaryOutput(content, /<Thoughts>[\s\S]*?<\/Thoughts>/g, 'Thoughts')
}

export function scrubThinkSummaryOutput(content: string): string {
  return scrubSummaryOutput(content, /<think>[\s\S]*?<\/think>/g, 'think')
}

export function parseSummaryChatML(text: string): PromptMessage[] | null {
  const starter = '<|im_start|>'
  const separator = '<|im_sep|>'
  const ender = '<|im_end|>'

  const trimmed = text.trim()
  if (!trimmed.startsWith(starter)) return null

  return trimmed
    .split(starter)
    .filter((segment) => segment !== '')
    .map((segment) => {
      let role: 'system' | 'user' | 'assistant' = 'user'
      let content = segment

      if (content.startsWith('user' + separator)) {
        role = 'user'
        content = content.substring(4 + separator.length)
      } else if (content.startsWith('system' + separator)) {
        role = 'system'
        content = content.substring(6 + separator.length)
      } else if (content.startsWith('assistant' + separator)) {
        role = 'assistant'
        content = content.substring(9 + separator.length)
      } else if (content.startsWith('user ') || content.startsWith('user\n')) {
        role = 'user'
        content = content.substring(5)
      } else if (content.startsWith('system ') || content.startsWith('system\n')) {
        role = 'system'
        content = content.substring(7)
      } else if (content.startsWith('assistant ') || content.startsWith('assistant\n')) {
        role = 'assistant'
        content = content.substring(10)
      }

      content = content.trim()
      if (content.endsWith(ender)) {
        content = content.substring(0, content.length - ender.length)
      }

      const thoughts: string[] = []
      content = content.replace(/<Thoughts>(.+)<\/Thoughts>/gms, (_match, body: string) => {
        thoughts.push(body)
        return ''
      })

      return {
        role,
        content,
        thoughts,
      } satisfies PromptMessage
    })
}

function resolveChunkText(input: BuildHypaV3SummaryPromptInput): string {
  if (input.messages && input.messages.length > 0) {
    const text = buildSummaryChunkText(input.messages)
    if (text.length > 0) return text
  }

  if (typeof input.chunkText === 'string') {
    const text = input.chunkText.replaceAll('\r\n', '\n').trim()
    if (text.length > 0) return text
  }

  throw new SummaryPromptError('summary chunk text must be non-empty')
}

function resolveSummaryPrompt(settings: BuildHypaV3SummaryPromptInput['settings'], isResummarize: boolean): string {
  if (isResummarize) {
    const prompt = settings?.reSummarizationPrompt
    return prompt && prompt.trim() !== '' ? prompt : DEFAULT_RESUMMARIZATION_PROMPT
  }

  const prompt = settings?.summarizationPrompt
  return prompt && prompt.trim() !== '' ? prompt : DEFAULT_SUMMARIZATION_PROMPT
}

function scrubSummaryOutput(content: string, regex: RegExp, tag: string): string {
  const result = content.replace(regex, '').trim()
  if (result.length === 0) {
    throw new SummaryPromptError(`Empty summary after removing ${tag} content`)
  }
  return result
}
