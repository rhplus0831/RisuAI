/**
 * Custom MIME types used to keep in-app drag surfaces isolated from each
 * other and from the app-level file importer.
 */

/** Blocks in-app element drags from the file-import path. */
export const RISU_APP_INTERNAL_DRAG_TYPE = 'application/x-risu-app-internal-drag'

/** TriggerV2 effect reorder. */
export const RISU_EFFECT_DRAG_TYPE = 'application/x-risu-effect-drag'

/** Model profile and divider reorder. */
export const RISU_MODEL_PROFILE_DRAG_TYPE = 'application/x-risu-model-profile-drag'

/** Model/prompt preset reorder. */
export const RISU_PRESET_DRAG_TYPE = 'application/x-risu-preset-drag'

/** Prompt template reorder. */
export const RISU_PROMPT_DRAG_TYPE = 'application/x-risu-prompt-drag'

/** Sidebar character/folder reorder; also checked by the app shell and hotkeys. */
export const RISU_SIDEBAR_DRAG_TYPE = 'application/x-risu-sidebar-drag'

/** TriggerV2 trigger reorder. */
export const RISU_TRIGGER_DRAG_TYPE = 'application/x-risu-trigger-drag'

export function hasDragType(types: ArrayLike<string> | null | undefined, expectedType: string): boolean {
  if (!types) return false

  for (let index = 0; index < types.length; index += 1) {
    if (types[index] === expectedType) return true
  }
  return false
}
