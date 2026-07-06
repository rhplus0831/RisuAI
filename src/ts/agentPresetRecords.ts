export const AGENT_PRESET_SCHEMA_VERSION = 1

export const AGENT_PRESET_STEP_PHASES = ['beforeMain', 'afterMain'] as const
export const AGENT_PRESET_STEP_OUTPUT_FORMATS = ['text', 'jsonObject'] as const
export const AGENT_PRESET_STEP_INPUT_SCOPES = [
  'recentChatTail',
  'chatSearchSnippets',
  'lorebookContext',
  'memoryContext',
  'characterSummary',
  'personaSummary',
  'currentUserMessage',
  'previousAgentOutputs',
  'mainDraft',
] as const
export const AGENT_PRESET_STEP_DESTINATIONS = ['promptOutput', 'intermediate', 'finalOutput'] as const

export const AGENT_PRESET_MAX_CONCURRENCY_MIN = 1
export const AGENT_PRESET_MAX_CONCURRENCY_MAX = 16
export const AGENT_PRESET_RUNTIME_TEMPERATURE_MIN = 0
export const AGENT_PRESET_RUNTIME_TEMPERATURE_MAX = 200
export const AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MIN = 0
export const AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MAX = 500_000
export const AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MIN = 1
export const AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MAX = 120_000
export const AGENT_PRESET_RUNTIME_TIMEOUT_MS_MIN = 250
export const AGENT_PRESET_RUNTIME_TIMEOUT_MS_MAX = 300_000

const OUTPUT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

export type AgentPresetStepPhase = (typeof AGENT_PRESET_STEP_PHASES)[number]
export type AgentPresetStepOutputFormat = (typeof AGENT_PRESET_STEP_OUTPUT_FORMATS)[number]
export type AgentPresetStepInputScope = (typeof AGENT_PRESET_STEP_INPUT_SCOPES)[number]
export type AgentPresetStepDestination = (typeof AGENT_PRESET_STEP_DESTINATIONS)[number]

export type AgentPresetStepModelSelection =
  | {
      mode: 'inheritMain'
    }
  | {
      mode: 'modelProfile'
      profileId: string
    }

export interface AgentPresetStepRuntimeOptions {
  temperature?: number
  maxInputChars?: number
  maxOutputChars?: number
  timeoutMs?: number
  structuredOutputStrict?: boolean
}

export type AgentPresetStepFailurePolicy =
  | {
      mode: 'optional'
    }
  | {
      mode: 'required'
    }
  | {
      mode: 'fallbackText'
      text: string
    }
  | {
      mode: 'stopGeneration'
    }

export interface AgentPresetStepRecord {
  id: string
  name: string
  enabled: boolean
  phase: AgentPresetStepPhase
  dependencies: string[]
  instruction: string
  model: AgentPresetStepModelSelection
  runtime: AgentPresetStepRuntimeOptions
  inputScopes: AgentPresetStepInputScope[]
  outputKey: string
  outputFormat: AgentPresetStepOutputFormat
  destination: AgentPresetStepDestination
  failurePolicy: AgentPresetStepFailurePolicy
}

export interface AgentPresetRecord {
  id: string
  name: string
  description?: string
  enabled: boolean
  version: number
  maxConcurrency?: number
  steps: AgentPresetStepRecord[]
  createdAt?: number
  updatedAt?: number
}

export type AgentPresetValidationIssueCode =
  | 'duplicate_id'
  | 'invalid_id'
  | 'invalid_name'
  | 'invalid_enabled'
  | 'invalid_version'
  | 'invalid_max_concurrency'
  | 'invalid_phase'
  | 'invalid_dependency'
  | 'cyclic_dependency'
  | 'invalid_instruction'
  | 'invalid_model'
  | 'invalid_runtime'
  | 'invalid_input_scope'
  | 'invalid_output_key'
  | 'duplicate_output_key'
  | 'invalid_output_format'
  | 'invalid_destination'
  | 'invalid_failure_policy'
  | 'invalid_after_main_modifier'
  | 'unavailable_agent_output'

export interface AgentPresetValidationIssue {
  code: AgentPresetValidationIssueCode
  path: string
  message: string
}

