import { describe, expect, it, vi } from 'vitest'
import { createTranslatorPreset, type TranslatorPresetStep } from './translatorPresets.js'
import {
  buildTranslatorStepMessages,
  hasMalformedTranslatorHistorySlot,
  resolveTranslatorPipeline,
  runTranslatorPipeline,
  translatorPipelineSignature,
} from './translatorPipeline.js'

function step(overrides: Partial<TranslatorPresetStep> = {}): TranslatorPresetStep {
  return {
    id: 'step-a',
    name: 'Step 1',
    enabled: true,
    prompt: '',
    maxResponse: 1000,
    model: { mode: 'inheritTranslate' },
    ...overrides,
  }
}

describe('shared translator pipeline', () => {
  it('resolves canonical and bound presets without mutating input state', () => {
    const state = {
      translatorPrompt: 'legacy',
      translatorPresets: [
        createTranslatorPreset('Global', { id: 'global', prompt: 'Global {{slot::content}}' }),
        createTranslatorPreset('Bound', { id: 'bound', prompt: 'Bound {{slot::content}}' }),
      ],
      translatorPresetId: 'global',
    }
    const before = structuredClone(state)

    expect(resolveTranslatorPipeline(state, 'bound')[0]).toMatchObject({
      id: expect.any(String),
      prompt: 'Bound {{slot::content}}',
    })
    expect(state).toEqual(before)
  })

  it('builds ChatML and ordinary messages with all named slots and history', () => {
    const historyResolver = vi.fn((kind: 'source' | 'translated', count: number) => `${kind}-${count}`)
    expect(
      buildTranslatorStepMessages({
        step: step({
          prompt:
            '<|im_start|>system<|im_sep|>{{slot}}/{{slot::from}}/{{slot::tnote}}<|im_end|>' +
            '<|im_start|>user<|im_sep|>{{slot::content}} {{solt::content}} {{slot::prev}} {{slot::out::draft}} {{slot::history::2}}<|im_end|>',
        }),
        sourceText: 'source',
        prevOutput: 'previous',
        outputsByKey: { draft: 'draft' },
        to: 'ko',
        from: 'en',
        translatorNote: 'note',
        historyResolver,
      }),
    ).toEqual([
      { role: 'system', content: 'ko/en/note' },
      { role: 'user', content: 'source source previous draft source-2' },
    ])
    expect(historyResolver).toHaveBeenCalledWith('source', 2)
  })

  it('uses embedded-input and previous-output message fallbacks', () => {
    expect(
      buildTranslatorStepMessages({
        step: step({ prompt: 'Translate {{slot::content}} into {{slot}}' }),
        sourceText: 'source',
        prevOutput: 'previous',
        outputsByKey: {},
        to: 'ko',
        from: 'en',
        translatorNote: '',
      }),
    ).toEqual([{ role: 'system', content: 'Translate source into ko' }])
    expect(
      buildTranslatorStepMessages({
        step: step({ prompt: 'Translate into {{slot}}' }),
        sourceText: 'source',
        prevOutput: 'previous',
        outputsByKey: {},
        to: 'ko',
        from: 'en',
        translatorNote: '',
      }),
    ).toEqual([
      { role: 'system', content: 'Translate into ko' },
      { role: 'user', content: 'previous' },
    ])
  })

  it('validates history counts and executes ordered steps with output chaining', async () => {
    expect(hasMalformedTranslatorHistorySlot('{{slot::history::1}} {{slot::historytrans::50}}')).toBe(false)
    expect(hasMalformedTranslatorHistorySlot('{{slot::history::0}} {{slot::history::bad}}')).toBe(true)

    const runStep = vi.fn().mockResolvedValueOnce('<think>private</think>draft').mockResolvedValueOnce('final')
    await expect(
      runTranslatorPipeline(
        {
          steps: [
            step({ id: 'draft', prompt: 'Draft {{slot::content}}', outputKey: 'draft' }),
            step({ id: 'disabled', enabled: false }),
            step({ id: 'final', prompt: 'Final {{slot::prev}} {{slot::out::draft}}' }),
          ],
          sourceText: 'source',
          to: 'ko',
          from: 'en',
          translatorNote: '',
        },
        runStep,
      ),
    ).resolves.toBe('final')
    expect(runStep).toHaveBeenCalledTimes(2)
    expect(runStep.mock.calls[1][0].messages).toEqual([{ role: 'system', content: 'Final draft draft' }])
  })

  it('runs the first step when all steps are disabled and signs runtime fields only', async () => {
    const disabledSteps = [step({ enabled: false }), step({ id: 'step-b', enabled: false })]
    await expect(
      runTranslatorPipeline(
        {
          steps: disabledSteps,
          sourceText: 'source',
          to: 'ko',
          from: 'en',
          translatorNote: '',
        },
        async () => 'forced',
      ),
    ).resolves.toBe('forced')

    const original = [step({ id: 'original', name: 'Original', outputKey: 'draft' })]
    expect(translatorPipelineSignature([{ ...original[0], id: 'other', name: 'Other' }])).toEqual(
      translatorPipelineSignature(original),
    )
    expect(translatorPipelineSignature([{ ...original[0], prompt: 'changed' }])).not.toEqual(
      translatorPipelineSignature(original),
    )
  })
})
