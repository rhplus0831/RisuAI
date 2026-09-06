import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { PROMPT_CHAT_EVENT_TYPES } from '@risuai/protocol'
import { GENERATION_EFFECT_KINDS, generationEffectClass, type GenerationEffectClass } from '../src/generationEffects.js'
import { GENERATION_OPERATION_STATES, type GenerationOperationState } from '../src/generationOperations.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

type PromptAssemblyStageOwner = {
  owner: string
  anchor: string
}

/** Every timed assembly stage must retain one explicit production owner. */
const PROMPT_ASSEMBLY_STAGE_OWNERS: Record<string, PromptAssemblyStageOwner> = {
  scope_resolution: { owner: 'server/fastify/src/prompt/assemble.ts', anchor: 'beginAssembly(input, deps)' },
  submit_transforms: { owner: 'server/fastify/src/prompt/assemble.ts', anchor: 'prepareRegenerateTranscript(state)' },
  agent_preset_before_main: {
    owner: 'server/fastify/src/prompt/assemble.ts',
    anchor: 'runAgentPresetBeforeMainStage(state, deps)',
  },
  static_plain_slots: { owner: 'server/fastify/src/prompt/assemble.ts', anchor: 'fillStaticSlots(state)' },
  lorebook_preflight: { owner: 'server/fastify/src/prompt/assemble.ts', anchor: 'fillLorebookSlotsAsync(state)' },
  history_bias: { owner: 'server/fastify/src/prompt/assemble.ts', anchor: 'fillHistoryAndBias(state)' },
  memory_bridge: { owner: 'server/fastify/src/prompt/assemble.ts', anchor: 'fillMemoryAndPostHistory(state)' },
  final_render: { owner: 'server/fastify/src/prompt/assemble.ts', anchor: 'renderFinalPrompt({' },
  budget: { owner: 'server/fastify/src/prompt/assemble.ts', anchor: 'finalizeRequestBudget({' },
}

type PromptContributorOwner = {
  stage: keyof typeof PROMPT_ASSEMBLY_STAGE_OWNERS
  sources: Readonly<Record<string, readonly string[]>>
}

/**
 * Closed semantic inventory of everything that can change model-visible rows,
 * dispatch controls, or provider-native messages.
 */
const PROMPT_CONTRIBUTOR_OWNERS: Record<string, PromptContributorOwner> = {
  effective_configuration: {
    stage: 'scope_resolution',
    sources: {
      'server/fastify/src/prompt/effectiveGenerationConfig.ts': ['buildEffectiveGenerationConfig'],
    },
  },
  submit_and_edit_input: {
    stage: 'submit_transforms',
    sources: {
      'server/fastify/src/prompt/assemble.ts': ['runInputTrigger(state)', 'applyEditInput(state)'],
    },
  },
  agent_preset_inputs: {
    stage: 'agent_preset_before_main',
    sources: {
      'server/fastify/src/prompt/agentPresetExecution.ts': [
        'collectAgentPresetPreparedInputs',
        'executeAgentPresetPhase',
      ],
    },
  },
  templates_and_roles: {
    stage: 'final_render',
    sources: {
      'server/fastify/src/prompt/templates.ts': ['normalizeTemplate', 'renderFinalPrompt'],
    },
  },
  static_and_plain_rows: {
    stage: 'static_plain_slots',
    sources: {
      'server/fastify/src/prompt/staticSections.ts': ['buildDescription', 'buildPersona'],
      'server/fastify/src/prompt/plainSections.ts': ['buildPlainPromptSections'],
    },
  },
  history_and_message_roles: {
    stage: 'history_bias',
    sources: {
      'server/fastify/src/prompt/history.ts': ['buildHistoryWindow', 'formatHistoryMessage'],
    },
  },
  lorebook_rows: {
    stage: 'lorebook_preflight',
    sources: {
      'server/fastify/src/prompt/lorebook.ts': ['activateLorebookAsync', 'buildLorebookContext'],
    },
  },
  hypa_and_bardwiki_memory: {
    stage: 'memory_bridge',
    sources: {
      'server/fastify/src/prompt/memoryAdapter.ts': ['selectPromptMemory', 'assemblePromptMemoryRows'],
      'server/fastify/src/prompt/bardWiki.ts': ['buildBardWikiPromptRows'],
    },
  },
  cbs_variables: {
    stage: 'history_bias',
    sources: {
      'server/fastify/src/prompt/variables.ts': ['expandVariables'],
      'server/fastify/src/prompt/triggerVars.ts': ['createTriggerVarEngine'],
    },
  },
  regex_and_lua_scripts: {
    stage: 'final_render',
    sources: {
      'server/fastify/src/prompt/scripts.ts': ['processScriptAsync'],
      'server/fastify/src/prompt/luaRuntime.ts': ['runLuaEditTrigger'],
      'server/fastify/src/prompt/triggers.ts': ['runTrigger'],
    },
  },
  logit_biases: {
    stage: 'history_bias',
    sources: {
      'server/fastify/src/prompt/assemble.ts': ['state.biases = [...globalBias, ...characterBias]'],
      'server/fastify/src/prompt/chatDispatch.ts': ['resolveOpenAILogitBias'],
    },
  },
  stop_data: {
    stage: 'budget',
    sources: {
      'server/fastify/src/prompt/chatDispatch.ts': ['buildOobaLegacyStopStrings', 'stoppingStrings'],
    },
  },
  asset_and_multimodal_rows: {
    stage: 'history_bias',
    sources: {
      'server/fastify/src/prompt/assetLookup.ts': ['buildAssetLookup'],
      'server/fastify/src/prompt/promptAssets.ts': ['buildPromptAssetTable'],
    },
  },
  provider_ready_messages: {
    stage: 'final_render',
    sources: {
      'server/fastify/src/prompt/chatDispatch.ts': ['dispatchChatProvider', 'finalizedMessages'],
      'server/fastify/src/generation/providerMessages.ts': [
        'sanitizeTextMessages',
        'buildOpenAIWireMessages',
        'buildAnthropicWireMessages',
      ],
    },
  },
  final_budget: {
    stage: 'budget',
    sources: {
      'server/fastify/src/prompt/budgetFinalize.ts': ['finalizeRequestBudget'],
    },
  },
}

