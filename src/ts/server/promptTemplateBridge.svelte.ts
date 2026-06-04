import type { PromptItem } from '../process/prompt'
import { DBState } from '../stores.svelte'
import { peekCachedServerCommandRevision } from './commands'
import { withTrustedServerProjectionWrite } from './projectionWriteGuard.svelte'

/**
 * Prompt-template editor projection helpers (Phase 5 deep-clone narrowing).
 *
 * The prompt-template editor keeps a local `promptTemplate` draft and mirrors
 * edits into the read-only server projection (`DBState.db.promptTemplate`). The
 * audit found two per-keystroke costs:
 *
 * - the optimistic projection write cloned the WHOLE `promptTemplate` array on
 *   every keystroke (High), and
 * - the change-detection `$effect` ran two whole-template `JSON.stringify`
 *   passes on every reactive fire (Medium).
 *
 * These helpers narrow both: a keystroke writes only the edited item in place,
 * and reconciliation is gated by the cached server command revision instead of a
 * per-fire whole-template stringify diff. They are intentionally independent of
 * the component so the clone-cost regression can exercise them directly.
 */

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

/**
 * Mirror one edited prompt item into the read-only projection in place, without
 * cloning the whole `promptTemplate` array. Returns the cloned item that was
 * written (use it as the server patch / rollback "attempted" baseline), or
 * `null` when the item is no longer in the draft.
 *
 * Falls back to a full-array sync only when the projection has no row with this
 * id yet (rare: the projection has drifted from the draft); that path is still
 * correct, just not narrowed.
 */
export function applyPromptItemProjectionWrite(
  draftItems: PromptItem[],
  itemId: string,
): PromptItem | null {
  const draftItem = (draftItems ?? []).find((item) => item.id === itemId)
  if (!draftItem) return null
  const snapshot = cloneJsonValue(draftItem)
  withTrustedServerProjectionWrite(() => {
    const template = DBState.db.promptTemplate
    if (!Array.isArray(template)) {
      DBState.db.promptTemplate = cloneJsonValue(draftItems)
      return
    }
    const index = template.findIndex((item) => item.id === itemId)
    if (index === -1) {
      DBState.db.promptTemplate = cloneJsonValue(draftItems)
      return
    }
    template[index] = snapshot
  })
  return snapshot
}

/**
 * Restore a single prompt item in the projection in place (failed-command
 * rollback), leaving every other item untouched. The former rollback re-cloned
 * the whole `promptTemplate` array.
 */
export function restorePromptItemProjectionWrite(itemId: string, previousItem: PromptItem): void {
  withTrustedServerProjectionWrite(() => {
    const template = DBState.db.promptTemplate
    if (!Array.isArray(template)) return
    const index = template.findIndex((item) => item.id === itemId)
    if (index !== -1) template[index] = cloneJsonValue(previousItem)
  })
}

export interface PromptTemplateReconcileResult {
  /** The cached command revision observed on this pass (store it as the next baseline). */
  revision: number | null
  /** A fresh draft value to adopt, or `null` when no reconcile is needed. */
  nextDraft: PromptItem[] | null
}

/**
 * Decide whether the prompt-template draft should be re-pulled from the server
 * projection. The cached command revision is the discriminator: a keystroke's
 * optimistic write never advances it, so reconciliation only runs after a real
 * server push / command response. The whole-template stringify only happens on
 * such a revision advance, never per keystroke.
 *
 * Reads `DBState.db.promptTemplate` first so a caller `$effect` registers the
 * projection dependency (`DBState.db` is reassigned on every guarded write /
 * projection apply) and re-runs on a server push.
 */
export function reconcilePromptTemplateDraft(
  draftItems: PromptItem[],
  previousRevision: number | null,
): PromptTemplateReconcileResult {
  const serverValue = (DBState.db.promptTemplate ?? []) as PromptItem[]
  const revision = peekCachedServerCommandRevision()
  if (revision === previousRevision) return { revision, nextDraft: null }
  if (snapshotJson(serverValue) === snapshotJson(draftItems ?? [])) {
    return { revision, nextDraft: null }
  }
  return { revision, nextDraft: cloneJsonValue(serverValue) }
}
