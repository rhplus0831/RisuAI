import type { ChatGenerationRequiredSidebarToggle } from './chatGenerationSettings'
import type { MessagePresetInfo } from './storage/database.svelte'

export interface PromptInfoSnapshotInput {
  enabled: boolean
  promptPreset?: unknown
  requiredSidebarToggles: readonly ChatGenerationRequiredSidebarToggle[]
  sidebarToggles?: Readonly<Record<string, string>>
}

/**
 * Build the prompt-preset metadata stored beside a generated assistant message.
 * The input is deliberately store-agnostic so browser and server generation use
 * the same formatting for chat-scoped preset toggles.
 */
export function createPromptInfoSnapshot(input: PromptInfoSnapshotInput): MessagePresetInfo {
  if (!input.enabled) return {}

  return {
    promptName: stringProperty(input.promptPreset, 'name'),
    promptToggles: input.requiredSidebarToggles.flatMap((toggle) =>
      formatPromptToggle(toggle, input.sidebarToggles?.[toggle.key]),
    ),
  }
}

function formatPromptToggle(
  toggle: ChatGenerationRequiredSidebarToggle,
  raw: string | undefined,
): { key: string; value: string }[] {
  if (toggle.kind === 'select') {
    if (typeof raw !== 'string') return []
    const optionIndex = Number(raw)
    const selectedOption = Number.isInteger(optionIndex) ? toggle.options[optionIndex] : undefined
    return [{ key: toggle.label, value: selectedOption ?? raw }]
  }
  if (toggle.kind === 'text' || toggle.kind === 'textarea') {
    return typeof raw === 'string' ? [{ key: toggle.label, value: raw }] : []
  }
  if (raw === '1') {
    return [{ key: toggle.label, value: 'ON' }]
  }
  return []
}

function stringProperty(value: unknown, key: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const raw = (value as Record<string, unknown>)[key]
  return typeof raw === 'string' ? raw : ''
}
