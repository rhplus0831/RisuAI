import { describe, expect, it, vi } from 'vitest'
import type { AgentPresetRecord, AgentPresetStepRecord } from '../../../src/ts/agentPresetRecords'
import { planAgentPreset } from '../../../src/ts/agentPresetResolver'
import { resolveModelProfile } from '../../../src/ts/model/modelProfileResolver'
import type { Chat, Database, Message, character } from '../../../src/ts/storage/database.svelte'
import {
  buildAgentPresetStepMessages,
  collectAgentPresetPreparedInputs,
  executeAgentPresetPhase,
  executeAgentPresetStep,
  resolveAgentPresetStepProfile,
  type AgentPresetProviderDispatcher,
  type AgentPresetStepExecutor,
} from '../src/prompt/agentPresetExecution.js'

function db(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'debug-echo',
    subModel: 'debug-echo',
    modelRoles: {},
    modelProfiles: [],
    modelRoleProfiles: {},
    modelRuntimeDefaults: {},
    customModels: [],
    modelTools: ['legacy-tool'],
    maxResponse: 512,
    maxContext: 8192,
    temperature: 50,
    frequencyPenalty: -1000,
    PresensePenalty: -1000,
    useStreaming: true,
    genTime: 1,
    extractJson: '',
    OaiCompAPIKeys: {},
    openrouterProvider: { order: [], only: [], ignore: [] },
    username: 'Mira',
    personaPrompt: 'Writes careful field notes.',
    selectedPersona: 0,
    personas: [{ id: 'persona-a', name: 'Mira', icon: '', personaPrompt: 'Writes careful field notes.' }],
    characters: [char()],
    ...overrides,
  } as unknown as Database
}

function char(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    nickname: 'Keeper Tess',
    chaId: 'char-tess',
    chatPage: 0,
    chats: [chat()],
    desc: 'A keeper at the north lighthouse.',
    personality: 'Patient and observant.',
    scenario: 'Storm season is beginning.',
    systemPrompt: 'Stay grounded.',
    postHistoryInstructions: 'Preserve continuity.',
    creatorNotes: 'Created for memory tests.',
    globalLore: [],
    utilityBot: false,
    ...overrides,
  } as unknown as character
}

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-a',
    name: 'Lighthouse',
    note: '',
    localLore: [],
    lastMemory: 'The lantern must stay lit.',
    message: [
      { role: 'user', data: 'Remember the lighthouse promise.' },
      { role: 'char', data: 'I will keep the lantern lit.' },
      { role: 'user', data: 'What did we promise about the lantern?' },
    ] as Message[],
    ...overrides,
  } as unknown as Chat
}

function step(overrides: Partial<AgentPresetStepRecord> = {}): AgentPresetStepRecord {
  return {
    id: 'aps_context',
    name: 'Gather Context',
    enabled: true,
    phase: 'beforeMain',
    dependencies: [],
    instruction: 'Summarize the useful context.',
    model: { mode: 'inheritMain' },
    runtime: {
      temperature: 40,
      maxInputChars: 20_000,
      maxOutputChars: 1_200,
      timeoutMs: 30_000,
    },
    inputScopes: ['currentUserMessage', 'recentChatTail'],
    outputKey: 'context',
    outputFormat: 'text',
    destination: 'promptOutput',
    failurePolicy: { mode: 'required' },
    ...overrides,
  }
}

function preset(steps: AgentPresetStepRecord[]): AgentPresetRecord {
  return {
    id: 'ap_test',
    name: 'Test Agent',
    enabled: true,
    version: 1,
    steps,
  }
}

function beforeMainPlan(database: Database, steps: AgentPresetStepRecord[]) {
  const planning = planAgentPreset({ database, preset: preset(steps) })
  expect(planning.plan).toBeDefined()
  return planning.plan!.beforeMain
}

async function* frames(text: string) {
  yield { kind: 'token' as const, content: text }
  yield { kind: 'done' as const, finishReason: 'stop' }
}