export function normalizeAgentPresets(value: unknown): AgentPresetRecord[] {
  if (!Array.isArray(value)) return []

  const presets: AgentPresetRecord[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = stringOrBlank(item.id)
    if (!id || seen.has(id)) continue
    const preset = normalizeAgentPresetRecord(item)
    if (!preset) continue
    presets.push(preset)
    seen.add(id)
  }
  return presets
}

export function normalizeAgentPresetDefaultId(
  value: unknown,
  agentPresets: readonly Pick<AgentPresetRecord, 'id'>[],
): string | undefined {
  const id = stringOrBlank(value)
  if (!id) return undefined
  return agentPresets.some((preset) => preset.id === id) ? id : undefined
}

export function validateAgentPresetRecords(value: readonly AgentPresetRecord[]): AgentPresetValidationIssue[] {
  const issues: AgentPresetValidationIssue[] = []
  const seen = new Set<string>()

  value.forEach((preset, index) => {
    const path = `agentPresets[${index}]`
    if (!isNonEmptyString(preset.id)) {
      issues.push(issue('invalid_id', `${path}.id`, 'Agent Preset id must be a non-empty string'))
    } else if (seen.has(preset.id)) {
      issues.push(issue('duplicate_id', `${path}.id`, `Duplicate Agent Preset id: ${preset.id}`))
    }
    seen.add(preset.id)
    issues.push(...validateAgentPresetRecord(preset, path))
  })

  return issues
}

export function validateAgentPresetRecord(
  preset: AgentPresetRecord,
  path = 'agentPreset',
): AgentPresetValidationIssue[] {
  const issues: AgentPresetValidationIssue[] = []

  if (!isNonEmptyString(preset.id)) {
    issues.push(issue('invalid_id', `${path}.id`, 'Agent Preset id must be a non-empty string'))
  }
  if (!isNonEmptyString(preset.name)) {
    issues.push(issue('invalid_name', `${path}.name`, 'Agent Preset name must be a non-empty string'))
  }
  if (typeof preset.enabled !== 'boolean') {
    issues.push(issue('invalid_enabled', `${path}.enabled`, 'Agent Preset enabled must be a boolean'))
  }
  if (!Number.isInteger(preset.version) || preset.version < 1) {
    issues.push(issue('invalid_version', `${path}.version`, 'Agent Preset version must be a positive integer'))
  }
  if (
    preset.maxConcurrency !== undefined &&
    !isIntegerInRange(preset.maxConcurrency, AGENT_PRESET_MAX_CONCURRENCY_MIN, AGENT_PRESET_MAX_CONCURRENCY_MAX)
  ) {
    issues.push(
      issue(
        'invalid_max_concurrency',
        `${path}.maxConcurrency`,
        `Agent Preset maxConcurrency must be between ${AGENT_PRESET_MAX_CONCURRENCY_MIN} and ${AGENT_PRESET_MAX_CONCURRENCY_MAX}`,
      ),
    )
  }
  if (!Array.isArray(preset.steps)) {
    issues.push(issue('invalid_id', `${path}.steps`, 'Agent Preset steps must be an array'))
    return issues
  }

  const enabledSteps = preset.steps.filter((step) => step.enabled)
  const enabledById = new Map<string, AgentPresetStepRecord>()
  const enabledStepIndexes = new Map<string, number>()
  preset.steps.forEach((step, index) => {
    if (!step.enabled) return
    if (!isNonEmptyString(step.id)) return
    if (!enabledById.has(step.id)) {
      enabledById.set(step.id, step)
      enabledStepIndexes.set(step.id, index)
    }
  })

  const seenStepIds = new Set<string>()
  const outputKeysByPhase = new Map<string, string>()
  preset.steps.forEach((step, index) => {
    const stepPath = `${path}.steps[${index}]`
    issues.push(...validateAgentPresetStepRecord(step, stepPath))

    if (step.enabled && isNonEmptyString(step.id)) {
      if (seenStepIds.has(step.id)) {
        issues.push(issue('duplicate_id', `${stepPath}.id`, `Duplicate enabled Agent Preset step id: ${step.id}`))
      }
      seenStepIds.add(step.id)
    }

    if (step.enabled && isValidAgentPresetOutputKey(step.outputKey) && isAgentPresetStepPhase(step.phase)) {
      const key = `${step.phase}:${step.outputKey}`
      const previousPath = outputKeysByPhase.get(key)
      if (previousPath) {
        issues.push(
          issue(
            'duplicate_output_key',
            `${stepPath}.outputKey`,
            `Duplicate enabled Agent Preset output key for ${step.phase}: ${step.outputKey}`,
          ),
        )
      } else {
        outputKeysByPhase.set(key, `${stepPath}.outputKey`)
      }
    }

    if (!step.enabled) return
    for (const dependencyId of step.dependencies) {
      const dependency = enabledById.get(dependencyId)
      if (!dependency) {
        issues.push(
          issue(
            'invalid_dependency',
            `${stepPath}.dependencies`,
            `Agent Preset step dependency must reference an enabled step in the same preset: ${dependencyId}`,
          ),
        )
        continue
      }
      if (step.phase === 'beforeMain' && dependency.phase === 'afterMain') {
        issues.push(
          issue(
            'invalid_dependency',
            `${stepPath}.dependencies`,
            'Before-main Agent Preset steps cannot depend on after-main steps',
          ),
        )
      }
      const dependencyIndex = enabledStepIndexes.get(dependencyId)
      if (dependencyIndex === index) {
        issues.push(issue('cyclic_dependency', `${stepPath}.dependencies`, 'Agent Preset step cannot depend on itself'))
      }
    }
  })

  issues.push(...validateAgentPresetDependencyGraph(enabledSteps, path))
  issues.push(...validateAfterMainFinalOutputModifier(enabledSteps, path))

  return issues
}

