import type { ServerCommandLocalEffect } from './commands'

export type SplitPresetDraftProjection = 'presetRow' | 'selectedSettings' | 'promptTemplateOwner'

export interface AppliedSettingDraftAcknowledgementInput {
  localEffect: ServerCommandLocalEffect
  dirtyOwnerKey: string | null
  currentOwnerKey: string
  rootKey: string
  path?: readonly string[]
  attemptedValue: unknown
  currentValue: unknown
  splitPresetProjection?: SplitPresetDraftProjection
}

export function serverSettingDraftOwnerKey(rootKey: string): string {
  return `settings:${rootKey}`
}

export function splitPresetSettingDraftOwnerKey(
  presetKind: 'model' | 'prompt',
  presetId: string,
  presetField: string,
): string {
  return `${presetKind}Preset:${presetId}:${presetField}`
}

/**
 * Settle a dirty setting draft only for the applied local effect produced by
 * that same owner and attempted value. This keeps stale external projections
 * fenced while allowing a server-normalized receipt to become visible.
 */
export function appliedLocalEffectAcknowledgesSettingDraft({
  localEffect,
  dirtyOwnerKey,
  currentOwnerKey,
  rootKey,
  path = [],
  attemptedValue,
  currentValue,
  splitPresetProjection = 'selectedSettings',
}: AppliedSettingDraftAcknowledgementInput): boolean {
  if (!dirtyOwnerKey || dirtyOwnerKey !== currentOwnerKey) return false

  if (localEffect.kind === 'settingsPatch') {
    if (dirtyOwnerKey !== serverSettingDraftOwnerKey(rootKey)) return false
    if (
      !Object.prototype.hasOwnProperty.call(localEffect.attemptedPatch, rootKey) ||
      !Object.prototype.hasOwnProperty.call(localEffect.settings, rootKey)
    ) {
      return false
    }
    return (
      snapshotJson(valueAtPath(localEffect.attemptedPatch[rootKey], path)) === snapshotJson(attemptedValue) &&
      snapshotJson(valueAtPath(localEffect.settings[rootKey], path)) === snapshotJson(currentValue)
    )
  }

  if (localEffect.kind !== 'splitPresetPatch') return false
  if (splitPresetProjection === 'selectedSettings' && !localEffect.selectedProjectionApplied) return false
  if (splitPresetProjection === 'promptTemplateOwner' && !localEffect.ownerProjectionApplied) return false

  for (const [presetField, attemptedRoot] of Object.entries(localEffect.attemptedPatch)) {
    const effectOwnerKey = splitPresetSettingDraftOwnerKey(localEffect.presetKind, localEffect.presetId, presetField)
    if (effectOwnerKey !== dirtyOwnerKey) continue
    const attemptedProjectionRoot =
      splitPresetProjection === 'selectedSettings' ? localEffect.attemptedSettings[rootKey] : attemptedRoot
    const canonicalRoot =
      splitPresetProjection === 'selectedSettings' ? localEffect.settings[rootKey] : localEffect.preset[presetField]
    if (
      splitPresetProjection === 'selectedSettings' &&
      (!Object.prototype.hasOwnProperty.call(localEffect.attemptedSettings, rootKey) ||
        !Object.prototype.hasOwnProperty.call(localEffect.settings, rootKey))
    ) {
      return false
    }
    if (
      splitPresetProjection !== 'selectedSettings' &&
      !Object.prototype.hasOwnProperty.call(localEffect.preset, presetField)
    ) {
      return false
    }
    return (
      snapshotJson(valueAtPath(attemptedProjectionRoot, path)) === snapshotJson(attemptedValue) &&
      snapshotJson(valueAtPath(canonicalRoot, path)) === snapshotJson(currentValue)
    )
  }
  return false
}

function valueAtPath(root: unknown, path: readonly string[]): unknown {
  let value = root
  for (const part of path) {
    if (!value || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}