describe('Agent Preset prepared inputs', () => {
  it('collects sections in deterministic scope order and respects the max input bound', () => {
    const database = db()
    const currentChar = database.characters[0]
    const currentChat = currentChar.chats[0]
    const collection = collectAgentPresetPreparedInputs(
      step({
        runtime: { maxInputChars: 2_000 },
        inputScopes: ['personaSummary', 'recentChatTail', 'currentUserMessage', 'characterSummary'],
      }),
      {
        database,
        currentChar,
        currentChat,
        currentUserMessage: 'Lantern promise?',
      },
    )

    expect(collection.sections.map((section) => section.scope)).toEqual([
      'recentChatTail',
      'characterSummary',
      'personaSummary',
      'currentUserMessage',
    ])

    const bounded = collectAgentPresetPreparedInputs(
      step({
        runtime: { maxInputChars: 90 },
        inputScopes: ['personaSummary', 'recentChatTail', 'currentUserMessage', 'characterSummary'],
      }),
      {
        database,
        currentChar,
        currentChat,
        currentUserMessage: 'Lantern promise?',
      },
    )
    expect(bounded.sections.map((section) => section.scope)).toEqual(['recentChatTail'])
    expect(bounded.totalChars).toBeLessThanOrEqual(90)
    expect(bounded.diagnostics.map((diagnostic) => diagnostic.reason)).toContain('max_input_exhausted')
  })

  it('builds text and JSON prompt shapes without tool declarations', () => {
    const preparedInputs = collectAgentPresetPreparedInputs(step(), {
      database: db(),
      currentChar: char(),
      currentChat: chat(),
      currentUserMessage: 'Lantern promise?',
    })

    const textMessages = buildAgentPresetStepMessages({
      step: step({ instruction: 'Question:\n{{currentUserMessage}}\n\nSummarize the useful context.' }),
      preparedInputs,
    })
    expect(textMessages).toHaveLength(2)
    expect(textMessages[0]).toMatchObject({ role: 'system' })
    expect(textMessages[0].content).toContain('Return free text only')
    expect(textMessages[1].content).toContain('Question:\nLantern promise?')
    expect(textMessages[1].content).not.toContain('Prepared input -')
    expect(JSON.stringify(textMessages)).not.toContain('"tools"')

    const jsonMessages = buildAgentPresetStepMessages({
      step: step({ outputFormat: 'jsonObject' }),
      preparedInputs,
    })
    expect(jsonMessages[0].content).toContain('Return exactly one JSON object')
    expect(jsonMessages[1].content).not.toContain('Lantern promise?')
  })

  it('does not auto-insert selected prepared inputs without matching CBS placeholders', () => {
    const preparedInputs = collectAgentPresetPreparedInputs(step(), {
      database: db(),
      currentChar: char(),
      currentChat: chat(),
      currentUserMessage: 'Lantern promise?',
    })

    const messages = buildAgentPresetStepMessages({ step: step(), preparedInputs })
    expect(messages[1].content).toBe('Author instruction:\nSummarize the useful context.')
    expect(messages[1].content).not.toContain('Lantern promise?')
    expect(messages[1].content).not.toContain('Remember the lighthouse promise.')
  })

  it('expands agent output CBS in step instructions from the provided output map', () => {
    const preparedInputs = collectAgentPresetPreparedInputs(step(), {
      database: db(),
      currentChar: char(),
      currentChat: chat(),
    })

    const messages = buildAgentPresetStepMessages({
      step: step({ instruction: 'Prior result:\n{{agent::context}}' }),
      preparedInputs,
      agentOutputs: { context: 'already-generated context' },
    })

    expect(messages[1].content).toContain('Prior result:\nalready-generated context')
    expect(messages[1].content).not.toContain('{{agent::context}}')
  })
})