export function validateAgentPresetStepRecord(
  step: AgentPresetStepRecord,
  path = 'agentPresetStep',
): AgentPresetValidationIssue[] {
  const issues: AgentPresetValidationIssue[] = []

  if (!isNonEmptyString(step.id)) {
    issues.push(issue('invalid_id', `${path}.id`, 'Agent Preset step id must be a non-empty string'))
  }
  if (!isNonEmptyString(step.name)) {
    issues.push(issue('invalid_name', `${path}.name`, 'Agent Preset step name must be a non-empty string'))
  }
  if (typeof step.enabled !== 'boolean') {
    issues.push(issue('invalid_enabled', `${path}.enabled`, 'Agent Preset step enabled must be a boolean'))
  }
  if (!isAgentPresetStepPhase(step.phase)) {
    issues.push(issue('invalid_phase', `${path}.phase`, 'Agent Preset step phase must be beforeMain or afterMain'))
  }
  if (!Array.isArray(step.dependencies) || step.dependencies.some((id) => !isNonEmptyString(id))) {
    issues.push(
      issue('invalid_dependency', `${path}.dependencies`, 'Agent Preset step dependencies must be step id strings'),
    )
  }
  if (typeof step.instruction !== 'string') {
    issues.push(issue('invalid_instruction', `${path}.instruction`, 'Agent Preset step instruction must be a string'))
  }
  if (!isValidAgentPresetStepModelSelection(step.model)) {
    issues.push(issue('invalid_model', `${path}.model`, 'Agent Preset step model selection is invalid'))
  }
  issues.push(...validateAgentPresetStepRuntime(step.runtime, `${path}.runtime`))
  if (!Array.isArray(step.inputScopes) || step.inputScopes.some((scope) => !isAgentPresetStepInputScope(scope))) {
    issues.push(
      issue('invalid_input_scope', `${path}.inputScopes`, 'Agent Preset step input scopes include an unknown value'),
    )
  }
  if (!isValidAgentPresetOutputKey(step.outputKey)) {
    issues.push(
      issue(
        'invalid_output_key',
        `${path}.outputKey`,
        'Agent Preset step outputKey must be an identifier up to 64 characters',
      ),
    )
  }
  if (!isAgentPresetStepOutputFormat(step.outputFormat)) {
    issues.push(
      issue(
        'invalid_output_format',
        `${path}.outputFormat`,
        'Agent Preset step outputFormat must be text or jsonObject',
      ),
    )
  }
  if (!isAgentPresetStepDestination(step.destination)) {
    issues.push(
      issue(
        'invalid_destination',
        `${path}.destination`,
        'Agent Preset step destination must be promptOutput, intermediate, or finalOutput',
      ),
    )
  }
  if (step.destination === 'finalOutput' && step.phase !== 'afterMain') {
    issues.push(
      issue('invalid_destination', `${path}.destination`, 'Only after-main Agent Preset steps can modify final output'),
    )
  }
  if (!isValidAgentPresetStepFailurePolicy(step.failurePolicy)) {
    issues.push(issue('invalid_failure_policy', `${path}.failurePolicy`, 'Agent Preset step failure policy is invalid'))
  }

  return issues
}

