import type { customscript } from '../storage/database.svelte'

export const REGEX_DISPLAY_ACTIVATION_DELAY_MS = 3_000

function displayRelevantScript(script: customscript): boolean {
  return script.type === 'editdisplay' || script.type === 'edittrans'
}

/**
 * Only fields that can change rendered chat output belong in this signature.
 * Names and stable IDs are persistence metadata and must not trigger a reparse.
 */
export function regexDisplayDefinitionSignature(scripts: readonly customscript[] | null | undefined): string {
  return JSON.stringify(
    (scripts ?? []).filter(displayRelevantScript).map((script) => ({
      type: script.type,
      in: script.in,
      out: script.out,
      flag: script.flag ?? '',
      ableFlag: Boolean(script.ableFlag),
    })),
  )
}

/**
 * Tracks continued editor activity after a display change is already pending.
 * This keeps the expensive activation from firing while the user moves between
 * fields in the same editor.
 */
export function regexEditorActivitySignature(scripts: readonly customscript[] | null | undefined): string {
  return JSON.stringify(scripts ?? [])
}