describe('Agent Preset phase execution', () => {
  function successResult(step: AgentPresetStepRecord, outputText: string) {
    return {
      status: 'success' as const,
      stepId: step.id,
      stepName: step.name,
      outputKey: step.outputKey,
      outputText,
      outputTruncated: false,
      diagnostics: {
        phase: step.phase,
        outputFormat: step.outputFormat,
        destination: step.destination,
        failurePolicy: step.failurePolicy.mode,
        inputChars: 0,
        outputChars: outputText.length,
        startedAt: 1,
        endedAt: 2,
        durationMs: 1,
        preparedInputSections: [],
        preparedInputDiagnostics: [],
        parseStatus: step.outputFormat === 'jsonObject' ? ('ok' as const) : ('not_applicable' as const),
      },
    }
  }

  function failedResult(step: AgentPresetStepRecord, outcome: 'optional_failure' | 'required_failure') {
    return {
      status: 'failed' as const,
      stepId: step.id,
      stepName: step.name,
      outputKey: step.outputKey,
      failureKind: 'provider_error' as const,
      failurePolicyOutcome: outcome,
      error: `${step.name} failed`,
      diagnostics: {
        phase: step.phase,
        outputFormat: step.outputFormat,
        destination: step.destination,
        failurePolicy: step.failurePolicy.mode,
        inputChars: 0,
        outputChars: 0,
        startedAt: 1,
        endedAt: 2,
        durationMs: 1,
        preparedInputSections: [],
        preparedInputDiagnostics: [],
        parseStatus: 'not_applicable' as const,
      },
    }
  }

  function skippedDependencyResult(step: AgentPresetStepRecord) {
    return {
      status: 'skipped' as const,
      reason: 'dependency_skipped' as const,
      stepId: step.id,
      stepName: step.name,
      outputKey: step.outputKey,
      diagnostics: {
        phase: step.phase,
        outputFormat: step.outputFormat,
        destination: step.destination,
        failurePolicy: step.failurePolicy.mode,
        inputChars: 0,
        outputChars: 0,
        startedAt: 1,
        endedAt: 2,
        durationMs: 1,
        preparedInputSections: [],
        preparedInputDiagnostics: [],
      },
    }
  }

  it('runs independent steps with deterministic stable output order', async () => {
    const database = db()
    const first = step({ id: 'aps_first', outputKey: 'first', name: 'First' })
    const second = step({ id: 'aps_second', outputKey: 'second', name: 'Second' })
    const calls: string[] = []
    const executeStep: AgentPresetStepExecutor = async (input) => {
      calls.push(input.step.id)
      if (input.step.id === 'aps_first') {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      return successResult(input.step, `${input.step.outputKey}-output`)
    }

    const result = await executeAgentPresetPhase({
      database,
      currentChar: database.characters[0],
      currentChat: database.characters[0].chats[0],
      plan: beforeMainPlan(database, [first, second]),
      maxConcurrency: 2,
      executeStep,
    })

    expect(calls.sort()).toEqual(['aps_first', 'aps_second'])
    expect(result.blockingFailure).toBeUndefined()
    expect(result.successfulOutputs.map((output) => output.outputKey)).toEqual(['first', 'second'])
    expect(result.previousAgentOutputs.map((output) => output.text)).toEqual(['first-output', 'second-output'])
  })

  it('reports aggregate progress while independent steps run concurrently', async () => {
    const database = db()
    const first = step({ id: 'aps_first', outputKey: 'first', name: 'First' })
    const second = step({ id: 'aps_second', outputKey: 'second', name: 'Second' })
    const snapshots: Array<{
      status: string
      completedSteps: number
      activeSteps: Array<{ stepId: string }>
    }> = []
    let releaseSteps: () => void = () => {}
    const stepGate = new Promise<void>((resolve) => {
      releaseSteps = resolve
    })

    const execution = executeAgentPresetPhase({
      database,
      currentChar: database.characters[0],
      currentChat: database.characters[0].chats[0],
      plan: beforeMainPlan(database, [first, second]),
      maxConcurrency: 2,
      executeStep: async (input) => {
        await stepGate
        return successResult(input.step, `${input.step.outputKey}-output`)
      },
      onProgress: (progress) => snapshots.push(structuredClone(progress)),
    })

    expect(snapshots[0]).toMatchObject({ status: 'started', completedSteps: 0, activeSteps: [] })
    expect(snapshots).toContainEqual(
      expect.objectContaining({
        status: 'running',
        completedSteps: 0,
        activeSteps: [
          expect.objectContaining({ stepId: 'aps_first' }),
          expect.objectContaining({ stepId: 'aps_second' }),
        ],
      }),
    )

    releaseSteps()
    await execution

    expect(snapshots).toContainEqual(
      expect.objectContaining({
        status: 'running',
        completedSteps: 1,
        activeSteps: [expect.objectContaining({ stepId: 'aps_second' })],
      }),
    )
    expect(snapshots.at(-1)).toMatchObject({ status: 'finished', completedSteps: 2, activeSteps: [] })
  })

  it('exposes completed output keys only after their dependency level has finished', async () => {
    const database = db()
    const first = step({ id: 'aps_first', outputKey: 'first', name: 'First' })
    const second = step({
      id: 'aps_second',
      outputKey: 'second',
      name: 'Second',
      dependencies: ['aps_first'],
    })
    const sibling = step({ id: 'aps_sibling', outputKey: 'sibling', name: 'Sibling' })
    const seen: Record<string, Record<string, string>> = {}
    const executeStep: AgentPresetStepExecutor = async (input) => {
      seen[input.step.id] = { ...(input.agentOutputs ?? {}) }
      return successResult(input.step, `${input.step.outputKey}-output`)
    }

    const result = await executeAgentPresetPhase({
      database,
      currentChar: database.characters[0],
      currentChat: database.characters[0].chats[0],
      plan: beforeMainPlan(database, [first, second, sibling]),
      maxConcurrency: 1,
      executeStep,
    })

    expect(seen.aps_first).toEqual({})
    expect(seen.aps_sibling).toEqual({})
    expect(seen.aps_second).toEqual({ first: 'first-output', sibling: 'sibling-output' })
    expect(result.outputTextByKey).toEqual({
      first: 'first-output',
      sibling: 'sibling-output',
      second: 'second-output',
    })
  })

  it('carries before-main output keys into later phases', async () => {
    const database = db()
    const after = step({ id: 'aps_after', phase: 'afterMain', outputKey: 'after', name: 'After' })
    let seen: Record<string, string> | undefined
    const executeStep: AgentPresetStepExecutor = async (input) => {
      seen = { ...(input.agentOutputs ?? {}) }
      return successResult(input.step, 'after-output')
    }

    await executeAgentPresetPhase({
      database,
      currentChar: database.characters[0],
      currentChat: database.characters[0].chats[0],
      previousAgentOutputs: [
        {
          stepId: 'aps_before',
          stepName: 'Before',
          phase: 'beforeMain',
          outputKey: 'before',
          text: 'before-output',
        },
      ],
      plan: planAgentPreset({ database, preset: preset([after]) }).plan!.afterMain,
      executeStep,
    })

    expect(seen).toEqual({ before: 'before-output' })
  })

  it('continues after optional failures but blocks required dependency propagation', async () => {
    const database = db()
    const optional = step({
      id: 'aps_optional',
      outputKey: 'optional',
      name: 'Optional',
      failurePolicy: { mode: 'optional' },
    })
    const dependent = step({
      id: 'aps_dependent',
      outputKey: 'dependent',
      name: 'Dependent',
      dependencies: ['aps_optional'],
      failurePolicy: { mode: 'required' },
    })
    const executeStep = vi.fn<AgentPresetStepExecutor>(async (input) => {
      if (input.step.id === 'aps_optional') return failedResult(input.step, 'optional_failure')
      expect(input.dependencySkippedReason).toContain('Optional')
      return skippedDependencyResult(input.step)
    })
    const progressStatuses: string[] = []

    const result = await executeAgentPresetPhase({
      database,
      currentChar: database.characters[0],
      currentChat: database.characters[0].chats[0],
      plan: beforeMainPlan(database, [optional, dependent]),
      executeStep,
      onProgress: (progress) => progressStatuses.push(progress.status),
    })

    expect(executeStep).toHaveBeenCalledTimes(2)
    expect(result.blockingFailure).toMatchObject({
      stepId: 'aps_dependent',
      outputKey: 'dependent',
    })
    expect(result.stepResults.map((entry) => entry.status)).toEqual(['failed', 'skipped'])
    expect(progressStatuses.at(-1)).toBe('error')
  })
})

describe('Agent Preset step execution', () => {
  it('resolves inherit-main and selected model profiles', () => {
    const database = db({
      modelProfiles: [
        {
          id: 'ready-echo',
          name: 'Ready Echo',
          providerId: 'debug-echo',
          modelId: 'debug-echo',
          providerOptions: { requestModel: 'debug-wire', baseUrl: 'debug://echo' },
        },
      ],
    })
    const mainProfile = resolveModelProfile({ database })

    expect(resolveAgentPresetStepProfile({ database, step: step(), resolvedMainProfile: mainProfile })).toBe(
      mainProfile,
    )
    expect(
      resolveAgentPresetStepProfile({
        database,
        step: step({ model: { mode: 'modelProfile', profileId: 'ready-echo' } }),
        resolvedMainProfile: mainProfile,
      }),
    ).toMatchObject({
      source: { profileId: 'ready-echo', profileName: 'Ready Echo' },
      requestModel: 'debug-wire',
    })
  })

  it('executes a selected-profile step non-streaming with bounded output and no tools', async () => {
    const database = db({
      modelProfiles: [
        {
          id: 'ready-echo',
          name: 'Ready Echo',
          providerId: 'debug-echo',
          modelId: 'debug-echo',
          providerOptions: { requestModel: 'debug-wire', baseUrl: 'debug://echo' },
        },
      ],
    })
    const dispatch = vi.fn<AgentPresetProviderDispatcher>(async (args) => {
      expect(args.database.useStreaming).toBe(false)
      expect(args.database.modelTools).toEqual([])
      expect(args.outputTokens).toBe(12)
      expect(args.profile.source.profileId).toBe('ready-echo')
      expect(JSON.stringify(args.messages)).not.toContain('"tools"')
      expect(JSON.stringify(args.messages)).toContain('Question:\\nLantern promise?')
      expect(JSON.stringify(args.messages)).not.toContain('Remember the lighthouse promise.')
      return frames('abcdefghijklmnop')
    })

    const result = await executeAgentPresetStep({
      database,
      currentChar: database.characters[0],
      currentChat: database.characters[0].chats[0],
      step: step({
        instruction: 'Question:\n{{currentUserMessage}}',
        model: { mode: 'modelProfile', profileId: 'ready-echo' },
        runtime: { maxOutputChars: 12, timeoutMs: 1_000 },
      }),
      currentUserMessage: 'Lantern promise?',
      dispatchProvider: dispatch,
    })

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      status: 'success',
      outputText: 'abcdefghi...',
      outputTruncated: true,
      diagnostics: {
        profileId: 'ready-echo',
        requestModel: 'debug-wire',
      },
    })
    expect(result.diagnostics.preparedInputSections.map((section) => section.scope)).toEqual(['currentUserMessage'])
  })

  it('parses JSON object output and fails invalid JSON according to policy', async () => {
    const database = db()
    const currentChar = database.characters[0]
    const currentChat = currentChar.chats[0]

    await expect(
      executeAgentPresetStep({
        database,
        currentChar,
        currentChat,
        step: step({ outputFormat: 'jsonObject' }),
        dispatchProvider: async () => frames('{"ok": true}'),
      }),
    ).resolves.toMatchObject({
      status: 'success',
      parsedJson: { ok: true },
      diagnostics: { parseStatus: 'ok' },
    })

    await expect(
      executeAgentPresetStep({
        database,
        currentChar,
        currentChat,
        step: step({ outputFormat: 'jsonObject', failurePolicy: { mode: 'required' } }),
        dispatchProvider: async () => frames('not json'),
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      failureKind: 'invalid_json_output',
      failurePolicyOutcome: 'required_failure',
      diagnostics: { parseStatus: 'invalid' },
    })

    await expect(
      executeAgentPresetStep({
        database,
        currentChar,
        currentChat,
        step: step({
          outputFormat: 'jsonObject',
          failurePolicy: { mode: 'fallbackText', text: 'fallback prose' },
        }),
        dispatchProvider: async () => frames('not json'),
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      failureKind: 'invalid_json_output',
      failurePolicyOutcome: 'fallback_text',
      diagnostics: { parseStatus: 'invalid' },
    })

    await expect(
      executeAgentPresetStep({
        database,
        currentChar,
        currentChat,
        step: step({
          outputFormat: 'jsonObject',
          failurePolicy: { mode: 'fallbackText', text: '{"fallback":true}' },
        }),
        dispatchProvider: async () => {
          throw new Error('provider exploded')
        },
      }),
    ).resolves.toMatchObject({
      status: 'success',
      parsedJson: { fallback: true },
      diagnostics: { parseStatus: 'ok' },
    })
  })

  it('returns optional, required, and timeout failure shapes', async () => {
    const database = db()
    const base = {
      database,
      currentChar: database.characters[0],
      currentChat: database.characters[0].chats[0],
    }

    await expect(
      executeAgentPresetStep({
        ...base,
        step: step({ failurePolicy: { mode: 'optional' } }),
        dispatchProvider: async () => {
          throw new Error('provider exploded')
        },
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      failureKind: 'provider_error',
      failurePolicyOutcome: 'optional_failure',
    })

    await expect(
      executeAgentPresetStep({
        ...base,
        step: step({ failurePolicy: { mode: 'required' } }),
        dispatchProvider: async () => frames(''),
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      failureKind: 'empty_output',
      failurePolicyOutcome: 'required_failure',
    })

    await expect(
      executeAgentPresetStep({
        ...base,
        step: step({ runtime: { timeoutMs: 250 } }),
        dispatchProvider: async () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(frames('late')), 1_000)
          }),
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      failureKind: 'timeout',
    })
  })
})