type GenerationActionOwner = {
  persistence: 'read-only' | 'durable-transcript'
  anchor: string
}

const GENERATION_ACTION_OWNERS: Record<string, GenerationActionOwner> = {
  send: { persistence: 'durable-transcript', anchor: "mode === 'send'" },
  continue: { persistence: 'durable-transcript', anchor: "mode === 'continue'" },
  preview: {
    persistence: 'read-only',
    anchor: "'send', 'continue', 'preview', 'preview_prompt', 'regenerate'",
  },
  preview_prompt: { persistence: 'read-only', anchor: "mode === 'preview_prompt'" },
  regenerate: { persistence: 'durable-transcript', anchor: "mode === 'regenerate'" },
}

const GENERATION_STYLE_OWNERS: Record<string, { owner: string; anchors: readonly string[] }> = {
  inline: {
    owner: 'server/fastify/src/routes/generationChat.ts',
    anchors: ['await streamAssembly(', 'durable: false'],
  },
  durable_detached: {
    owner: 'server/fastify/src/routes/generationChat.ts',
    anchors: ['runGenerationJob({', 'durable: true'],
  },
  buffered: {
    owner: 'server/fastify/src/prompt/providerTransport.ts',
    anchors: ['emitProviderChunks', 'postGeneration'],
  },
  streamed: {
    owner: 'server/fastify/src/prompt/providerTransport.ts',
    anchors: ["frame.kind === 'token'", 'emit({ type:'],
  },
  half_streamed: {
    owner: 'server/fastify/src/routes/generationChat.ts',
    anchors: ['halfStreamingTokenProgress', 'halfStreaming: true'],
  },
  multi_result: {
    owner: 'server/fastify/src/prompt/chatDispatch.ts',
    anchors: ['multiGeneration', 'alternates'],
  },
  continue_append: {
    owner: 'server/fastify/src/prompt/assemble.ts',
    anchors: ["continueDisposition === 'append'", 'transientContinueBoundaryId'],
  },
  continue_extend: {
    owner: 'server/fastify/src/prompt/assemble.ts',
    anchors: ["continueDisposition === 'extend'", 'messages[continueIndex] ='],
  },
  edit_then_generate: {
    owner: 'server/fastify/src/prompt/assemble.ts',
    anchors: ['applyEditInput(state)', 'captureSubmitTranscript(state)'],
  },
}

const GENERATION_OPERATION_STATE_CLASSES: Record<GenerationOperationState, string> = {
  cancel_requested: 'admission-cancel',
  accepted: 'admission',
  launching: 'attempt-start',
  owned_by_job: 'provider-running',
  stopping: 'cancellation',
  finalizing: 'authoritative-finalization',
  retryable: 'recovery',
  abandoned: 'recovery',
  completed: 'terminal-success',
  cancelled: 'terminal-cancel',
  terminal_failed: 'terminal-failure',
  invalidated: 'terminal-invalidation',
}

const GENERATION_EFFECT_CLASSES: Record<string, GenerationEffectClass> = {
  igp: 'durable',
  plugin_output: 'durable',
  generated_translation: 'durable',
  notification: 'ephemeral',
  tts: 'ephemeral',
  completion_sound: 'ephemeral',
  emotion_image_state: 'recomputed',
}

const GENERATION_EVENT_OWNERS: Record<string, string> = {
  stage: 'assembly-progress',
  job_accepted: 'durable-admission',
  prompt: 'model-input',
  info: 'generation-metadata',
  token: 'stream-output',
  replay_gap: 'durable-replay',
  message_patch: 'transcript-mutation',
  side_effect: 'live-effect',
  agent_preset_progress: 'agent-progress',
  post_generation_progress: 'finalization-progress',
  warning: 'recoverable-diagnostic',
  error: 'failure-terminal-or-recoverable',
  done: 'terminal',
}

