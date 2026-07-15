import { describe, expect, it } from 'vitest'
import { collectAgentPresetDiagnosticRuns, normalizeAgentPresetGenerationDiagnostic } from './agentPresetDiagnostics'

function diagnostic(presetId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'ready',
    presetId,
    presetName: 'Research Agent',
    presetVersion: 2,
    promptOutputKeys: ['context'],
    steps: [],
    finalTextModified: false,
    ...overrides,
  }
}

function message(presetId: string, time?: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: 'char',
    data: 'Assistant response',
    time,
    generationInfo: {
      generationId: `generation-${time ?? 'unknown'}`,
      model: 'test-model',
      agentPreset: diagnostic(presetId, overrides),
    },
  }
}

describe('Agent Preset diagnostics', () => {
  it('normalizes the persisted server shape without retaining unknown nested values', () => {
    const normalized = normalizeAgentPresetGenerationDiagnostic(
      diagnostic('ap_a', {
        steps: [
          {
            status: 'success',
            stepId: 'aps_a',
            stepName: 'Gather Context',
            phase: 'beforeMain',
            outputKey: 'context',
            destination: 'promptOutput',
            outputFormat: 'text',
            failurePolicy: 'required',
            inputChars: 120,
            outputChars: 20,
            durationMs: 15,
            provider: 'openai',
            profileName: 'Agent Profile',
            modelId: 'agent-model',
            parseStatus: 'not_applicable',
            preparedInputSections: [
              { scope: 'currentUserMessage', sourceLabel: 'Current user message', charCount: 120, truncated: false },
            ],
            preparedInputDiagnostics: [{ scope: 'memoryContext', reason: 'empty', message: 'No saved memory.' }],
            outputPreview: 'Hidden result',
            outputTruncated: false,
            ignored: { very: 'large' },
          },
          null,
        ],
        ignored: '<script>not retained</script>',
      }),
      'ap_a',
    )

    expect(normalized).toMatchObject({
      status: 'ready',
      presetId: 'ap_a',
      presetName: 'Research Agent',
      presetVersion: 2,
      promptOutputKeys: ['context'],
      finalTextModified: false,
      steps: [
        {
          status: 'success',
          stepId: 'aps_a',
          outputPreview: 'Hidden result',
          preparedInputSections: [{ scope: 'currentUserMessage', charCount: 120, truncated: false }],
          preparedInputDiagnostics: [{ scope: 'memoryContext', reason: 'empty', message: 'No saved memory.' }],
        },
      ],
    })
    expect(normalized).not.toHaveProperty('ignored')
    expect(normalized?.steps[0]).not.toHaveProperty('ignored')
  })

  it('rejects malformed diagnostics and records for a different preset', () => {
    expect(normalizeAgentPresetGenerationDiagnostic(null, 'ap_a')).toBeNull()
    expect(normalizeAgentPresetGenerationDiagnostic([], 'ap_a')).toBeNull()
    expect(normalizeAgentPresetGenerationDiagnostic({ status: 'ready' }, 'ap_a')).toBeNull()
    expect(normalizeAgentPresetGenerationDiagnostic(diagnostic('ap_b'), 'ap_a')).toBeNull()
  })

  it('drops malformed nested rows, empty failures, and duplicate keyed output values', () => {
    const normalized = normalizeAgentPresetGenerationDiagnostic(
      diagnostic('ap_a', {
        promptOutputKeys: ['context', 'context', 42, 'review'],
        failure: {},
        steps: [{}, { status: 'success', stepName: 'Valid step' }, null],
      }),
      'ap_a',
    )

    expect(normalized?.promptOutputKeys).toEqual(['context', 'review'])
    expect(normalized?.failure).toBeUndefined()
    expect(normalized?.steps).toEqual([
      expect.objectContaining({
        status: 'success',
        stepName: 'Valid step',
      }),
    ])
  })

  it('collects only matching runs newest-first with an encounter-order fallback', () => {
    const database = {
      characters: [
        {
          chaId: 'char-a',
          name: 'Character A',
          chats: [
            {
              id: 'chat-a',
              name: 'Chat A',
              message: [message('ap_a', 100), message('ap_b', 500), message('ap_a'), message('ap_a', 300)],
            },
          ],
        },
      ],
    }

    const collected = collectAgentPresetDiagnosticRuns(database, 'ap_a')

    expect(collected.total).toBe(3)
    expect(collected.runs.map((run) => run.messageTime)).toEqual([300, 100, undefined])
    expect(collected.runs[0]).toMatchObject({
      characterId: 'char-a',
      characterName: 'Character A',
      chatId: 'chat-a',
      chatName: 'Chat A',
      generationId: 'generation-300',
      model: 'test-model',
      messageIndex: 3,
    })
  })

  it('bounds retained runs while reporting the full matching total', () => {
    const database = {
      characters: [
        {
          chats: [
            {
              message: [message('ap_a', 1), message('ap_a', 4), message('ap_a', 2), message('ap_a', 3)],
            },
          ],
        },
      ],
    }

    const collected = collectAgentPresetDiagnosticRuns(database, 'ap_a', 2)

    expect(collected.total).toBe(4)
    expect(collected.runs.map((run) => run.messageTime)).toEqual([4, 3])
  })
})
