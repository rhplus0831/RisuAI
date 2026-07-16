import type { triggerscript } from 'src/ts/process/triggers'

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
  }
  return parsed as triggerscript[]
}
