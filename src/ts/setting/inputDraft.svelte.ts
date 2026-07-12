import { untrack } from 'svelte'
import { getServerResourceApplyEpoch } from '../server/resourceWriteGuard.svelte'
import type { SettingContext, SettingItem } from './types'
import {
  UNINITIALIZED,
  getSettingValue,
  getSettingWriteOwnerKey,
  reassertSettingValue,
  setDeferredSettingValue,
} from './utils'

export interface SettingInputDraft<T> {
  value: T
}

export interface SettingInputDraftOptions {
  delayMs?: number
}

/**
 * Local state for continuous SettingRenderer controls. A dirty draft survives
 * authoritative projections until that same owner/root projects the draft
 * back, while ordinary external changes still update an idle control.
 */
export function createSettingInputDraft<T>(
  getItem: () => SettingItem,
  getContext: () => SettingContext,
  options: SettingInputDraftOptions = {},
): SettingInputDraft<T> {
  const initialValue = untrack(() => getSettingValue(getItem(), getContext())) as T
  const draft = $state<SettingInputDraft<T>>({ value: cloneJsonValue(initialValue) })
  let initialized = false
  let dirty = false
  let suppressDraftDispatch = false
  let previousDraftDispatchSnapshot = snapshotJson(initialValue)
  let previousServerSnapshot = snapshotJson(initialValue)
  let previousOwnerKey = untrack(() => getSettingWriteOwnerKey(getItem(), getContext()))
  let previousResourceApplyEpoch = getServerResourceApplyEpoch()
  let dirtyResourceEpoch: number | null = null

  $effect(() => {
    const item = getItem()
    const context = getContext()
    const ownerKey = getSettingWriteOwnerKey(item, context)
    const resourceApplyEpoch = getServerResourceApplyEpoch()
    const resourceApplyChanged = resourceApplyEpoch !== previousResourceApplyEpoch
    const ownerChanged = ownerKey !== previousOwnerKey
    const serverValue = getSettingValue(item, context) as T
    const serverSnapshot = snapshotJson(serverValue)
    const draftSnapshot = snapshotJson(draft.value)

    if (ownerChanged) {
      dirty = false
      dirtyResourceEpoch = null
      if (serverSnapshot !== draftSnapshot) replaceDraftValue(serverValue)
    } else if (serverSnapshot === draftSnapshot) {
      // A projection carrying the draft is authoritative confirmation. A
      // non-projection match is the optimistic local/preset mirror catching up.
      if (resourceApplyChanged && dirty) dirty = false
      dirtyResourceEpoch = null
    } else if (resourceApplyChanged && dirty) {
      dirtyResourceEpoch = resourceApplyEpoch
      untrack(() => reassertSettingValue(item, draft.value, context))
    } else if (dirty && dirtyResourceEpoch === resourceApplyEpoch) {
      // Some effective values live in a selected preset row. Reasserting their
      // DB fallback does not change that getter, so keep the control draft until
      // the preset mirror or a newer projection settles it.
    } else if (serverSnapshot !== previousServerSnapshot) {
      dirty = false
      dirtyResourceEpoch = null
      replaceDraftValue(serverValue)
    }

    previousOwnerKey = ownerKey
    previousResourceApplyEpoch = resourceApplyEpoch
    previousServerSnapshot = serverSnapshot
  })

  $effect(() => {
    const value = draft.value
    const snapshot = snapshotJson(value)
    if (!initialized) {
      initialized = true
      previousDraftDispatchSnapshot = snapshot
      return
    }
    if (suppressDraftDispatch) {
      previousDraftDispatchSnapshot = snapshot
      return
    }
    if (snapshot === previousDraftDispatchSnapshot || value === (UNINITIALIZED as T)) return
    previousDraftDispatchSnapshot = snapshot

    untrack(() => {
      const item = getItem()
      const context = getContext()
      if (snapshotJson(getSettingValue(item, context)) === snapshot) return
      const result = setDeferredSettingValue(item, cloneJsonValue(value), context, options)
      dirty = result.queued
      previousOwnerKey = result.ownerKey
      previousServerSnapshot = snapshotJson(getSettingValue(item, context))
    })
  })

  return draft

  function replaceDraftValue(value: T): void {
    const snapshot = snapshotJson(value)
    suppressDraftDispatch = true
    previousDraftDispatchSnapshot = snapshot
    draft.value = cloneJsonValue(value)
    queueMicrotask(() => {
      suppressDraftDispatch = false
    })
  }
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
