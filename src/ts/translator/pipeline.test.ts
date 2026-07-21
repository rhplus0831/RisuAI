import { describe, expect, it, vi } from 'vitest'
import { createTranslatorPreset, type TranslatorPresetStep } from './presets'
import {
  buildTranslatorStepMessages,
  resolveTranslatorPipeline,
  runTranslatorPipeline,
  translatorPipelineSignature,
} from './pipeline'

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

describe('translator pipeline resolution', () => {
  it('resolves legacy settings without mutating the input', () => {
    const state = {
      translatorPrompt: 'Translate {{slot::content}}',
      translatorMaxResponse: 123,
      translatorPresetId: 8,
    }
    const before = structuredClone(state)

    const steps = resolveTranslatorPipeline(state)

    expect(state).toEqual(before)
    expect(steps).toMatchObject([
      {
        enabled: true,
        prompt: 'Translate {{slot::content}}',
        maxResponse: 123,
        model: { mode: 'inheritTranslate' },
      },
    ])
  })
})

describe('buildTranslatorStepMessages', () => {
  it('substitutes language, source, previous, note, prior-output, and unknown-output slots', () => {
    const messages = buildTranslatorStepMessages({
      step: step({
        prompt:
          '<|im_start|>system<|im_sep|>{{slot}}/{{slot::from}}/{{slot::tnote}}<|im_end|>' +
          '<|im_start|>user<|im_sep|>source={{slot::content}} typo={{solt::content}} prev={{slot::prev}} draft={{slot::out::draft}} missing={{slot::out::future}}<|im_end|>',
      }),
      sourceText: 'ORIGINAL',
      prevOutput: 'PREVIOUS',
      outputsByKey: { draft: 'DRAFT' },
      to: 'ko',
      from: 'en',
      translatorNote: 'formal',
    })

    expect(messages).toEqual([
      { role: 'system', content: 'ko/en/formal' },
      {
        role: 'user',
        content: 'source=ORIGINAL typo=ORIGINAL prev=PREVIOUS draft=DRAFT missing=',
      },
    ])
  })

  it('uses the previous output as the fallback user message when the prompt has no input slot', () => {
    expect(
      buildTranslatorStepMessages({
        step: step({ prompt: 'Translate into {{slot}} from {{slot::from}}. {{slot::tnote}}' }),
        sourceText: 'source',
        prevOutput: 'draft',
        outputsByKey: {},
        to: 'ko',
        from: 'en',
        translatorNote: 'note',
      }),
    ).toEqual([
      { role: 'system', content: 'Translate into ko from en. note' },
      { role: 'user', content: 'draft' },
    ])
  })

  it('keeps a non-ChatML prompt with an embedded input as one complete system message', () => {
    expect(
      buildTranslatorStepMessages({
        step: step({ prompt: 'Critique {{slot::prev}} against {{slot::content}}.' }),
        sourceText: 'source',
        prevOutput: 'draft',
        outputsByKey: {},
        to: 'ko',
        from: 'en',
        translatorNote: '',
      }),
    ).toEqual([{ role: 'system', content: 'Critique draft against source.' }])
  })
})

describe('runTranslatorPipeline', () => {
  it('runs enabled steps sequentially and exposes prior named outputs', async () => {
    const runStep = vi.fn().mockResolvedValueOnce('draft output').mockResolvedValueOnce('final output')
    const steps = [
      step({ id: 'draft', prompt: 'Draft {{slot::content}}', maxResponse: 100, outputKey: 'draft' }),
      step({ id: 'skip', enabled: false, prompt: 'skip' }),
      step({
        id: 'refine',
        prompt: 'Refine {{slot::prev}} with {{slot::out::draft}} and {{slot::content}}',
        maxResponse: 200,
      }),
    ]

    await expect(
      runTranslatorPipeline(
        { steps, sourceText: 'source', to: 'ko', from: 'en', translatorNote: '', signal: undefined },
        runStep,
      ),
    ).resolves.toBe('final output')
    expect(runStep).toHaveBeenCalledTimes(2)
    expect(runStep.mock.calls[0][0]).toMatchObject({ maxResponse: 100 })
    expect(runStep.mock.calls[0][0].messages).toEqual([{ role: 'system', content: 'Draft source' }])
    expect(runStep.mock.calls[1][0].messages).toEqual([
      { role: 'system', content: 'Refine draft output with draft output and source' },
    ])
  })

  it('runs the first step when all steps are disabled', async () => {
    const runStep = vi.fn(async () => 'forced')
    await expect(
      runTranslatorPipeline(
        {
          steps: [step({ enabled: false }), step({ id: 'step-b', enabled: false })],
          sourceText: 'source',
          to: 'ko',
          from: 'en',
          translatorNote: '',
        },
        runStep,
      ),
    ).resolves.toBe('forced')
    expect(runStep).toHaveBeenCalledTimes(1)
  })
})

describe('translatorPipelineSignature', () => {
  it('is stable across non-runtime fields and changes for every runtime field', () => {
    const original = createTranslatorPreset('Pipeline', {
      steps: [step({ outputKey: 'draft' })],
    }).steps
    const baseline = translatorPipelineSignature(original)
    const renamed = [{ ...original[0], id: 'other-id', name: 'Other name' }]
    expect(translatorPipelineSignature(renamed)).toEqual(baseline)

    for (const changed of [
      [{ ...original[0], prompt: 'changed' }],
      [{ ...original[0], maxResponse: 200 }],
      [{ ...original[0], enabled: false }],
      [{ ...original[0], outputKey: 'other' }],
      [{ ...original[0], model: { mode: 'modelProfile' as const, profileId: 'profile-a' } }],
    ]) {
      expect(translatorPipelineSignature(changed)).not.toEqual(baseline)
    }
  })
})
