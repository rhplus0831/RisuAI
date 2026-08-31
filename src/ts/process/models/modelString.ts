import type { Database } from 'src/ts/storage/database.svelte'
import { resolveModelProfile, type ResolvedModelProfile } from 'src/ts/model/modelProfileResolver'
import { settingsResourceState } from 'src/ts/server/resourceState.svelte'

type GenerationModelDatabase = Database

function getGenerationModelDatabase(): GenerationModelDatabase {
  const status = settingsResourceState.groupStatuses.providers ?? 'idle'
  if (settingsResourceState.status !== 'error' && status === 'ready') {
    return settingsResourceState.value as Database
  }
  throw new Error('Generation model settings owner unavailable')
}

function getLegacyGenerationModelString(db: GenerationModelDatabase, name?: string): string {
  const selectedModel = name ?? db.aiModel
  switch (selectedModel) {
    case 'reverse_proxy':
      return 'custom-' + (db.reverseProxyOobaMode ? 'ooba' : db.customProxyRequestModel)
    case 'openrouter':
      return 'openrouter-' + db.openrouterRequestModel
    case 'nanogpt': {
      const modelLabel = db.nanogptRequestModelName || db.nanogptRequestModel
      return 'NanoGPT ' + modelLabel + (db.nanogptUseSubscriptionEndpoint ? ' [SUB]' : '')
    }
    case 'ollama-hosted':
    case 'ollama-cloud': {
      const modelLabel =
        name === 'ollama-cloud' ? db.ollamaCloudModelName || db.ollamaCloudModel : db.ollamaModelName || db.ollamaModel
      return `Ollama ${name === 'ollama-cloud' ? 'Cloud' : 'Local'} ${modelLabel}`
    }
    default:
      return selectedModel
  }
}

function getProfileGenerationModelString(profile: ResolvedModelProfile): string {
  switch (profile.modelId) {
    case 'reverse_proxy':
      return 'custom-' + (profile.providerOptions.reverseProxy?.oobaSystemHoist ? 'ooba' : profile.requestModel)
    case 'openrouter':
      return 'openrouter-' + profile.requestModel
    case 'nanogpt':
      return (
        'NanoGPT ' + profile.requestModel + (profile.providerOptions.nanogpt?.useSubscriptionEndpoint ? ' [SUB]' : '')
      )
    case 'ollama-hosted':
    case 'ollama-cloud':
      return `Ollama ${profile.providerOptions.ollama?.cloud ? 'Cloud' : 'Local'} ${profile.requestModel}`
    default:
      return profile.modelId
  }
}

export function getGenerationModelString(name?: string) {
  const db = getGenerationModelDatabase()
  if (name !== undefined) return getLegacyGenerationModelString(db, name)

  const profile = resolveModelProfile({ database: db })
  return profile.source.kind === 'durable-profile'
    ? getProfileGenerationModelString(profile)
    : getLegacyGenerationModelString(db)
}
