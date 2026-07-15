export const DEFAULT_AGENT_PRESET_DIAGNOSTIC_RUN_LIMIT = 50

export interface AgentPresetPreparedInputSectionDiagnostic {
  scope?: string
  sourceLabel?: string
  charCount?: number
  truncated?: boolean
}

export interface AgentPresetPreparedInputDiagnostic {
  scope?: string
  sourceLabel?: string
  reason?: string
  message?: string
}

export interface AgentPresetStepDiagnostic {
  status: string
  stepId?: string
  stepName?: string
  phase?: string
  outputKey?: string
  destination?: string
  outputFormat?: string
  failurePolicy?: string
  inputChars?: number
  outputChars?: number
  durationMs?: number
  provider?: string
  profileId?: string
  profileName?: string
  modelId?: string
  requestModel?: string
  parseStatus?: string
  preparedInputSections: AgentPresetPreparedInputSectionDiagnostic[]
  preparedInputDiagnostics: AgentPresetPreparedInputDiagnostic[]
  outputPreview?: string
  outputTruncated?: boolean
  failureKind?: string
  failurePolicyOutcome?: string
  error?: string
  reason?: string
}

export interface AgentPresetRunFailureDiagnostic {
  phase?: string
  stepId?: string
  stepName?: string
  outputKey?: string
  message?: string
  failureKind?: string
  failurePolicyOutcome?: string
}

export interface AgentPresetGenerationDiagnostic {
  status: string
  presetId: string
  presetName?: string
  presetVersion?: number
  maxConcurrency?: number
  beforeMainStepCount?: number
  afterMainStepCount?: number
  finalOutputModifierStepId?: string
  promptOutputKeys: string[]
  steps: AgentPresetStepDiagnostic[]
  finalTextModified?: boolean
  mainOutputPreview?: string
  mainOutputChars?: number
  failure?: AgentPresetRunFailureDiagnostic
}

export interface AgentPresetDiagnosticRun {
  key: string
  diagnostic: AgentPresetGenerationDiagnostic
  generationId?: string
  model?: string
  messageTime?: number
  messageIndex: number
  characterId?: string
  characterName?: string
  chatId?: string
  chatName?: string
}

export interface AgentPresetDiagnosticRunCollection {
  runs: AgentPresetDiagnosticRun[]
  total: number
}

export function normalizeAgentPresetGenerationDiagnostic(
  value: unknown,
  expectedPresetId?: string,
): AgentPresetGenerationDiagnostic | null {
  if (!isRecord(value)) return null
  const presetId = readString(value.presetId)
  if (!presetId || (expectedPresetId && presetId !== expectedPresetId)) return null

  return {
    status: readString(value.status) ?? 'unknown',
    presetId,
    presetName: readString(value.presetName),
    presetVersion: readNumber(value.presetVersion),
    maxConcurrency: readNumber(value.maxConcurrency),
    beforeMainStepCount: readNumber(value.beforeMainStepCount),
    afterMainStepCount: readNumber(value.afterMainStepCount),
    finalOutputModifierStepId: readString(value.finalOutputModifierStepId),
    promptOutputKeys: readStringArray(value.promptOutputKeys),
    steps: Array.isArray(value.steps) ? value.steps.flatMap(normalizeStepDiagnostic) : [],
    finalTextModified: readBoolean(value.finalTextModified),
    mainOutputPreview: readString(value.mainOutputPreview, { allowEmpty: true }),
    mainOutputChars: readNumber(value.mainOutputChars),
    failure: normalizeRunFailure(value.failure),
  }
}

export function collectAgentPresetDiagnosticRuns(
  database: unknown,
  presetId: string,
  limit = DEFAULT_AGENT_PRESET_DIAGNOSTIC_RUN_LIMIT,
): AgentPresetDiagnosticRunCollection {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  if (!presetId || normalizedLimit === 0 || !isRecord(database) || !Array.isArray(database.characters)) {
    return { runs: [], total: 0 }
  }

  const runs: Array<AgentPresetDiagnosticRun & { encounterOrder: number }> = []
  let total = 0
  let encounterOrder = 0

  database.characters.forEach((characterValue, characterIndex) => {
    if (!isRecord(characterValue) || !Array.isArray(characterValue.chats)) return
    const characterId = readString(characterValue.chaId)
    const characterName = readString(characterValue.name)

    characterValue.chats.forEach((chatValue, chatIndex) => {
      if (!isRecord(chatValue) || !Array.isArray(chatValue.message)) return
      const chatId = readString(chatValue.id)
      const chatName = readString(chatValue.name)

      chatValue.message.forEach((messageValue, messageIndex) => {
        encounterOrder += 1
        if (!isRecord(messageValue) || !isRecord(messageValue.generationInfo)) return
        const diagnostic = normalizeAgentPresetGenerationDiagnostic(messageValue.generationInfo.agentPreset, presetId)
        if (!diagnostic) return

        total += 1
        const generationId = readString(messageValue.generationInfo.generationId)
        const run: AgentPresetDiagnosticRun & { encounterOrder: number } = {
          key: diagnosticRunKey({
            characterIndex,
            chatIndex,
            messageIndex,
            generationId,
          }),
          diagnostic,
          generationId,
          model: readString(messageValue.generationInfo.model),
          messageTime: readNumber(messageValue.time),
          messageIndex,
          characterId,
          characterName,
          chatId,
          chatName,
          encounterOrder,
        }
        runs.push(run)
        runs.sort(compareDiagnosticRuns)
        if (runs.length > normalizedLimit) runs.pop()
      })
    })
  })

  return {
    runs: runs.map(({ encounterOrder: _encounterOrder, ...run }) => run),
    total,
  }
}