export function isValidAgentPresetOutputKey(value: unknown): value is string {
  return typeof value === 'string' && OUTPUT_KEY_PATTERN.test(value)
}

export function isAgentPresetDirectOutputModifierStep(step: Pick<AgentPresetStepRecord, 'destination'>): boolean {
  return step.destination === 'finalOutput'
}

function normalizeAgentPresetRecord(item: Record<string, unknown>): AgentPresetRecord | null {
  const id = stringOrBlank(item.id)
  if (!id) return null
  const record: AgentPresetRecord = {
    id,
    name: stringOrBlank(item.name) || id,
    enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    version: positiveIntegerOr(item.version, AGENT_PRESET_SCHEMA_VERSION),
    steps: normalizeAgentPresetSteps(item.steps),
  }
  const description = stringOrBlank(item.description)
  if (description) record.description = description
  const maxConcurrency = boundedIntegerOrUndefined(
    item.maxConcurrency,
    AGENT_PRESET_MAX_CONCURRENCY_MIN,
    AGENT_PRESET_MAX_CONCURRENCY_MAX,
  )
  if (maxConcurrency !== undefined) record.maxConcurrency = maxConcurrency
  const createdAt = nonNegativeFiniteNumberOrUndefined(item.createdAt)
  if (createdAt !== undefined) record.createdAt = createdAt
  const updatedAt = nonNegativeFiniteNumberOrUndefined(item.updatedAt)
  if (updatedAt !== undefined) record.updatedAt = updatedAt
  return record
}

function normalizeAgentPresetSteps(value: unknown): AgentPresetStepRecord[] {
  if (!Array.isArray(value)) return []

  const steps: AgentPresetStepRecord[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = stringOrBlank(item.id)
    if (!id || seen.has(id)) continue
    const phase = normalizeStepPhase(item.phase)
    steps.push({
      id,
      name: stringOrBlank(item.name) || id,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
      phase,
      dependencies: normalizeStringList(item.dependencies),
      instruction: typeof item.instruction === 'string' ? item.instruction : '',
      model: normalizeStepModelSelection(item.model),
      runtime: normalizeStepRuntimeOptions(item.runtime),
      inputScopes: normalizeInputScopes(item.inputScopes),
      outputKey: stringOrBlank(item.outputKey) || id,
      outputFormat: normalizeOutputFormat(item.outputFormat),
      destination: normalizeDestination(item.destination, phase),
      failurePolicy: normalizeFailurePolicy(item.failurePolicy),
    })
    seen.add(id)
  }
  return steps
}

function normalizeStepPhase(value: unknown): AgentPresetStepPhase {
  return value === 'afterMain' ? 'afterMain' : 'beforeMain'
}

function normalizeOutputFormat(value: unknown): AgentPresetStepOutputFormat {
  return value === 'jsonObject' ? 'jsonObject' : 'text'
}

function normalizeDestination(value: unknown, phase: AgentPresetStepPhase): AgentPresetStepDestination {
  if (value === 'promptOutput' || value === 'intermediate' || value === 'finalOutput') return value
  return phase === 'beforeMain' ? 'promptOutput' : 'intermediate'
}

function normalizeInputScopes(value: unknown): AgentPresetStepInputScope[] {
  if (!Array.isArray(value)) return []
  const scopes: AgentPresetStepInputScope[] = []
  const seen = new Set<string>()
  for (const scope of value) {
    if (!isAgentPresetStepInputScope(scope) || seen.has(scope)) continue
    scopes.push(scope)
    seen.add(scope)
  }
  return scopes
}

function normalizeStepModelSelection(value: unknown): AgentPresetStepModelSelection {
  if (isRecord(value) && value.mode === 'modelProfile') {
    const profileId = stringOrBlank(value.profileId)
    if (profileId) return { mode: 'modelProfile', profileId }
  }
  return { mode: 'inheritMain' }
}

