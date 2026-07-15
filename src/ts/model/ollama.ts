import { globalFetch } from '../globalApi.svelte'
import { providerOperationCredential, requestProviderOperation } from '../server/providerOperations'
import type { ModelGridItem } from './modelGrid'
import { createKeyedRequestCache, type KeyedRequestOptions } from './keyedRequestCache'

export type OllamaModelSource = 'local' | 'cloud'

type OllamaTagModel = {
  name?: string
  model?: string
  remote_model?: string
  remote_host?: string
  modified_at?: string | Date
  size?: number
  digest?: string
  details?: {
    format?: string
    family?: string
    families?: string[] | null
    parameter_size?: string
    quantization_level?: string
  }
}

const ollamaCloudModelRequests = createKeyedRequestCache<ModelGridItem[]>({ ttlMs: 15_000 })

export async function getOllamaModels(
  host: string,
  source: OllamaModelSource,
  apiKey = '',
  options?: KeyedRequestOptions,
): Promise<ModelGridItem[]> {
  try {
    if (source === 'cloud') {
      const credential = providerOperationCredential(apiKey)
      return await ollamaCloudModelRequests.request(
        apiKey,
        async () => {
          const response = await requestProviderOperation<{ models?: OllamaTagModel[] }>('ollama.cloud-models', {
            credential,
          })
          if (!Array.isArray(response.models)) throw new Error('Ollama model response was malformed')
          return response.models.map((model) => toModelGridItem(model, source))
        },
        {
          ...options,
          refresh: options?.refresh || credential.source === 'stored' || credential.source === 'model-profile',
        },
      )
    }

    const baseUrl = host.replace(/\/$/, '')
    const response = await globalFetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      headers: {},
      interceptor: 'ollama_models',
    })
    if (!response.ok) throw new Error('Ollama model request failed')
    if (!Array.isArray(response.data?.models)) throw new Error('Ollama model response was malformed')
    return response.data.models.map((model: OllamaTagModel) => toModelGridItem(model, source))
  } catch {
    return []
  }
}

export function clearOllamaCloudModelRequestCacheForTests(): void {
  ollamaCloudModelRequests.clear()
}

export function toModelGridItem(model: OllamaTagModel, source: OllamaModelSource): ModelGridItem {
  const id = model.model || model.name || ''
  const details = model.details
  const descriptionParts = [
    model.remote_model ? `Remote: ${model.remote_model}` : null,
    model.remote_host ? `Host: ${model.remote_host}` : null,
    details?.parameter_size,
    details?.quantization_level,
    details?.format,
    details?.family,
  ].filter(Boolean)

  return {
    id,
    displayName: model.name || id,
    providerName: source === 'cloud' ? 'Cloud' : 'Local',
    description: descriptionParts.join(' / '),
    context_length: 0,
    sortPrice: source === 'cloud' ? 1 : 0,
    prices: [],
  }
}
