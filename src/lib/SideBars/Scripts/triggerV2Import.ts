import type { triggerscript } from 'src/ts/process/triggers'

function isTriggerEntry(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(entry, 'type') || typeof entry.type !== 'string') return false
  if (Object.prototype.hasOwnProperty.call(entry, 'indent') && typeof entry.indent !== 'number') return false
  return true
}

export function parseTriggerV2Import(text: string): triggerscript[] | null {
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) return null

  for (const trigger of parsed) {
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return null
    if (
      !Object.prototype.hasOwnProperty.call(trigger, 'comment') ||
      !Object.prototype.hasOwnProperty.call(trigger, 'type') ||
      !Array.isArray(trigger.conditions) ||
      !Array.isArray(trigger.effect)
    ) {
      return null
    }
    if (!trigger.conditions.every(isTriggerEntry) || !trigger.effect.every(isTriggerEntry)) return null
  }
  return parsed as triggerscript[]
}
