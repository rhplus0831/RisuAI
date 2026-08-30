import { parseChatMLRows } from '@risuai/shared-core/chatml-rows'

export const AGENT_PRESET_SCHEMA_VERSION = 1
export const AGENT_SCHEMA_VERSION = 1

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
export const AGENT_PRESET_STEP_DESTINATIONS = ['promptOutput', 'intermediate', 'userInput', 'finalOutput'] as const
export const AGENT_TOGGLE_KINDS = ['boolean', 'select', 'text', 'textarea'] as const

export const AGENT_TOGGLE_STORAGE_PREFIX = 'agent:'
export const AGENT_TOGGLE_DEFINITION_LIMIT = 32
export const AGENT_LOREBOOK_INPUT_LIMIT = 16

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
const AGENT_LOCAL_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const AGENT_TOGGLE_REFERENCE_PATTERN = /\{\{\s*agentToggle::([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
const AGENT_INPUT_REFERENCE_PATTERN = /\{\{\s*agentInput::([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

export type AgentPresetStepPhase = (typeof AGENT_PRESET_STEP_PHASES)[number]
export type AgentPresetStepOutputFormat = (typeof AGENT_PRESET_STEP_OUTPUT_FORMATS)[number]
export type AgentPresetStepInputScope = (typeof AGENT_PRESET_STEP_INPUT_SCOPES)[number]
export type AgentPresetStepDestination = (typeof AGENT_PRESET_STEP_DESTINATIONS)[number]
export type AgentToggleKind = (typeof AGENT_TOGGLE_KINDS)[number]

export interface AgentToggleDefinition {
  key: string
  label: string
  kind: AgentToggleKind
  options: string[]
}

export interface AgentLorebookInput {
  key: string
  displayName: string
  required: boolean
}

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
  /** The reusable Agent that supplied this resolved execution definition. */
  agentId?: string
  name: string
  enabled: boolean
  phase: AgentPresetStepPhase
  dependencies: string[]
  instruction: string
  /** Parse the instruction as role-tagged ChatML instead of using the helper-step prefill. */
  useChatML?: boolean
  model: AgentPresetStepModelSelection
  runtime: AgentPresetStepRuntimeOptions
  inputScopes: AgentPresetStepInputScope[]
  /** Agent-local configurable controls, resolved through a stable Agent-id namespace. */
  toggles?: AgentToggleDefinition[]
  /** Named Agent-only lorebook inputs made available through {{agentInput::key}}. */
  lorebookInputs?: AgentLorebookInput[]
  outputKey: string
  outputFormat: AgentPresetStepOutputFormat
  destination: AgentPresetStepDestination
  failurePolicy: AgentPresetStepFailurePolicy
}

/** Reusable behavior shared by any number of Agent Presets. */
export interface AgentRecord {
  id: string
  name: string
  description?: string
  version: number
  instruction: string
  /** Parse the instruction as role-tagged ChatML instead of using the helper-step prefill. */
  useChatML?: boolean
  modelDefaults: AgentPresetStepModelSelection
  runtimeDefaults: AgentPresetStepRuntimeOptions
  inputScopes: AgentPresetStepInputScope[]
  toggles?: AgentToggleDefinition[]
  lorebookInputs?: AgentLorebookInput[]
  outputFormat: AgentPresetStepOutputFormat
  createdAt?: number
  updatedAt?: number
}

/** One invocation of a reusable Agent inside an Agent Preset. */
export interface AgentPresetUseRecord {
  id: string
  agentId: string
  enabled: boolean
  phase: AgentPresetStepPhase
  dependencies: string[]
  outputKey: string
  destination: AgentPresetStepDestination
  failurePolicy: AgentPresetStepFailurePolicy
  modelOverride?: AgentPresetStepModelSelection
  runtimeOverride?: AgentPresetStepRuntimeOptions
}

export interface AgentPresetRecord {
  id: string
  name: string
  description?: string
  /** Comma-separated module ids or namespaces activated while this preset is effective. */
  moduleIntergration?: string
  /** CBS evaluated after the main response and all Agent uses complete. */
  finalOutputTemplate?: string
  enabled: boolean
  version: number
  maxConcurrency?: number
  /** Canonical modular composition. */
  agentUses?: AgentPresetUseRecord[]
  /**
   * Legacy import-only shape. Canonical database normalization migrates these
   * records into standalone Agents and leaves this array empty.
   */
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
  | 'invalid_module_integration'
  | 'invalid_phase'
  | 'invalid_dependency'
  | 'cyclic_dependency'
  | 'invalid_instruction'
  | 'invalid_model'
  | 'invalid_runtime'
  | 'invalid_input_scope'
  | 'invalid_toggle'
  | 'invalid_lorebook_input'
  | 'invalid_output_key'
  | 'duplicate_output_key'
  | 'invalid_output_format'
  | 'invalid_destination'
  | 'invalid_failure_policy'
  | 'invalid_before_main_modifier'
  | 'invalid_after_main_modifier'
  | 'unavailable_agent_output'
  | 'missing_agent'

export interface AgentPresetValidationIssue {
  code: AgentPresetValidationIssueCode
  path: string
  message: string
}

export interface NormalizedAgentConfiguration {
  agents: AgentRecord[]
  agentPresets: AgentPresetRecord[]
}

export function normalizeAgents(value: unknown): AgentRecord[] {
  if (!Array.isArray(value)) return []

  const agents: AgentRecord[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = stringOrBlank(item.id)
    if (!id || seen.has(id)) continue
    agents.push(normalizeAgentRecord(item, id))
    seen.add(id)
  }
  return agents
}

/**
 * Normalizes the modular Agent library and migrates legacy preset-owned steps.
 * Legacy steps intentionally become distinct Agents; content similarity is not
 * sufficient evidence that two historical steps were meant to be shared.
 */
export function normalizeAgentConfiguration(agentsValue: unknown, presetsValue: unknown): NormalizedAgentConfiguration {
  const agents = normalizeAgents(agentsValue)
  const usedAgentIds = new Set(agents.map((agent) => agent.id))
  const presets = normalizeAgentPresets(presetsValue)

  for (const preset of presets) {
    if (preset.agentUses) {
      preset.steps = []
      continue
    }

    const uses: AgentPresetUseRecord[] = []
    for (const step of preset.steps) {
      const agentId = uniqueMigratedAgentId(step.id, preset.id, usedAgentIds)
      agents.push(agentRecordFromLegacyStep(step, agentId))
      uses.push(agentPresetUseFromLegacyStep(step, agentId))
    }
    preset.agentUses = uses
    preset.steps = []
  }

  return { agents, agentPresets: presets }
}

export function resolveAgentPresetSteps(
  preset: AgentPresetRecord,
  agents: readonly AgentRecord[],
): AgentPresetStepRecord[] {
  if (!preset.agentUses) return preset.steps.map((step) => cloneStepRecord(step))

  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const steps: AgentPresetStepRecord[] = []
  for (const use of preset.agentUses) {
    const agent = agentsById.get(use.agentId)
    if (!agent) continue
    steps.push({
      id: use.id,
      agentId: agent.id,
      name: agent.name,
      enabled: use.enabled,
      phase: use.phase,
      dependencies: [...use.dependencies],
      instruction: agent.instruction,
      ...(agent.useChatML === true ? { useChatML: true } : {}),
      model: cloneModelSelection(use.modelOverride ?? agent.modelDefaults),
      runtime: { ...agent.runtimeDefaults, ...use.runtimeOverride },
      inputScopes: [...agent.inputScopes],
      toggles: (agent.toggles ?? []).map(cloneAgentToggleDefinition),
      lorebookInputs: (agent.lorebookInputs ?? []).map(cloneAgentLorebookInput),
      outputKey: use.outputKey,
      outputFormat: agent.outputFormat,
      destination: use.destination,
      failurePolicy: cloneFailurePolicy(use.failurePolicy),
    })
  }
  return steps
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

export function validateAgentRecords(value: readonly AgentRecord[]): AgentPresetValidationIssue[] {
  const issues: AgentPresetValidationIssue[] = []
  const seen = new Set<string>()
  value.forEach((agent, index) => {
    const path = `agents[${index}]`
    if (!isNonEmptyString(agent.id)) {
      issues.push(issue('invalid_id', `${path}.id`, 'Agent id must be a non-empty string'))
    } else if (seen.has(agent.id)) {
      issues.push(issue('duplicate_id', `${path}.id`, `Duplicate Agent id: ${agent.id}`))
    }
    seen.add(agent.id)
    issues.push(...validateAgentRecord(agent, path))
  })
  return issues
}

export function validateAgentRecord(agent: AgentRecord, path = 'agent'): AgentPresetValidationIssue[] {
  const issues: AgentPresetValidationIssue[] = []
  if (!isNonEmptyString(agent.id)) issues.push(issue('invalid_id', `${path}.id`, 'Agent id must be a non-empty string'))
  if (!isNonEmptyString(agent.name)) {
    issues.push(issue('invalid_name', `${path}.name`, 'Agent name must be a non-empty string'))
  }
  if (!Number.isInteger(agent.version) || agent.version < 1) {
    issues.push(issue('invalid_version', `${path}.version`, 'Agent version must be a positive integer'))
  }
  if (typeof agent.instruction !== 'string') {
    issues.push(issue('invalid_instruction', `${path}.instruction`, 'Agent instruction must be a string'))
  }
  if (agent.useChatML !== undefined && typeof agent.useChatML !== 'boolean') {
    issues.push(issue('invalid_instruction', `${path}.useChatML`, 'Agent useChatML must be a boolean'))
  } else if (agent.useChatML && typeof agent.instruction === 'string' && parseChatMLRows(agent.instruction) === null) {
    issues.push(
      issue('invalid_instruction', `${path}.instruction`, 'A ChatML Agent instruction must start with <|im_start|>'),
    )
  }
  if (!isValidAgentPresetStepModelSelection(agent.modelDefaults)) {
    issues.push(issue('invalid_model', `${path}.modelDefaults`, 'Agent default model selection is invalid'))
  }
  issues.push(...validateAgentPresetStepRuntime(agent.runtimeDefaults, `${path}.runtimeDefaults`))
  if (!Array.isArray(agent.inputScopes) || agent.inputScopes.some((scope) => !isAgentPresetStepInputScope(scope))) {
    issues.push(issue('invalid_input_scope', `${path}.inputScopes`, 'Agent input scopes include an unknown value'))
  }
  issues.push(...validateAgentToggleDefinitions(agent.toggles ?? [], agent.instruction, `${path}.toggles`))
  issues.push(...validateAgentLorebookInputs(agent.lorebookInputs ?? [], agent.instruction, `${path}.lorebookInputs`))
  if (!isAgentPresetStepOutputFormat(agent.outputFormat)) {
    issues.push(
      issue('invalid_output_format', `${path}.outputFormat`, 'Agent output format must be text or jsonObject'),
    )
  }
  return issues
}

export function validateAgentPresetRecords(
  value: readonly AgentPresetRecord[],
  agents: readonly AgentRecord[] = [],
): AgentPresetValidationIssue[] {
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
    issues.push(...validateAgentPresetRecord(preset, path, agents))
  })

  return issues
}

export function validateAgentPresetRecord(
  preset: AgentPresetRecord,
  path = 'agentPreset',
  agents: readonly AgentRecord[] = [],
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
  if (preset.moduleIntergration !== undefined && typeof preset.moduleIntergration !== 'string') {
    issues.push(
      issue(
        'invalid_module_integration',
        `${path}.moduleIntergration`,
        'Agent Preset module integration must be a string',
      ),
    )
  }
  if (!Array.isArray(preset.steps) || (preset.agentUses !== undefined && !Array.isArray(preset.agentUses))) {
    issues.push(issue('invalid_id', `${path}.agentUses`, 'Agent Preset uses must be an array'))
    return issues
  }

  if (preset.agentUses) {
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
    const seenUseIds = new Set<string>()
    preset.agentUses.forEach((use, index) => {
      const usePath = `${path}.agentUses[${index}]`
      issues.push(...validateAgentPresetUseRecord(use, usePath))
      if (seenUseIds.has(use.id)) {
        issues.push(issue('duplicate_id', `${usePath}.id`, `Duplicate Agent Preset use id: ${use.id}`))
      }
      seenUseIds.add(use.id)
      if (!agentsById.has(use.agentId)) {
        issues.push(
          issue('missing_agent', `${usePath}.agentId`, `Agent Preset references a missing Agent: ${use.agentId}`),
        )
      }
    })
  }

  const resolvedSteps = resolveAgentPresetSteps(preset, agents)

  const enabledSteps = resolvedSteps.filter((step) => step.enabled)
  const enabledById = new Map<string, AgentPresetStepRecord>()
  const enabledStepIndexes = new Map<string, number>()
  resolvedSteps.forEach((step, index) => {
    if (!step.enabled) return
    if (!isNonEmptyString(step.id)) return
    if (!enabledById.has(step.id)) {
      enabledById.set(step.id, step)
      enabledStepIndexes.set(step.id, index)
    }
  })

  const seenStepIds = new Set<string>()
  const outputKeyPaths = new Map<string, string>()
  resolvedSteps.forEach((step, index) => {
    const stepPath = `${path}.steps[${index}]`
    issues.push(...validateAgentPresetStepRecord(step, stepPath))

    if (step.enabled && isNonEmptyString(step.id)) {
      if (seenStepIds.has(step.id)) {
        issues.push(issue('duplicate_id', `${stepPath}.id`, `Duplicate enabled Agent Preset step id: ${step.id}`))
      }
      seenStepIds.add(step.id)
    }

    if (step.enabled && isValidAgentPresetOutputKey(step.outputKey) && isAgentPresetStepPhase(step.phase)) {
      const previousPath = outputKeyPaths.get(step.outputKey)
      if (previousPath) {
        issues.push(
          issue(
            'duplicate_output_key',
            `${stepPath}.outputKey`,
            `Duplicate enabled Agent Preset output key: ${step.outputKey}`,
          ),
        )
      } else {
        outputKeyPaths.set(step.outputKey, `${stepPath}.outputKey`)
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
  issues.push(...validateBeforeMainUserInputModifier(enabledSteps, path))
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
  if (step.useChatML !== undefined && typeof step.useChatML !== 'boolean') {
    issues.push(issue('invalid_instruction', `${path}.useChatML`, 'Agent Preset step useChatML must be a boolean'))
  } else if (step.useChatML && typeof step.instruction === 'string' && parseChatMLRows(step.instruction) === null) {
    issues.push(
      issue('invalid_instruction', `${path}.instruction`, 'A ChatML Agent instruction must start with <|im_start|>'),
    )
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
  issues.push(...validateAgentToggleDefinitions(step.toggles ?? [], step.instruction, `${path}.toggles`))
  issues.push(...validateAgentLorebookInputs(step.lorebookInputs ?? [], step.instruction, `${path}.lorebookInputs`))
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
        'Agent Preset step destination must be promptOutput, intermediate, userInput, or finalOutput',
      ),
    )
  }
  if (step.destination === 'userInput' && step.phase !== 'beforeMain') {
    issues.push(
      issue('invalid_destination', `${path}.destination`, 'Only before-main Agent Preset steps can modify user input'),
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

export function validateAgentPresetUseRecord(
  use: AgentPresetUseRecord,
  path = 'agentPresetUse',
): AgentPresetValidationIssue[] {
  const issues: AgentPresetValidationIssue[] = []
  if (!isNonEmptyString(use.id))
    issues.push(issue('invalid_id', `${path}.id`, 'Agent use id must be a non-empty string'))
  if (!isNonEmptyString(use.agentId)) {
    issues.push(issue('invalid_id', `${path}.agentId`, 'Agent use must reference a non-empty Agent id'))
  }
  if (typeof use.enabled !== 'boolean') {
    issues.push(issue('invalid_enabled', `${path}.enabled`, 'Agent use enabled must be a boolean'))
  }
  if (!isAgentPresetStepPhase(use.phase)) {
    issues.push(issue('invalid_phase', `${path}.phase`, 'Agent use phase must be beforeMain or afterMain'))
  }
  if (!Array.isArray(use.dependencies) || use.dependencies.some((id) => !isNonEmptyString(id))) {
    issues.push(issue('invalid_dependency', `${path}.dependencies`, 'Agent use dependencies must be use id strings'))
  }
  if (!isValidAgentPresetOutputKey(use.outputKey)) {
    issues.push(issue('invalid_output_key', `${path}.outputKey`, 'Agent use output key must be an identifier'))
  }
  if (!isAgentPresetStepDestination(use.destination)) {
    issues.push(issue('invalid_destination', `${path}.destination`, 'Agent use destination is invalid'))
  }
  if (use.destination === 'userInput' && use.phase !== 'beforeMain') {
    issues.push(
      issue('invalid_destination', `${path}.destination`, 'Only before-main Agent uses can modify user input'),
    )
  }
  if (use.destination === 'finalOutput' && use.phase !== 'afterMain') {
    issues.push(
      issue('invalid_destination', `${path}.destination`, 'Only after-main Agent uses can modify final output'),
    )
  }
  if (!isValidAgentPresetStepFailurePolicy(use.failurePolicy)) {
    issues.push(issue('invalid_failure_policy', `${path}.failurePolicy`, 'Agent use failure policy is invalid'))
  }
  if (use.modelOverride !== undefined && !isValidAgentPresetStepModelSelection(use.modelOverride)) {
    issues.push(issue('invalid_model', `${path}.modelOverride`, 'Agent use model override is invalid'))
  }
  if (use.runtimeOverride !== undefined) {
    issues.push(...validateAgentPresetStepRuntime(use.runtimeOverride, `${path}.runtimeOverride`))
  }
  return issues
}

export function isValidAgentPresetOutputKey(value: unknown): value is string {
  return typeof value === 'string' && OUTPUT_KEY_PATTERN.test(value)
}

export function isValidAgentLocalKey(value: unknown): value is string {
  return typeof value === 'string' && AGENT_LOCAL_KEY_PATTERN.test(value)
}

export function agentToggleStorageKey(agentId: string, toggleKey: string): string {
  return `${AGENT_TOGGLE_STORAGE_PREFIX}${agentId}:${toggleKey}`
}

function validateAgentToggleDefinitions(
  toggles: readonly AgentToggleDefinition[],
  instruction: string,
  path: string,
): AgentPresetValidationIssue[] {
  if (!Array.isArray(toggles)) {
    return [issue('invalid_toggle', path, 'Agent toggles must be an array')]
  }
  const issues: AgentPresetValidationIssue[] = []
  const seen = new Set<string>()
  if (toggles.length > AGENT_TOGGLE_DEFINITION_LIMIT) {
    issues.push(
      issue('invalid_toggle', path, `Agents can define at most ${AGENT_TOGGLE_DEFINITION_LIMIT} configurable toggles`),
    )
  }
  toggles.forEach((toggle, index) => {
    const togglePath = `${path}[${index}]`
    if (!isRecord(toggle)) {
      issues.push(issue('invalid_toggle', togglePath, 'Agent toggle must be an object'))
      return
    }
    if (!isValidAgentLocalKey(toggle.key)) {
      issues.push(issue('invalid_toggle', `${togglePath}.key`, 'Agent toggle key must be an identifier'))
    } else if (seen.has(toggle.key)) {
      issues.push(issue('invalid_toggle', `${togglePath}.key`, `Duplicate Agent toggle key: ${toggle.key}`))
    }
    if (typeof toggle.key === 'string') seen.add(toggle.key)
    if (!isNonEmptyString(toggle.label)) {
      issues.push(issue('invalid_toggle', `${togglePath}.label`, 'Agent toggle label must be a non-empty string'))
    }
    if (!isAgentToggleKind(toggle.kind)) {
      issues.push(issue('invalid_toggle', `${togglePath}.kind`, 'Agent toggle kind is invalid'))
    }
    if (!Array.isArray(toggle.options) || toggle.options.some((option) => typeof option !== 'string')) {
      issues.push(issue('invalid_toggle', `${togglePath}.options`, 'Agent toggle options must be strings'))
    } else if (toggle.kind === 'select' && toggle.options.length === 0) {
      issues.push(issue('invalid_toggle', `${togglePath}.options`, 'Select Agent toggles require at least one option'))
    }
  })
  for (const key of referencedAgentLocalKeys(instruction, AGENT_TOGGLE_REFERENCE_PATTERN)) {
    if (!seen.has(key)) {
      issues.push(issue('invalid_toggle', path, `Agent instruction references an undefined toggle: ${key}`))
    }
  }
  return issues
}

function validateAgentLorebookInputs(
  inputs: readonly AgentLorebookInput[],
  instruction: string,
  path: string,
): AgentPresetValidationIssue[] {
  if (!Array.isArray(inputs)) {
    return [issue('invalid_lorebook_input', path, 'Agent lorebook inputs must be an array')]
  }
  const issues: AgentPresetValidationIssue[] = []
  const seen = new Set<string>()
  const referenced = referencedAgentLocalKeys(instruction, AGENT_INPUT_REFERENCE_PATTERN)
  if (inputs.length > AGENT_LOREBOOK_INPUT_LIMIT) {
    issues.push(
      issue('invalid_lorebook_input', path, `Agents can require at most ${AGENT_LOREBOOK_INPUT_LIMIT} lorebook inputs`),
    )
  }
  inputs.forEach((input, index) => {
    const inputPath = `${path}[${index}]`
    if (!isRecord(input)) {
      issues.push(issue('invalid_lorebook_input', inputPath, 'Agent lorebook input must be an object'))
      return
    }
    const inputKey = typeof input.key === 'string' ? input.key : ''
    if (!isValidAgentLocalKey(input.key)) {
      issues.push(issue('invalid_lorebook_input', `${inputPath}.key`, 'Agent lorebook input key must be an identifier'))
    } else if (seen.has(input.key)) {
      issues.push(
        issue('invalid_lorebook_input', `${inputPath}.key`, `Duplicate Agent lorebook input key: ${input.key}`),
      )
    }
    if (typeof input.key === 'string') seen.add(input.key)
    if (!isNonEmptyString(input.displayName)) {
      issues.push(
        issue('invalid_lorebook_input', `${inputPath}.displayName`, 'Lorebook display name must be non-empty'),
      )
    }
    if (typeof input.required !== 'boolean') {
      issues.push(issue('invalid_lorebook_input', `${inputPath}.required`, 'Lorebook input required must be boolean'))
    }
    if (input.required === true && !referenced.has(inputKey)) {
      issues.push(
        issue(
          'invalid_lorebook_input',
          inputPath,
          `Required lorebook input must be referenced as {{agentInput::${input.key}}}`,
        ),
      )
    }
  })
  for (const key of referenced) {
    if (!seen.has(key)) {
      issues.push(
        issue('invalid_lorebook_input', path, `Agent instruction references an undefined lorebook input: ${key}`),
      )
    }
  }
  return issues
}

function referencedAgentLocalKeys(instruction: string, pattern: RegExp): Set<string> {
  if (typeof instruction !== 'string') return new Set()
  return new Set([...instruction.matchAll(pattern)].map((match) => match[1]))
}

export function isAgentPresetDirectOutputModifierStep(step: Pick<AgentPresetStepRecord, 'destination'>): boolean {
  return step.destination === 'finalOutput'
}

export function isAgentPresetUserInputModifierStep(step: Pick<AgentPresetStepRecord, 'destination'>): boolean {
  return step.destination === 'userInput'
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
  if (Object.prototype.hasOwnProperty.call(item, 'agentUses')) {
    record.agentUses = normalizeAgentPresetUses(item.agentUses)
  }
  const description = stringOrBlank(item.description)
  if (description) record.description = description
  if (typeof item.moduleIntergration === 'string' && item.moduleIntergration.trim()) {
    record.moduleIntergration = item.moduleIntergration
  }
  if (typeof item.finalOutputTemplate === 'string' && item.finalOutputTemplate.trim()) {
    record.finalOutputTemplate = item.finalOutputTemplate
  }
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

function normalizeAgentRecord(item: Record<string, unknown>, id: string): AgentRecord {
  const record: AgentRecord = {
    id,
    name: stringOrBlank(item.name) || id,
    version: positiveIntegerOr(item.version, AGENT_SCHEMA_VERSION),
    instruction: typeof item.instruction === 'string' ? item.instruction : '',
    modelDefaults: normalizeStepModelSelection(item.modelDefaults ?? item.model),
    runtimeDefaults: normalizeStepRuntimeOptions(item.runtimeDefaults ?? item.runtime),
    inputScopes: normalizeInputScopes(item.inputScopes),
    outputFormat: normalizeOutputFormat(item.outputFormat),
  }
  if (typeof item.useChatML === 'boolean') record.useChatML = item.useChatML
  if (Array.isArray(item.toggles)) record.toggles = normalizeAgentToggleDefinitions(item.toggles)
  if (Array.isArray(item.lorebookInputs)) {
    record.lorebookInputs = normalizeAgentLorebookInputs(item.lorebookInputs)
  }
  const description = stringOrBlank(item.description)
  if (description) record.description = description
  const createdAt = nonNegativeFiniteNumberOrUndefined(item.createdAt)
  if (createdAt !== undefined) record.createdAt = createdAt
  const updatedAt = nonNegativeFiniteNumberOrUndefined(item.updatedAt)
  if (updatedAt !== undefined) record.updatedAt = updatedAt
  return record
}

function normalizeAgentPresetUses(value: unknown): AgentPresetUseRecord[] {
  if (!Array.isArray(value)) return []
  const uses: AgentPresetUseRecord[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = stringOrBlank(item.id)
    const agentId = stringOrBlank(item.agentId)
    if (!id || !agentId || seen.has(id)) continue
    const phase = normalizeStepPhase(item.phase)
    const use: AgentPresetUseRecord = {
      id,
      agentId,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
      phase,
      dependencies: normalizeStringList(item.dependencies),
      outputKey: stringOrBlank(item.outputKey) || id,
      destination: normalizeDestination(item.destination, phase),
      failurePolicy: normalizeFailurePolicy(item.failurePolicy),
    }
    if (item.modelOverride !== undefined) use.modelOverride = normalizeStepModelSelection(item.modelOverride)
    if (item.runtimeOverride !== undefined) use.runtimeOverride = normalizeStepRuntimeOptions(item.runtimeOverride)
    uses.push(use)
    seen.add(id)
  }
  return uses
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
    const step: AgentPresetStepRecord = {
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
    }
    if (typeof item.useChatML === 'boolean') step.useChatML = item.useChatML
    if (Array.isArray(item.toggles)) step.toggles = normalizeAgentToggleDefinitions(item.toggles)
    if (Array.isArray(item.lorebookInputs)) {
      step.lorebookInputs = normalizeAgentLorebookInputs(item.lorebookInputs)
    }
    steps.push(step)
    seen.add(id)
  }
  return steps
}

function agentRecordFromLegacyStep(step: AgentPresetStepRecord, agentId: string): AgentRecord {
  const agent: AgentRecord = {
    id: agentId,
    name: step.name,
    version: AGENT_SCHEMA_VERSION,
    instruction: step.instruction,
    modelDefaults: cloneModelSelection(step.model),
    runtimeDefaults: { ...step.runtime },
    inputScopes: [...step.inputScopes],
    outputFormat: step.outputFormat,
  }
  if (step.useChatML !== undefined) agent.useChatML = step.useChatML
  if (step.toggles) agent.toggles = step.toggles.map(cloneAgentToggleDefinition)
  if (step.lorebookInputs) agent.lorebookInputs = step.lorebookInputs.map(cloneAgentLorebookInput)
  return agent
}

function agentPresetUseFromLegacyStep(step: AgentPresetStepRecord, agentId: string): AgentPresetUseRecord {
  return {
    id: step.id,
    agentId,
    enabled: step.enabled,
    phase: step.phase,
    dependencies: [...step.dependencies],
    outputKey: step.outputKey,
    destination: step.destination,
    failurePolicy: cloneFailurePolicy(step.failurePolicy),
  }
}

function uniqueMigratedAgentId(stepId: string, presetId: string, usedIds: Set<string>): string {
  if (!usedIds.has(stepId)) {
    usedIds.add(stepId)
    return stepId
  }
  const base = `${stepId}_${presetId}`
  if (!usedIds.has(base)) {
    usedIds.add(base)
    return base
  }
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}_${index}`
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate)
      return candidate
    }
  }
  throw new Error('Unable to allocate migrated Agent id')
}

function cloneStepRecord(step: AgentPresetStepRecord): AgentPresetStepRecord {
  const clone: AgentPresetStepRecord = {
    ...step,
    dependencies: [...step.dependencies],
    model: cloneModelSelection(step.model),
    runtime: { ...step.runtime },
    inputScopes: [...step.inputScopes],
    failurePolicy: cloneFailurePolicy(step.failurePolicy),
  }
  if (step.toggles) clone.toggles = step.toggles.map(cloneAgentToggleDefinition)
  if (step.lorebookInputs) clone.lorebookInputs = step.lorebookInputs.map(cloneAgentLorebookInput)
  return clone
}

function cloneModelSelection(selection: AgentPresetStepModelSelection): AgentPresetStepModelSelection {
  return selection.mode === 'modelProfile'
    ? { mode: 'modelProfile', profileId: selection.profileId }
    : { mode: 'inheritMain' }
}

function cloneFailurePolicy(policy: AgentPresetStepFailurePolicy): AgentPresetStepFailurePolicy {
  return policy.mode === 'fallbackText' ? { mode: 'fallbackText', text: policy.text } : { mode: policy.mode }
}

function cloneAgentToggleDefinition(toggle: AgentToggleDefinition): AgentToggleDefinition {
  return { ...toggle, options: [...toggle.options] }
}

function cloneAgentLorebookInput(input: AgentLorebookInput): AgentLorebookInput {
  return { ...input }
}

function normalizeStepPhase(value: unknown): AgentPresetStepPhase {
  return value === 'afterMain' ? 'afterMain' : 'beforeMain'
}

function normalizeOutputFormat(value: unknown): AgentPresetStepOutputFormat {
  return value === 'jsonObject' ? 'jsonObject' : 'text'
}

function normalizeDestination(value: unknown, phase: AgentPresetStepPhase): AgentPresetStepDestination {
  if (value === 'promptOutput' || value === 'intermediate' || value === 'userInput' || value === 'finalOutput') {
    return value
  }
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

function normalizeAgentToggleDefinitions(value: unknown): AgentToggleDefinition[] {
  if (!Array.isArray(value)) return []
  const toggles: AgentToggleDefinition[] = []
  const seen = new Set<string>()
  for (const item of value.slice(0, AGENT_TOGGLE_DEFINITION_LIMIT)) {
    if (!isRecord(item)) continue
    const key = stringOrBlank(item.key)
    const label = stringOrBlank(item.label)
    if (!key || !label || seen.has(key)) continue
    const kind = isAgentToggleKind(item.kind) ? item.kind : 'boolean'
    const options =
      kind === 'select' && Array.isArray(item.options)
        ? item.options.filter((option): option is string => typeof option === 'string')
        : []
    toggles.push({ key, label, kind, options })
    seen.add(key)
  }
  return toggles
}

function normalizeAgentLorebookInputs(value: unknown): AgentLorebookInput[] {
  if (!Array.isArray(value)) return []
  const inputs: AgentLorebookInput[] = []
  const seen = new Set<string>()
  for (const item of value.slice(0, AGENT_LOREBOOK_INPUT_LIMIT)) {
    if (!isRecord(item)) continue
    const key = stringOrBlank(item.key)
    const displayName = stringOrBlank(item.displayName)
    if (!key || !displayName || seen.has(key)) continue
    inputs.push({ key, displayName, required: item.required !== false })
    seen.add(key)
  }
  return inputs
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

function validateBeforeMainUserInputModifier(
  enabledSteps: readonly AgentPresetStepRecord[],
  path: string,
): AgentPresetValidationIssue[] {
  const issues: AgentPresetValidationIssue[] = []
  const beforeMainSteps = enabledSteps.filter((step) => step.phase === 'beforeMain')
  const modifiers = beforeMainSteps.filter(isAgentPresetUserInputModifierStep)
  if (modifiers.length > 1) {
    issues.push(
      issue(
        'invalid_before_main_modifier',
        `${path}.steps`,
        'Only one enabled before-main Agent Preset step can directly modify user input',
      ),
    )
  }
  if (modifiers.length === 1 && beforeMainSteps[beforeMainSteps.length - 1] !== modifiers[0]) {
    issues.push(
      issue(
        'invalid_before_main_modifier',
        `${path}.steps`,
        'The enabled before-main user-input modifier must be the last enabled before-main step',
      ),
    )
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

function isAgentToggleKind(value: unknown): value is AgentToggleKind {
  return value === 'boolean' || value === 'select' || value === 'text' || value === 'textarea'
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
  return value === 'promptOutput' || value === 'intermediate' || value === 'userInput' || value === 'finalOutput'
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
