import type { triggerscript } from '../../../../src/ts/process/triggers'

const TRIGGER_SOURCE = Symbol('risu.triggerSource')

export interface TriggerSourceAttribution {
  ownerType: 'character' | 'module'
  ownerId?: string
  ownerName?: string
  triggerId?: string
  triggerIndex?: number
  triggerComment?: string
  triggerType?: string
  effectIndex?: number
  effectType?: string
  lowLevelAccess?: boolean
}

type AttributedTrigger = triggerscript & {
  [TRIGGER_SOURCE]?: TriggerSourceAttribution
}

function compactSource(source: TriggerSourceAttribution): TriggerSourceAttribution {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  ) as TriggerSourceAttribution
}

export function attachTriggerSource<T extends triggerscript>(trigger: T, metadata: TriggerSourceAttribution): T {
  Object.defineProperty(trigger, TRIGGER_SOURCE, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: compactSource(metadata),
  })
  return trigger
}

export function getTriggerSource(trigger: triggerscript | undefined): TriggerSourceAttribution | undefined {
  return (trigger as AttributedTrigger | undefined)?.[TRIGGER_SOURCE]
}

export function withTriggerEffectSource(
  base: TriggerSourceAttribution | undefined,
  effectIndex: number,
  effectType: string | undefined,
): TriggerSourceAttribution | undefined {
  if (!base) return undefined
  return compactSource({
    ...base,
    effectIndex,
    effectType,
  })
}

export function triggerSourceMetricFields(
  source: TriggerSourceAttribution | undefined,
): Record<string, string | number | boolean> {
  if (!source) return {}
  const fields: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      fields[key] = value
    }
  }
  return fields
}
