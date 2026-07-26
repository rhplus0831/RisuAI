import { getDatabase } from 'src/ts/storage/database.svelte'
import { embeddingOperationCredential, requestRemoteEmbeddingGroups } from 'src/ts/server/embeddingOperations'
import type { ContextualRemoteEmbeddingModel } from 'src/ts/server/embeddingOperationsProtocol'
import { contextHash, type VectorArray } from './hypamemory'

export interface ContextualEmbeddingProvider {
  readonly modelId: string
  embedDocumentGroups(groups: string[][], signal?: AbortSignal): Promise<VectorArray[][]>
  embedQueries(queries: string[], signal?: AbortSignal): Promise<VectorArray[]>
  getCacheKeySuffix(contextTexts?: string[]): string
}

export function isContextModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(VOYAGE_CONTEXT_MODELS, model)
}

export function getContextProvider(model: string): ContextualEmbeddingProvider | null {
  if (!isContextModel(model)) return null
  const applicationModel = model as ContextualRemoteEmbeddingModel
  return new VoyageContextProvider(applicationModel, VOYAGE_CONTEXT_MODELS[applicationModel])
}

const VOYAGE_CONTEXT_MODELS = {
  voyageContext3: 'voyage-context-3',
  voyageContext4: 'voyage-context-4',
} as const satisfies Record<ContextualRemoteEmbeddingModel, string>
const MAX_CHUNKS_PER_REQUEST = 1000
const MAX_INPUTS_PER_REQUEST = 256

class VoyageContextProvider implements ContextualEmbeddingProvider {
  constructor(
    private readonly applicationModel: ContextualRemoteEmbeddingModel,
    readonly modelId: string,
  ) {}

  async embedDocumentGroups(groups: string[][], signal?: AbortSignal): Promise<VectorArray[][]> {
    const credential = embeddingOperationCredential(getDatabase().voyageApiKey)
    const batches = this.batchGroups(groups)
    const allResults: VectorArray[][] = new Array(groups.length)

    let groupOffset = 0
    for (const batch of batches) {
      const result = await requestRemoteEmbeddingGroups({
        model: this.applicationModel,
        inputType: 'document',
        groups: batch,
        credential,
        signal,
      })
      for (let i = 0; i < batch.length; i++) {
        allResults[groupOffset + i] = result[i]
      }

      groupOffset += batch.length
    }

    return allResults
  }

  async embedQueries(queries: string[], signal?: AbortSignal): Promise<VectorArray[]> {
    const credential = embeddingOperationCredential(getDatabase().voyageApiKey)
    const batches = this.batchGroups(queries.map((query) => [query]))
    const results: VectorArray[] = []
    for (const groups of batches) {
      const batch = await requestRemoteEmbeddingGroups({
        model: this.applicationModel,
        inputType: 'query',
        groups,
        credential,
        signal,
      })
      results.push(...batch.map((group) => group[0]))
    }
    return results
  }

  getCacheKeySuffix(contextTexts?: string[]): string {
    const ctxPart = contextTexts && contextTexts.length > 1 ? `|ctx:${contextHash(contextTexts)}` : ''
    return `|${this.applicationModel}${ctxPart}`
  }

  private batchGroups(groups: string[][]): string[][][] {
    const batches: string[][][] = []
    let currentBatch: string[][] = []
    let currentChunkCount = 0

    for (const group of groups) {
      if (
        currentBatch.length > 0 &&
        (currentBatch.length + 1 > MAX_INPUTS_PER_REQUEST || currentChunkCount + group.length > MAX_CHUNKS_PER_REQUEST)
      ) {
        batches.push(currentBatch)
        currentBatch = []
        currentChunkCount = 0
      }
      currentBatch.push(group)
      currentChunkCount += group.length
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch)
    }

    return batches
  }
}