function normalizeStepRuntimeOptions(value: unknown): AgentPresetStepRuntimeOptions {
  const source = isRecord(value) ? value : {}
  const runtime: AgentPresetStepRuntimeOptions = {}
  const temperature = finiteNumberOrUndefined(source.temperature)
  if (temperature !== undefined) runtime.temperature = temperature
  const maxInputChars = integerOrUndefined(source.maxInputChars)
  if (maxInputChars !== undefined) runtime.maxInputChars = maxInputChars
  const maxOutputChars = integerOrUndefined(source.maxOutputChars)
  if (maxOutputChars !== undefined) runtime.maxOutputChars = maxOutputChars
  const timeoutMs = integerOrUndefined(source.timeoutMs)
  if (timeoutMs !== undefined) runtime.timeoutMs = timeoutMs
  if (typeof source.structuredOutputStrict === 'boolean') {
    runtime.structuredOutputStrict = source.structuredOutputStrict
  }
  return runtime
}

function normalizeFailurePolicy(value: unknown): AgentPresetStepFailurePolicy {
  if (typeof value === 'string') {
    if (value === 'optional') return { mode: 'optional' }
    if (value === 'fallbackText') return { mode: 'fallbackText', text: '' }
    if (value === 'stopGeneration') return { mode: 'stopGeneration' }
  }
  if (isRecord(value)) {
    if (value.mode === 'optional') return { mode: 'optional' }
    if (value.mode === 'fallbackText') {
      return { mode: 'fallbackText', text: typeof value.text === 'string' ? value.text : '' }
    }
    if (value.mode === 'stopGeneration') return { mode: 'stopGeneration' }
  }
  return { mode: 'required' }
}

function validateAgentPresetStepRuntime(
  runtime: AgentPresetStepRuntimeOptions,
  path: string,
): AgentPresetValidationIssue[] {
  const issues: AgentPresetValidationIssue[] = []
  if (!isRecord(runtime)) {
    return [issue('invalid_runtime', path, 'Agent Preset step runtime must be an object')]
  }
  if (
    runtime.temperature !== undefined &&
    !isNumberInRange(runtime.temperature, AGENT_PRESET_RUNTIME_TEMPERATURE_MIN, AGENT_PRESET_RUNTIME_TEMPERATURE_MAX)
  ) {
    issues.push(
      issue(
        'invalid_runtime',
        `${path}.temperature`,
        `Agent Preset step temperature must be between ${AGENT_PRESET_RUNTIME_TEMPERATURE_MIN} and ${AGENT_PRESET_RUNTIME_TEMPERATURE_MAX}`,
      ),
    )
  }
  if (
    runtime.maxInputChars !== undefined &&
    !isIntegerInRange(
      runtime.maxInputChars,
      AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MIN,
      AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MAX,
    )
  ) {
    issues.push(
      issue(
        'invalid_runtime',
        `${path}.maxInputChars`,
        `Agent Preset step maxInputChars must be between ${AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MIN} and ${AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MAX}`,
      ),
    )
  }
  if (
    runtime.maxOutputChars !== undefined &&
    !isIntegerInRange(
      runtime.maxOutputChars,
      AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MIN,
      AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MAX,
    )
  ) {
    issues.push(
      issue(
        'invalid_runtime',
        `${path}.maxOutputChars`,
        `Agent Preset step maxOutputChars must be between ${AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MIN} and ${AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MAX}`,
      ),
    )
  }
  if (
    runtime.timeoutMs !== undefined &&
    !isIntegerInRange(runtime.timeoutMs, AGENT_PRESET_RUNTIME_TIMEOUT_MS_MIN, AGENT_PRESET_RUNTIME_TIMEOUT_MS_MAX)
  ) {
    issues.push(
      issue(
        'invalid_runtime',
        `${path}.timeoutMs`,
        `Agent Preset step timeoutMs must be between ${AGENT_PRESET_RUNTIME_TIMEOUT_MS_MIN} and ${AGENT_PRESET_RUNTIME_TIMEOUT_MS_MAX}`,
      ),
    )
  }
  if (runtime.structuredOutputStrict !== undefined && typeof runtime.structuredOutputStrict !== 'boolean') {
    issues.push(
      issue(
        'invalid_runtime',
        `${path}.structuredOutputStrict`,
        'Agent Preset step structuredOutputStrict must be a boolean',
      ),
    )
  }
  return issues
}

