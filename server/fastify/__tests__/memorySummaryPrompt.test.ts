import { describe, expect, it } from 'vitest'
import {
  buildHypaV3SummaryPrompt,
  buildSummaryChunkText,
  DEFAULT_RESUMMARIZATION_PROMPT,
  DEFAULT_SUMMARIZATION_PROMPT,
  parseSummaryChatML,
  sanitizeSummaryMessageContent,
  scrubThinkSummaryOutput,
  scrubThoughtsSummaryOutput,
  SummaryPromptError,
} from '../src/memorySummaryPrompt.js'
import type { PromptMessage } from '../src/prompt/promptMessage.js'

function chat(role: PromptMessage['role'], content: string): PromptMessage {
  return { role, content }
}

describe('Hypa V3 summary prompt builder', () => {
  it('builds the default summarize fallback prompt', () => {
    const result = buildHypaV3SummaryPrompt({
      messages: [chat('assistant', 'hello')],
      settings: {
        summarizationPrompt: '',
        reSummarizationPrompt: '',
      },
    })

    expect(result.parsedChatML).toBe(false)
    expect(result.prompt).toBe(DEFAULT_SUMMARIZATION_PROMPT)
    expect(result.chunkText).toBe('assistant: hello')
    expect(result.messages).toEqual([
      { role: 'user', content: 'assistant: hello' },
      { role: 'system', content: DEFAULT_SUMMARIZATION_PROMPT },
    ])
    expect(result.options).toEqual({
      maxTokens: 8192,
      temperature: 0,
      enableThinking: false,
    })
  })

  it('builds the default re-summarize fallback prompt', () => {
    const result = buildHypaV3SummaryPrompt({
      chunkText: 'assistant: old summary',
      isResummarize: true,
      settings: {
        summarizationPrompt: 'ignored',
        reSummarizationPrompt: '   ',
      },
    })

    expect(result.prompt).toBe(DEFAULT_RESUMMARIZATION_PROMPT)
    expect(result.messages).toEqual([
      { role: 'user', content: 'assistant: old summary' },
      { role: 'system', content: DEFAULT_RESUMMARIZATION_PROMPT },
    ])
  })

  it('replaces the slot in custom ChatML prompts', () => {
    const result = buildHypaV3SummaryPrompt({
      messages: [chat('user', 'first'), chat('assistant', 'second')],
      settings: {
        summarizationPrompt: '<|im_start|>system\nSummarize only.<|im_end|><|im_start|>user\n{{slot}}<|im_end|>',
        reSummarizationPrompt: '',
      },
    })

    expect(result.parsedChatML).toBe(true)
    expect(result.messages).toEqual([
      { role: 'system', content: 'Summarize only.', thoughts: [] },
      { role: 'user', content: 'user: first\nassistant: second', thoughts: [] },
    ])
  })

  it('falls back to user plus system rows when custom prompt is not ChatML', () => {
    const result = buildHypaV3SummaryPrompt({
      chunkText: 'assistant: scene',
      settings: {
        summarizationPrompt: 'Summarize this: {{slot}}',
        reSummarizationPrompt: '',
      },
    })

    expect(result.parsedChatML).toBe(false)
    expect(result.messages).toEqual([
      { role: 'user', content: 'assistant: scene' },
      { role: 'system', content: 'Summarize this: {{slot}}' },
    ])
  })

  it('sanitizes inlay tokens and line endings in message text', () => {
    expect(sanitizeSummaryMessageContent(' hi\r\n{{inlayeddata::asset-1}}\r\n')).toBe('hi\n[Image]')
    expect(buildSummaryChunkText([chat('assistant', '  {{inlay::asset-2}} appears  '), chat('user', 'ok')])).toBe(
      'assistant: [Image] appears\nuser: ok',
    )
  })

  it('parses ChatML with separator and newline role forms', () => {
    expect(parseSummaryChatML('<|im_start|>system<|im_sep|>A<|im_end|><|im_start|>assistant\nB<|im_end|>')).toEqual([
      { role: 'system', content: 'A', thoughts: [] },
      { role: 'assistant', content: 'B', thoughts: [] },
    ])
  })

  it('scrubs provider thought wrappers and rejects empty results', () => {
    expect(scrubThoughtsSummaryOutput('<Thoughts>hidden</Thoughts>\nSummary')).toBe('Summary')
    expect(scrubThinkSummaryOutput('<think>hidden</think>\nSummary')).toBe('Summary')
    expect(() => scrubThoughtsSummaryOutput('<Thoughts>hidden</Thoughts>')).toThrow(SummaryPromptError)
    expect(() => scrubThinkSummaryOutput('<think>hidden</think>')).toThrow(SummaryPromptError)
  })
})
