export const REMOTE_EMBEDDING_MODELS = [
  'custom',
  'ada',
  'openai3small',
  'openai3large',
  'voyageContext3',
  'voyageContext4',
] as const
export const CONTEXTUAL_REMOTE_EMBEDDING_MODELS = ['voyageContext3', 'voyageContext4'] as const

export type RemoteEmbeddingModel = (typeof REMOTE_EMBEDDING_MODELS)[number]
export type ContextualRemoteEmbeddingModel = (typeof CONTEXTUAL_REMOTE_EMBEDDING_MODELS)[number]
export type EmbeddingInputType = 'query' | 'document'

export type EmbeddingOperationCredential =
  | { source: 'none' }
  | { source: 'stored' }
  | { source: 'provided'; apiKey: string }

export type CustomEmbeddingConfiguration =
  | { source: 'stored' }
  | {
      source: 'provided'
      url: string
      model?: string
    }

export interface EmbeddingTextsOperationRequest {
  operation: 'texts'
  model: Exclude<RemoteEmbeddingModel, ContextualRemoteEmbeddingModel>
  inputType: EmbeddingInputType
  input: string[]
  credential: EmbeddingOperationCredential
  custom?: CustomEmbeddingConfiguration
}

export interface EmbeddingGroupsOperationRequest {
  operation: 'groups'
  model: ContextualRemoteEmbeddingModel
  inputType: EmbeddingInputType
  groups: string[][]
  credential: EmbeddingOperationCredential
}

export type EmbeddingOperationRequest = EmbeddingTextsOperationRequest | EmbeddingGroupsOperationRequest

export interface EmbeddingTextsOperationSuccess {
  operation: 'texts'
  model: string
  dimension: number
  vectors: number[][]
}

export interface EmbeddingGroupsOperationSuccess {
  operation: 'groups'
  model: string
  dimension: number
  groups: number[][][]
}

export type EmbeddingOperationSuccess = EmbeddingTextsOperationSuccess | EmbeddingGroupsOperationSuccess

export function isRemoteEmbeddingModel(value: unknown): value is RemoteEmbeddingModel {
  return typeof value === 'string' && (REMOTE_EMBEDDING_MODELS as readonly string[]).includes(value)
}

export function isContextualRemoteEmbeddingModel(value: unknown): value is ContextualRemoteEmbeddingModel {
  return typeof value === 'string' && (CONTEXTUAL_REMOTE_EMBEDDING_MODELS as readonly string[]).includes(value)
}
