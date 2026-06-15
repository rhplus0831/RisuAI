import type { Message, MessagePresetInfo } from '../../ts/storage/database.svelte'

type PromptToggle = NonNullable<MessagePresetInfo['promptToggles']>[number]
type PromptTextRow = NonNullable<MessagePresetInfo['promptText']>[number]

export interface AlertPromptInfoView {
  hasPromptInfo: boolean
  promptName: string
  promptToggles: PromptToggle[]
  promptText: PromptTextRow[]
}

const PROMPT_TEXT_ROLES = new Set(['system', 'user', 'assistant', 'function'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPromptTextRole(value: unknown): value is PromptTextRow['role'] {
  return typeof value === 'string' && PROMPT_TEXT_ROLES.has(value)
}

function normalizePromptToggles(value: unknown): PromptToggle[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((toggle): PromptToggle[] => {
    if (!isRecord(toggle) || typeof toggle.key !== 'string' || typeof toggle.value !== 'string') return []
    return [{ key: toggle.key, value: toggle.value }]
  })
}

function normalizePromptText(value: unknown): PromptTextRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): PromptTextRow[] => {
    if (!isRecord(row) || !isPromptTextRole(row.role) || typeof row.content !== 'string') return []
    return [{ role: row.role, content: row.content }]
  })
}

export function normalizePromptInfo(promptInfo: MessagePresetInfo | null | undefined): AlertPromptInfoView {
  const promptName = typeof promptInfo?.promptName === 'string' ? promptInfo.promptName : ''
  const promptToggles = normalizePromptToggles(promptInfo?.promptToggles)
  const promptText = normalizePromptText(promptInfo?.promptText)

  return {
    hasPromptInfo: promptName.length > 0 || promptToggles.length > 0 || promptText.length > 0,
    promptName,
    promptToggles,
    promptText,
  }
}

export function normalizeMessagePromptInfo(message: Pick<Message, 'promptInfo'> | null | undefined) {
  return normalizePromptInfo(message?.promptInfo)
}
