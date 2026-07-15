import { describe, expect, it } from 'vitest'
import type { ServerCommandLocalEffect } from './commands'
import {
  appliedLocalEffectAcknowledgesSettingDraft,
  serverSettingDraftOwnerKey,
  splitPresetSettingDraftOwnerKey,
} from './settingsDraftAcknowledgement'

function settingsEffect(
  attemptedPatch: Record<string, unknown>,
  settings: Record<string, unknown> = attemptedPatch,
): ServerCommandLocalEffect {
  return {
    kind: 'settingsPatch',
    group: 'display',
    attemptedPatch,
    settings,
    settingsProjectionEpoch: 1,
  }
}

function splitPresetEffect(
  overrides: Partial<Extract<ServerCommandLocalEffect, { kind: 'splitPresetPatch' }>> = {},
): Extract<ServerCommandLocalEffect, { kind: 'splitPresetPatch' }> {
  return {
    kind: 'splitPresetPatch',
    presetKind: 'prompt',
    presetId: 'prompt-a',
    attemptedPatch: { ooba: { formating: { mode: 'attempted' } } },
    preset: { ooba: { formating: { mode: 'canonical' } } },
    attemptedSettings: { ooba: { formating: { mode: 'attempted' } } },
    settings: { ooba: { formating: { mode: 'canonical' } } },
    selectedProjectionApplied: false,
    ownerProjectionApplied: false,
    collectionProjectionEpoch: 1,
    settingsProjectionEpoch: 1,
    selectedPresetId: 'prompt-a',
    ...overrides,
  }
}

describe('applied setting draft acknowledgements', () => {
  it('matches the exact settings owner, nested attempted value, and current owner', () => {
    const ownerKey = serverSettingDraftOwnerKey('deeplOptions')
    const localEffect = settingsEffect({ deeplOptions: { key: 'attempted', proxy: 'old' } })

    expect(
      appliedLocalEffectAcknowledgesSettingDraft({
        localEffect,
        dirtyOwnerKey: ownerKey,
        currentOwnerKey: ownerKey,
        rootKey: 'deeplOptions',
        path: ['key'],
        attemptedValue: 'attempted',
        currentValue: 'attempted',
      }),
    ).toBe(true)
    expect(
      appliedLocalEffectAcknowledgesSettingDraft({
        localEffect,
        dirtyOwnerKey: ownerKey,
        currentOwnerKey: serverSettingDraftOwnerKey('other'),
        rootKey: 'deeplOptions',
        path: ['key'],
        attemptedValue: 'attempted',
        currentValue: 'attempted',
      }),
    ).toBe(false)
    expect(
      appliedLocalEffectAcknowledgesSettingDraft({
        localEffect,
        dirtyOwnerKey: ownerKey,
        currentOwnerKey: ownerKey,
        rootKey: 'deeplOptions',
        path: ['key'],
        attemptedValue: 'newer edit',
        currentValue: 'attempted',
      }),
    ).toBe(false)
  })

  it('does not settle when the canonical field was skipped because the live resource is newer', () => {
    const ownerKey = serverSettingDraftOwnerKey('deeplOptions')

    expect(
      appliedLocalEffectAcknowledgesSettingDraft({
        localEffect: settingsEffect(
          { deeplOptions: { key: 'attempted', proxy: 'old' } },
          { deeplOptions: { key: 'canonical', proxy: 'old' } },
        ),
        dirtyOwnerKey: ownerKey,
        currentOwnerKey: ownerKey,
        rootKey: 'deeplOptions',
        path: ['key'],
        attemptedValue: 'attempted',
        currentValue: 'newer resource value',
      }),
    ).toBe(false)
  })

  it('requires the selected settings projection before settling a top-level preset mirror', () => {
    const ownerKey = splitPresetSettingDraftOwnerKey('prompt', 'prompt-a', 'ooba')
    const input = {
      dirtyOwnerKey: ownerKey,
      currentOwnerKey: ownerKey,
      rootKey: 'ooba',
      path: ['formating', 'mode'],
      attemptedValue: 'attempted',
      currentValue: 'canonical',
      splitPresetProjection: 'selectedSettings' as const,
    }

    expect(appliedLocalEffectAcknowledgesSettingDraft({ ...input, localEffect: splitPresetEffect() })).toBe(false)
    expect(
      appliedLocalEffectAcknowledgesSettingDraft({
        ...input,
        localEffect: splitPresetEffect({ selectedProjectionApplied: true }),
      }),
    ).toBe(true)
  })

  it('settles an exact preset-row owner independently of unrelated projection flags', () => {
    const ownerKey = splitPresetSettingDraftOwnerKey('prompt', 'prompt-a', 'ooba')

    expect(
      appliedLocalEffectAcknowledgesSettingDraft({
        localEffect: splitPresetEffect(),
        dirtyOwnerKey: ownerKey,
        currentOwnerKey: ownerKey,
        rootKey: 'ooba',
        path: ['formating', 'mode'],
        attemptedValue: 'attempted',
        currentValue: 'canonical',
        splitPresetProjection: 'presetRow',
      }),
    ).toBe(true)
    expect(
      appliedLocalEffectAcknowledgesSettingDraft({
        localEffect: splitPresetEffect(),
        dirtyOwnerKey: ownerKey,
        currentOwnerKey: splitPresetSettingDraftOwnerKey('prompt', 'prompt-b', 'ooba'),
        rootKey: 'ooba',
        path: ['formating', 'mode'],
        attemptedValue: 'attempted',
        currentValue: 'canonical',
        splitPresetProjection: 'presetRow',
      }),
    ).toBe(false)
  })

  it('requires ownerProjectionApplied for a prompt-template owner projection', () => {
    const ownerKey = splitPresetSettingDraftOwnerKey('prompt', 'prompt-a', 'ooba')
    const input = {
      dirtyOwnerKey: ownerKey,
      currentOwnerKey: ownerKey,
      rootKey: 'ooba',
      path: ['formating', 'mode'],
      attemptedValue: 'attempted',
      currentValue: 'canonical',
      splitPresetProjection: 'promptTemplateOwner' as const,
    }

    expect(appliedLocalEffectAcknowledgesSettingDraft({ ...input, localEffect: splitPresetEffect() })).toBe(false)
    expect(
      appliedLocalEffectAcknowledgesSettingDraft({
        ...input,
        localEffect: splitPresetEffect({ ownerProjectionApplied: true }),
      }),
    ).toBe(true)
  })
})
