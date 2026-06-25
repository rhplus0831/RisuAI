// Reusable state-vs-DOM differential oracle for rendered-state divergence: a
// user-driven transition leaves the painted DOM disagreeing with a correct store
// value. The store is only ever the differential oracle, never the success
// oracle.
//
// Tier 1 (happy-dom) and Tier 2 (Playwright) share one classifier; only the
// readers differ (querySelector vs page.locator). This module is intentionally
// free of vitest/svelte/playwright imports so both tiers can import it.

export type DifferentialVerdict =
  // DOM agrees with the store value that should back it. No bug.
  | 'dom-matches-store'
  // DOM disagrees with the store, and the store is correct. The painted result
  // never caught up to a correct value: an in-scope reactivity/binding bug.
  | 'reactivity-binding-bug'
  // DOM disagrees with the store, and the store itself is wrong. A logic/value
  // bug. Out of scope for this audit; route to the static-test track.
  | 'logic-bug'

export interface DifferentialInput<T> {
  // What actually rendered (read from a data-risu-* attribute, textContent,
  // aria-*, or row presence).
  dom: T
  // The store value that should back the DOM at the failing assertion. Tier 1:
  // a projection helper such as resolveActiveChatGenerationSettings(). Tier 2:
  // getDatabaseSnapshot() off the browser smoke hook.
  store: T
  // What a correct render would show. Authored by the test from the seeded
  // fixture; this is what makes the verdict objective without a human oracle.
  expected: T
  equals?: (a: T, b: T) => boolean
}

export function classifyDifferential<T>(input: DifferentialInput<T>): DifferentialVerdict {
  const equals = input.equals ?? defaultEquals
  if (equals(input.dom, input.store)) return 'dom-matches-store'
  return equals(input.store, input.expected) ? 'reactivity-binding-bug' : 'logic-bug'
}

// True only for the one verdict this audit reports as a finding: the DOM failed
// to reflect a correct store value.
export function isInScopeFinding(verdict: DifferentialVerdict): boolean {
  return verdict === 'reactivity-binding-bug'
}

export function describeDifferential<T>(input: DifferentialInput<T>): string {
  const verdict = classifyDifferential(input)
  return [
    `verdict=${verdict}`,
    `dom=${stringify(input.dom)}`,
    `store=${stringify(input.store)}`,
    `expected=${stringify(input.expected)}`,
  ].join(' ')
}

function defaultEquals<T>(a: T, b: T): boolean {
  if (a === b) return true
  return stringify(a) === stringify(b)
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// ---------------------------------------------------------------------------
// Tier 1 (happy-dom) DOM readers. These take a ParentNode (a mounted target or
// any subtree) and read the same data-risu-* anchors the components already
// expose. Returning `null` for "not rendered" lets a test distinguish a missing
// surface from an empty value.
// ---------------------------------------------------------------------------

export type PickerKind = 'preset' | 'persona'

export function readGenerationPickerSelectedId(root: ParentNode, kind: PickerKind): string | null {
  const control = root.querySelector(`[data-risu-generation-picker-control][data-risu-picker-kind="${kind}"]`)
  if (!control) return null
  return control.getAttribute('data-risu-picker-selected-id') ?? ''
}

export function readGenerationPickerName(root: ParentNode, kind: PickerKind): string | null {
  const control = root.querySelector(`[data-risu-generation-picker-control][data-risu-picker-kind="${kind}"]`)
  return control ? (control.textContent ?? '').trim() : null
}

export function readToggleGroupLabels(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('[data-risu-generation-toggle-group]')).map(
    (group) => group.getAttribute('data-risu-toggle-label') ?? '',
  )
}

// A toggle control's painted boolean: data-risu-selected is the rendered
// checkbox state, independent of the backing store.
export function readToggleSelected(root: ParentNode, key: string): boolean | null {
  const control = root.querySelector(`[data-risu-generation-toggle-control][data-risu-toggle-key="${key}"]`)
  if (!control) return null
  return control.getAttribute('data-risu-selected') === 'true'
}

export function readJailbreakSelected(root: ParentNode): boolean | null {
  const control = root.querySelector('[data-risu-generation-jailbreak-control]')
  if (!control) return null
  return control.getAttribute('data-risu-selected') === 'true'
}

// Sidebar chat rows: the painted selected row and the rendered row order. Used
// by the chat-lifecycle journeys.
export function readSelectedChatRowId(root: ParentNode): string | null {
  const rows = Array.from(root.querySelectorAll('button[data-risu-chat-idx][data-risu-chat-id]'))
  const selected = rows.find((row) => row.getAttribute('data-risu-chat-selected') === 'true')
  return selected ? (selected.getAttribute('data-risu-chat-id') ?? '') : null
}

export function readChatRowIds(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('button[data-risu-chat-idx][data-risu-chat-id]')).map(
    (row) => row.getAttribute('data-risu-chat-id') ?? '',
  )
}
