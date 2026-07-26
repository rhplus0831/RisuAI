import { describe, expect, it, vi } from 'vitest'
import { createTranslatorPreset, type TranslatorPresetStep } from './presets'
import {
  buildTranslatorStepMessages,
  hasMalformedTranslatorHistorySlot,
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

  it('resolves valid history slots and removes invalid counts', () => {
    const historyResolver = vi.fn((kind: 'source' | 'translated', n: number) => `${kind}-${n}`)

    expect(
      buildTranslatorStepMessages({
        step: step({
          prompt:
            '{{slot::content}} {{slot::history::1}} {{slot::historytrans::50}} {{slot::history::0}} {{slot::history::-1}} {{slot::history::51}} {{slot::historytrans::many}} {{slot::history}}',
        }),
        sourceText: 'source',
        prevOutput: 'draft',
        outputsByKey: {},
        to: 'ko',
        from: 'en',
        translatorNote: '',
        historyResolver,
      }),
    ).toEqual([
      {
        role: 'system',
        content: 'source source-1 translated-50     {{slot::history}}',
      },
    ])
    expect(historyResolver.mock.calls).toEqual([
      ['source', 1],
      ['translated', 50],
    ])
  })

  it('removes history slots when no resolver is supplied and does not treat them as embedded input', () => {
    expect(
      buildTranslatorStepMessages({
        step: step({ prompt: 'Context: {{slot::history::2}} / {{slot::historytrans::2}}' }),
        sourceText: 'source',
        prevOutput: 'draft',
        outputsByKey: {},
        to: 'ko',
        from: 'en',
        translatorNote: '',
      }),
    ).toEqual([
      { role: 'system', content: 'Context:  / ' },
      { role: 'user', content: 'draft' },
    ])
  })

  it('resolves multiple history window sizes independently', () => {
    const historyResolver = vi.fn((kind: 'source' | 'translated', n: number) => `${kind}:${n}`)
    const messages = buildTranslatorStepMessages({
      step: step({ prompt: '{{slot::content}} {{slot::history::1}} | {{slot::history::3}}' }),
      sourceText: 'source',
      prevOutput: 'draft',
      outputsByKey: {},
      to: 'ko',
      from: 'en',
      translatorNote: '',
      historyResolver,
    })

    expect(messages).toEqual([{ role: 'system', content: 'source source:1 | source:3' }])
    expect(historyResolver.mock.calls).toEqual([
      ['source', 1],
      ['source', 3],
    ])
  })

  it('does not apply other slot substitutions inside resolved history content', () => {
    expect(
      buildTranslatorStepMessages({
        step: step({ prompt: '{{slot::content}} {{slot::history::1}}' }),
        sourceText: 'source',
        prevOutput: 'draft',
        outputsByKey: {},
        to: 'ko',
        from: 'en',
        translatorNote: 'note',
        historyResolver: () => 'raw {{slot::tnote}} body',
      }),
    ).toEqual([{ role: 'system', content: 'source raw {{slot::tnote}} body' }])
  })
})

describe('hasMalformedTranslatorHistorySlot', () => {
  it('accepts valid history slots and flags malformed or out-of-range forms', () => {
    expect(hasMalformedTranslatorHistorySlot('{{slot::history::1}} {{slot::historytrans::50}}')).toBe(false)
    expect(hasMalformedTranslatorHistorySlot('{{slot::history}}')).toBe(true)
    expect(hasMalformedTranslatorHistorySlot('{{slot::history::0}}')).toBe(true)
    expect(hasMalformedTranslatorHistorySlot('{{slot::historytrans::51}}')).toBe(true)
    expect(hasMalformedTranslatorHistorySlot('{{slot::history::oops}}')).toBe(true)
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

  it('removes internal reasoning before chaining or returning LLM translations', async () => {
    const runStep = vi
      .fn()
      .mockResolvedValueOnce(
        '<Thoughts data-private="true">draft secret <think>nested secret</think></Thoughts>\n\ndraft output',
      )
      .mockResolvedValueOnce('<think>final secret</think>\n<THOUGHTS>more secret</THOUGHTS>\nfinal output')

    await expect(
      runTranslatorPipeline(
        {
          steps: [
            step({ id: 'draft', prompt: 'Draft {{slot::content}}', outputKey: 'draft' }),
            step({ id: 'refine', prompt: 'Refine {{slot::prev}} with {{slot::out::draft}}' }),
          ],
          sourceText: 'source',
          to: 'ko',
          from: 'en',
          translatorNote: '',
        },
        runStep,
      ),
    ).resolves.toBe('final output')
    expect(runStep.mock.calls[1][0].messages).toEqual([
      { role: 'system', content: 'Refine draft output with draft output' },
    ])
  })

  it('drops an unfinished internal-reasoning tail from an LLM translation', async () => {
    await expect(
      runTranslatorPipeline(
        {
          steps: [step()],
          sourceText: 'source',
          to: 'ko',
          from: 'en',
          translatorNote: '',
        },
        async () => 'translated text\n<Thoughts>unfinished private reasoning',
      ),
    ).resolves.toBe('translated text')
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

  it('passes the same history resolver through every enabled step', async () => {
    const runStep = vi.fn().mockResolvedValueOnce('draft').mockResolvedValueOnce('final')
    const historyResolver = vi.fn((kind: 'source' | 'translated', n: number) => `${kind}-${n}`)

    await runTranslatorPipeline(
      {
        steps: [
          step({ id: 'one', prompt: '{{slot::content}} {{slot::history::2}}' }),
          step({ id: 'two', prompt: '{{slot::prev}} {{slot::history::2}} {{slot::historytrans::2}}' }),
        ],
        sourceText: 'source',
        to: 'ko',
        from: 'en',
        translatorNote: '',
        historyResolver,
      },
      runStep,
    )

    expect(runStep.mock.calls[0][0].messages).toEqual([{ role: 'system', content: 'source source-2' }])
    expect(runStep.mock.calls[1][0].messages).toEqual([{ role: 'system', content: 'draft source-2 translated-2' }])
    expect(historyResolver.mock.results.map((result) => result.value)).toEqual(['source-2', 'source-2', 'translated-2'])
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