describe('Phase 6 compatibility structure', () => {
  it('pins every prompt assembly stage and model-visible contributor to a production owner', () => {
    const assembleSource = readRepoFile('server/fastify/src/prompt/assemble.ts')
    expect(interfacePropertyStringUnion(assembleSource, 'AssembleInput', 'mode').sort()).toEqual(
      Object.keys(GENERATION_ACTION_OWNERS).sort(),
    )
    expect(typeAliasStringUnion(assembleSource, 'PromptAssemblyStage').sort()).toEqual(
      Object.keys(PROMPT_ASSEMBLY_STAGE_OWNERS).sort(),
    )

    for (const [stage, owner] of Object.entries(PROMPT_ASSEMBLY_STAGE_OWNERS)) {
      expect(readRepoFile(owner.owner), `${stage} stage owner`).toContain(owner.anchor)
    }
    for (const [contributor, owner] of Object.entries(PROMPT_CONTRIBUTOR_OWNERS)) {
      expect(PROMPT_ASSEMBLY_STAGE_OWNERS, `${contributor} stage`).toHaveProperty(owner.stage)
      for (const [sourcePath, anchors] of Object.entries(owner.sources)) {
        const source = readRepoFile(sourcePath)
        for (const anchor of anchors) expect(source, `${contributor}: ${anchor}`).toContain(anchor)
      }
    }
  })

  it('keeps every generation action and retained style explicit', () => {
    const routeSource = readRepoFile('server/fastify/src/routes/generationChat.ts')
    for (const [action, owner] of Object.entries(GENERATION_ACTION_OWNERS)) {
      expect(routeSource, `${action} route owner`).toContain(owner.anchor)
    }
    expect(
      Object.entries(GENERATION_ACTION_OWNERS)
        .filter(([, owner]) => owner.persistence === 'durable-transcript')
        .map(([action]) => action)
        .sort(),
    ).toEqual(['continue', 'regenerate', 'send'])

    for (const [style, owner] of Object.entries(GENERATION_STYLE_OWNERS)) {
      const source = readRepoFile(owner.owner)
      for (const anchor of owner.anchors) expect(source, `${style}: ${anchor}`).toContain(anchor)
    }
  })

  it('classifies every durable operation state and finalization state', () => {
    expect(Object.keys(GENERATION_OPERATION_STATE_CLASSES).sort()).toEqual([...GENERATION_OPERATION_STATES].sort())
    const finalizationSource = readRepoFile('server/fastify/src/generationFinalizationRetry.ts')
    expect(typeAliasStringUnion(finalizationSource, 'GenerationFinalizationMode').sort()).toEqual([
      'continue',
      'regenerate',
      'send',
    ])
    expect(typeAliasStringUnion(finalizationSource, 'GenerationFinalizationProjectionState').sort()).toEqual([
      'committed_cleanup_pending',
      'queued',
      'stalled',
      'stalled_legacy',
      'terminal',
    ])
  })

  it('classifies every completion effect and stream event', () => {
    expect(Object.keys(GENERATION_EFFECT_CLASSES).sort()).toEqual([...GENERATION_EFFECT_KINDS].sort())
    for (const kind of GENERATION_EFFECT_KINDS) {
      expect(generationEffectClass(kind), kind).toBe(GENERATION_EFFECT_CLASSES[kind])
    }
    expect(Object.keys(GENERATION_EVENT_OWNERS).sort()).toEqual([...PROMPT_CHAT_EVENT_TYPES].sort())
  })
})

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

function typeAliasStringUnion(source: string, typeName: string): string[] {
  const parsed = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = parsed.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName,
  )
  expect(declaration, typeName).toBeDefined()
  return stringLiteralUnionMembers(declaration!.type)
}

function interfacePropertyStringUnion(source: string, interfaceName: string, propertyName: string): string[] {
  const parsed = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = parsed.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName,
  )
  expect(declaration, interfaceName).toBeDefined()
  const property = declaration!.members.find(
    (member): member is ts.PropertySignature =>
      ts.isPropertySignature(member) &&
      member.name !== undefined &&
      (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
      member.name.text === propertyName,
  )
  expect(property, `${interfaceName}.${propertyName}`).toBeDefined()
  expect(property!.type, `${interfaceName}.${propertyName} type`).toBeDefined()
  return stringLiteralUnionMembers(property!.type!)
}

function stringLiteralUnionMembers(type: ts.TypeNode): string[] {
  const members = ts.isUnionTypeNode(type) ? type.types : [type]
  return members.map((member) => {
    expect(ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal), member.getText()).toBe(true)
    return (member as ts.LiteralTypeNode & { literal: ts.StringLiteral }).literal.text
  })
}
