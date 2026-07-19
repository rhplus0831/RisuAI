import type { ChatGenerationSidebarToggleKind } from './chatGenerationSettings'

export interface ChatGenerationTogglePreset {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  sidebarToggles: Record<string, string>
  sidebarToggleKinds: Record<string, ChatGenerationSidebarToggleKind>
}

const SIDEBAR_TOGGLE_KINDS = new Set(['boolean', 'select', 'text', 'textarea'])

export function normalizeChatGenerationTogglePresets(value: unknown): ChatGenerationTogglePreset[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const normalized: ChatGenerationTogglePreset[] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) continue
    const id = nonEmptyString(item.id)
    if (!id || seen.has(id)) continue
    seen.add(id)

    normalized.push({
      id,
      name: nonEmptyString(item.name) ?? `Toggle Preset ${index + 1}`,
      createdAt: finiteNumber(item.createdAt) ?? 0,
      updatedAt: finiteNumber(item.updatedAt) ?? finiteNumber(item.createdAt) ?? 0,
      sidebarToggles: stringRecord(item.sidebarToggles),
      sidebarToggleKinds: sidebarToggleKindRecord(item.sidebarToggleKinds),
    })
  }

  return normalized
}

export function cloneChatGenerationTogglePreset(preset: ChatGenerationTogglePreset): ChatGenerationTogglePreset {
  return {
    ...preset,
    sidebarToggles: { ...preset.sidebarToggles },
    sidebarToggleKinds: { ...preset.sidebarToggleKinds },
  }
}

export function cloneChatGenerationTogglePresetList(
  presets: readonly ChatGenerationTogglePreset[],
): ChatGenerationTogglePreset[] {
  return presets.map(cloneChatGenerationTogglePreset)
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return Object.fromEntries(entries)
}

function sidebarToggleKindRecord(value: unknown): Record<string, ChatGenerationSidebarToggleKind> {
  if (!isRecord(value)) return {}
  const entries = Object.entries(value).filter(
    (entry): entry is [string, ChatGenerationSidebarToggleKind] =>
      typeof entry[1] === 'string' && SIDEBAR_TOGGLE_KINDS.has(entry[1]),
  )
  return Object.fromEntries(entries)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