function normalizeStepDiagnostic(value: unknown): AgentPresetStepDiagnostic[] {
  if (!isRecord(value)) return []
  const status = readString(value.status)
  if (!status) return []
  return [
    {
      status,
      stepId: readString(value.stepId),
      stepName: readString(value.stepName),
      phase: readString(value.phase),
      outputKey: readString(value.outputKey),
      destination: readString(value.destination),
      outputFormat: readString(value.outputFormat),
      failurePolicy: readString(value.failurePolicy),
      inputChars: readNumber(value.inputChars),
      outputChars: readNumber(value.outputChars),
      durationMs: readNumber(value.durationMs),
      provider: readString(value.provider),
      profileId: readString(value.profileId),
      profileName: readString(value.profileName),
      modelId: readString(value.modelId),
      requestModel: readString(value.requestModel),
      parseStatus: readString(value.parseStatus),
      preparedInputSections: Array.isArray(value.preparedInputSections)
        ? value.preparedInputSections.flatMap(normalizePreparedInputSection)
        : [],
      preparedInputDiagnostics: Array.isArray(value.preparedInputDiagnostics)
        ? value.preparedInputDiagnostics.flatMap(normalizePreparedInputDiagnostic)
        : [],
      outputPreview: readString(value.outputPreview, { allowEmpty: true }),
      outputTruncated: readBoolean(value.outputTruncated),
      failureKind: readString(value.failureKind),
      failurePolicyOutcome: readString(value.failurePolicyOutcome),
      error: readString(value.error, { allowEmpty: true }),
      reason: readString(value.reason),
    },
  ]
}

function normalizePreparedInputSection(value: unknown): AgentPresetPreparedInputSectionDiagnostic[] {
  if (!isRecord(value)) return []
  const section = {
    scope: readString(value.scope),
    sourceLabel: readString(value.sourceLabel),
    charCount: readNumber(value.charCount),
    truncated: readBoolean(value.truncated),
  }
  return Object.values(section).some((field) => field !== undefined) ? [section] : []
}

function normalizePreparedInputDiagnostic(value: unknown): AgentPresetPreparedInputDiagnostic[] {
  if (!isRecord(value)) return []
  const diagnostic = {
    scope: readString(value.scope),
    sourceLabel: readString(value.sourceLabel),
    reason: readString(value.reason),
    message: readString(value.message, { allowEmpty: true }),
  }
  return Object.values(diagnostic).some((field) => field !== undefined) ? [diagnostic] : []
}

function normalizeRunFailure(value: unknown): AgentPresetRunFailureDiagnostic | undefined {
  if (!isRecord(value)) return undefined
  const failure = {
    phase: readString(value.phase),
    stepId: readString(value.stepId),
    stepName: readString(value.stepName),
    outputKey: readString(value.outputKey),
    message: readString(value.message, { allowEmpty: true }),
    failureKind: readString(value.failureKind),
    failurePolicyOutcome: readString(value.failurePolicyOutcome),
  }
  return Object.values(failure).some((field) => field !== undefined) ? failure : undefined
}

function compareDiagnosticRuns(
  left: AgentPresetDiagnosticRun & { encounterOrder: number },
  right: AgentPresetDiagnosticRun & { encounterOrder: number },
): number {
  const timeDifference =
    (right.messageTime ?? Number.NEGATIVE_INFINITY) - (left.messageTime ?? Number.NEGATIVE_INFINITY)
  return timeDifference || right.encounterOrder - left.encounterOrder
}

function diagnosticRunKey(input: {
  characterIndex: number
  chatIndex: number
  messageIndex: number
  generationId?: string
}): string {
  return `${input.characterIndex}:${input.chatIndex}:${input.messageIndex}:${input.generationId ?? ''}`
}

function readString(value: unknown, options: { allowEmpty?: boolean } = {}): string | undefined {
  if (typeof value !== 'string') return undefined
  if (!options.allowEmpty && value.length === 0) return undefined
  return value
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
