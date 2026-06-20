import type { Database } from '../storage/database.svelte'
import { LLMFlags, LLMProvider, type LLMModel } from './types'
import {
  resolveModelProfile,
  type ModelProfileStatus,
  type ModelProfileStatusBucket,
  type ResolvedModelProfile,
} from './modelProfileResolver'
import { MODEL_ROLES, type ModelRole } from './modelRoles'

export interface ModelProfileUiApiKeyModel {
  keyIdentifier: string
  name: string
}

export interface ModelProfileUiState {
  resolvedProfiles: Record<ModelRole, ResolvedModelProfile>
  roleStatuses: Record<ModelRole, ModelProfileStatus>
  rolesByStatus: Record<ModelProfileStatusBucket, ModelRole[]>
  allRolesUseDurableProfiles: boolean
  apiKeyModels: ModelProfileUiApiKeyModel[]
  usesGoogleCloudProvider: boolean
  usesVertexAIProvider: boolean
  usesNovelListProvider: boolean
  usesAnthropicProvider: boolean
  usesMistralProvider: boolean
  usesNovelAIProvider: boolean
  usesCohereProvider: boolean
  usesOpenAIProvider: boolean
  usesStreamingModel: boolean
  usesGeminiThinkingModel: boolean
  usesMancerModel: boolean
  usesReverseProxyModel: boolean
  usesOllamaLocal: boolean
  usesOllamaCloud: boolean
  usesNanoGPTModel: boolean
  usesOpenRouterModel: boolean
  usesCustomModel: boolean
  usesKoboldModel: boolean
  usesEchoModel: boolean
  usesHordeModel: boolean
  usesTextgenWebUIModel: boolean
  usesOobaModel: boolean
}

export interface ResolveModelProfileUiStateArgs {
  database: Database
  lookupModelInfo?: (database: Database, modelId: string) => LLMModel | null | undefined
}

export function resolveModelProfileUiState({
  database,
  lookupModelInfo,
}: ResolveModelProfileUiStateArgs): ModelProfileUiState {
  const resolvedProfiles = Object.fromEntries(
    MODEL_ROLES.map((role) => [
      role,
      resolveModelProfile({
        database,
        role,
        lookupModelInfo,
      }),
    ]),
  ) as Record<ModelRole, ResolvedModelProfile>
  const profiles = Object.values(resolvedProfiles)
  const roleStatuses = resolveRoleStatuses(resolvedProfiles)
  const rolesByStatus = groupRolesByStatus(roleStatuses)
  const modelIds = profiles.map((profile) => profile.modelId).filter((modelId) => modelId.trim() !== '')
  const modelInfos = profiles.map((profile) => profile.modelInfo)

  return {
    resolvedProfiles,
    roleStatuses,
    rolesByStatus,
    allRolesUseDurableProfiles: profiles.every((profile) => profile.source.kind === 'durable-profile'),
    apiKeyModels: resolveApiKeyModels(modelInfos),
    usesGoogleCloudProvider: modelInfos.some((info) => info.provider === LLMProvider.GoogleCloud),
    usesVertexAIProvider: modelInfos.some((info) => info.provider === LLMProvider.VertexAI),
    usesNovelListProvider: modelInfos.some((info) => info.provider === LLMProvider.NovelList),
    usesAnthropicProvider: modelInfos.some(
      (info) => info.provider === LLMProvider.Anthropic || info.provider === LLMProvider.AWS,
    ),
    usesMistralProvider: modelInfos.some((info) => info.provider === LLMProvider.Mistral),
    usesNovelAIProvider: modelInfos.some((info) => info.provider === LLMProvider.NovelAI),
    usesCohereProvider: modelInfos.some((info) => info.provider === LLMProvider.Cohere),
    usesOpenAIProvider: modelInfos.some((info) => info.provider === LLMProvider.OpenAI),
    usesStreamingModel: modelInfos.some((info) => info.flags.includes(LLMFlags.hasStreaming)),
    usesGeminiThinkingModel: modelInfos.some((info) => info.flags.includes(LLMFlags.geminiThinking)),
    usesMancerModel: modelIds.some((modelId) => modelId.startsWith('mancer')),
    usesReverseProxyModel: modelIds.includes('reverse_proxy'),
    usesOllamaLocal: modelIds.includes('ollama-hosted'),
    usesOllamaCloud: modelIds.includes('ollama-cloud'),
    usesNanoGPTModel: modelIds.includes('nanogpt'),
    usesOpenRouterModel: modelIds.includes('openrouter'),
    usesCustomModel: modelIds.includes('custom') || modelIds.some((modelId) => modelId.startsWith('pluginmodel:::')),
    usesKoboldModel: modelIds.includes('kobold'),
    usesEchoModel: modelIds.includes('echo_model'),
    usesHordeModel: modelIds.some((modelId) => modelId.startsWith('horde')),
    usesTextgenWebUIModel: modelIds.includes('textgen_webui'),
    usesOobaModel: modelIds.includes('ooba'),
  }
}

export function getModelProfileRoleStatus(state: ModelProfileUiState, role: ModelRole): ModelProfileStatus {
  return state.roleStatuses[role]
}

export function getModelProfileRolesByStatus(
  state: ModelProfileUiState,
  bucket: ModelProfileStatusBucket,
): ModelRole[] {
  return [...state.rolesByStatus[bucket]]
}

export function modelProfileRoleHasStatus(
  state: ModelProfileUiState,
  role: ModelRole,
  bucket: ModelProfileStatusBucket,
): boolean {
  return state.roleStatuses[role].bucket === bucket
}

function resolveRoleStatuses(
  resolvedProfiles: Record<ModelRole, ResolvedModelProfile>,
): Record<ModelRole, ModelProfileStatus> {
  return Object.fromEntries(MODEL_ROLES.map((role) => [role, resolvedProfiles[role].status])) as Record<
    ModelRole,
    ModelProfileStatus
  >
}

function groupRolesByStatus(
  roleStatuses: Record<ModelRole, ModelProfileStatus>,
): Record<ModelProfileStatusBucket, ModelRole[]> {
  return {
    ready: MODEL_ROLES.filter((role) => roleStatuses[role].bucket === 'ready'),
    incomplete: MODEL_ROLES.filter((role) => roleStatuses[role].bucket === 'incomplete'),
    compatibility: MODEL_ROLES.filter((role) => roleStatuses[role].bucket === 'compatibility'),
    unsupported: MODEL_ROLES.filter((role) => roleStatuses[role].bucket === 'unsupported'),
  }
}

function resolveApiKeyModels(modelInfos: LLMModel[]): ModelProfileUiApiKeyModel[] {
  const seen = new Set<string>()
  const apiKeyModels: ModelProfileUiApiKeyModel[] = []

  for (const info of modelInfos) {
    const keyIdentifier = info.keyIdentifier
    if (!keyIdentifier || seen.has(keyIdentifier)) continue

    seen.add(keyIdentifier)
    apiKeyModels.push({ keyIdentifier, name: info.name })
  }

  return apiKeyModels
}