function validateAgentPresetDependencyGraph(
  enabledSteps: readonly AgentPresetStepRecord[],
  path: string,
): AgentPresetValidationIssue[] {
  const issues: AgentPresetValidationIssue[] = []
  const stepsById = new Map(enabledSteps.map((step) => [step.id, step]))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (step: AgentPresetStepRecord, trail: string[]): void => {
    if (visited.has(step.id)) return
    if (visiting.has(step.id)) {
      issues.push(
        issue(
          'cyclic_dependency',
          `${path}.steps`,
          `Agent Preset step dependencies contain a cycle: ${[...trail, step.id].join(' -> ')}`,
        ),
      )
      return
    }
    visiting.add(step.id)
    for (const dependencyId of step.dependencies) {
      const dependency = stepsById.get(dependencyId)
      if (dependency) visit(dependency, [...trail, step.id])
    }
    visiting.delete(step.id)
    visited.add(step.id)
  }

  for (const step of enabledSteps) {
    visit(step, [])
  }
  return issues
}

function validateAfterMainFinalOutputModifier(
  enabledSteps: readonly AgentPresetStepRecord[],
  path: string,
): AgentPresetValidationIssue[] {
  const issues: AgentPresetValidationIssue[] = []
  const afterMainSteps = enabledSteps.filter((step) => step.phase === 'afterMain')
  const modifiers = afterMainSteps.filter(isAgentPresetDirectOutputModifierStep)
  if (modifiers.length > 1) {
    issues.push(
      issue(
        'invalid_after_main_modifier',
        `${path}.steps`,
        'Only one enabled after-main Agent Preset step can directly modify final output',
      ),
    )
  }
  if (modifiers.length === 1 && afterMainSteps[afterMainSteps.length - 1] !== modifiers[0]) {
    issues.push(
      issue(
        'invalid_after_main_modifier',
        `${path}.steps`,
        'The enabled after-main final-output modifier must be the last enabled after-main step',
      ),
    )
  }
  return issues
}

function isAgentPresetStepPhase(value: unknown): value is AgentPresetStepPhase {
  return value === 'beforeMain' || value === 'afterMain'
}

function isAgentPresetStepOutputFormat(value: unknown): value is AgentPresetStepOutputFormat {
  return value === 'text' || value === 'jsonObject'
}

function isAgentPresetStepInputScope(value: unknown): value is AgentPresetStepInputScope {
  return (
    value === 'recentChatTail' ||
    value === 'chatSearchSnippets' ||
    value === 'lorebookContext' ||
    value === 'memoryContext' ||
    value === 'characterSummary' ||
    value === 'personaSummary' ||
    value === 'currentUserMessage' ||
    value === 'previousAgentOutputs' ||
    value === 'mainDraft'
  )
}

function isAgentPresetStepDestination(value: unknown): value is AgentPresetStepDestination {
  return value === 'promptOutput' || value === 'intermediate' || value === 'finalOutput'
}

function isValidAgentPresetStepModelSelection(value: unknown): value is AgentPresetStepModelSelection {
  if (!isRecord(value)) return false
  if (value.mode === 'inheritMain') return true
  return value.mode === 'modelProfile' && isNonEmptyString(value.profileId)
}

function isValidAgentPresetStepFailurePolicy(value: unknown): value is AgentPresetStepFailurePolicy {
  if (!isRecord(value)) return false
  if (value.mode === 'optional' || value.mode === 'required' || value.mode === 'stopGeneration') return true
  return value.mode === 'fallbackText' && typeof value.text === 'string'
}

function issue(code: AgentPresetValidationIssueCode, path: string, message: string): AgentPresetValidationIssue {
  return { code, path, message }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const strings: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const normalized = stringOrBlank(item)
    if (!normalized || seen.has(normalized)) continue
    strings.push(normalized)
    seen.add(normalized)
  }
  return strings
}

function stringOrBlank(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function positiveIntegerOr(value: unknown, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : fallback
}

function boundedIntegerOrUndefined(value: unknown, min: number, max: number): number | undefined {
  return isIntegerInRange(value, min, max) ? (value as number) : undefined
}

function integerOrUndefined(value: unknown): number | undefined {
  return Number.isInteger(value) ? (value as number) : undefined
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonNegativeFiniteNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
}

function isNumberInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}
