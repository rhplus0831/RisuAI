import { normalizePromptTemplate as normalizeSharedPromptTemplate } from '@risuai/shared-core/prompt-template-normalization'
import type { PromptItem } from './prompt'

export {
  isPromptRoleValue,
  normalizeCacheRole,
  normalizePromptBlockRoleForType,
  normalizePromptRole,
} from '@risuai/shared-core/prompt-template-normalization'

/** Browser compatibility facade retaining the application PromptItem return type. */
export function normalizePromptTemplate(template: unknown): PromptItem[] | null {
  return normalizeSharedPromptTemplate(template) as PromptItem[] | null
}
