# Audit scope: UI state & persistence feedback

Status: DRAFT 2026-07-23 — items tagged `UNVERIFIED` are being re-checked by
the data-loss residual verification pass.

## Charter

**In scope:** rendered-state divergence (DOM disagrees with a correct store),
persistence-outcome surfacing (success shown for writes that failed or only
queued), save feedback (icon/status/alerts), input editability during saves,
and stale-state after reconciles/refreshes.

**Out of scope:** whether the underlying command persisted correctly (other
scopes) — this scope is about what the *user is told*.

## Issue history

The most heavily audited scope: four UI issue-audit rounds (2026-07, 109+
finding slugs, round 4 alone = 50 findings) plus the 2026-06-13 behavioral
(DOM-oracle) audit. **Everything found was fixed** — rounds 1–3 docs are in
`.archived-docs/ui-issues/`, round 4's ~55 fix commits each deleted their doc.
The 2026-07-22/23 save-feedback rework (`8bd282ae4`, `0dfa54c87`,
`3728368ff`, `22c683fe6`, `3006a77c6`) then established the current policy.

**The six recurring root-cause patterns from round 4 — this is the audit
checklist for any new UI code:**

1. `undefined`-as-deletion dropped by patch sanitizers (character pipeline has
   no delete sentinel; modules solved it with a null sentinel in
   `MODULE_PATCH_DELETABLE_KEYS`).
2. Outcome promises dropped by void wrappers — dispatch treated as success.
3. `'discarded'` replay settlements treated as convergence.
4. Error slots nulled by follow-up reconcile refreshes.
5. Whole-object patches over records carrying unrendered fields (destroys
   sibling data the form never displayed — e.g. the TTS API-key masking bug).
6. No SSE liveness watchdog + 409s never resync — since fixed in
   `5b0d2da81` (verified 2026-07-23); kept as a pattern example (owned by
   [sync-hydration.md](sync-hydration.md)).

## Open items

- `FIXED 2026-07-23` **E-7/E-8** — narrower than originally
  filed. Fixed since: the preset hotkey toasts only after an `accepted`
  settlement (`src/ts/hotkey.ts:550`, via `eafdd2bc6`), and the shared
  settings bridge now stages before debounce and centrally reports
  queued/failure outcomes (`src/ts/server/settingsBridge.svelte.ts:962`,
  `:1108`), so ordinary dispatch failures are loud even at outcome-blind
  call sites (e.g. `HotkeySettings.svelte:14`,
  `CustomColorSchemeEditor.svelte:28`, `DefaultChatScreen.svelte:2184`).
  The onboarding remainder is fixed (2026-07-23): language and API-key
  steps now await outcome-aware durable receipts, advance on `accepted` or
  locally staged `queued`, retain queued settlement feedback, and fence stale
  or unmounted attempts (`src/lib/Others/WelcomeRisu.svelte`).
- `PARTIAL / VERIFIED 2026-07-23` **E-5** — composer drafts live in an
  in-memory Map (`DefaultChatScreen.composerDrafts.ts:11`), message edits in
  transient component state (`Chat.svelte:1870`, `:374`), module edits in
  `tempModule`/`draftOnly` until explicit Save (`ModuleSettings.svelte:71`,
  `:400`): all reload-lost. Exception: lorebook drafts ARE durable
  (`applyLorebookEntryDraftEdit` queues a replacement,
  `LoreBookList.svelte:313` → `lorebookBridge.svelte.ts:687`).
- `ACCEPTED` — greeting/`historytrans` rendering gap lives in
  [translation.md](translation.md).

## Verified safe — do not re-audit

All 109+ fixed finding slugs from rounds 1–4 (slugs embedded in
`.archived-docs/ui-issues/` and round-4 fix commits); the behavioral audit's
19 candidates (1 confirmed, fixed). Typing surfaces latency-probed clean
2026-07-22: CharConfig all tabs, sidebar toggles, translator preset steps,
author's note, lorebook editor.

## Policy and invariants for new code

- **Save feedback rule:** in-flight/queued → saving icon only (driven by
  `persistenceActivity.svelte.ts`); failure → inline `role="alert"` rows +
  `alertError`. Do not add per-control transient "Saving/Queued" status rows.
- **Text fields stay editable during saves**; discrete controls may keep
  their locks; drawer-form fieldset locks during explicit Save are
  intentional.
- `contenteditable` does **not** inherit `fieldset[disabled]` — components
  must honor it explicitly (highlight-mode TextAreaInput lesson).
- Latch the interaction target synchronously at click time before any
  upstream `await` (confirm dialog, hydration) — `captureMessageEditorTarget`
  pattern.
- Svelte 5 props are lazy: test stubs must READ the props whose evaluation
  you are probing, or unguarded parent expressions never run.

## Audit method that worked (reusable)

Round 4: ~10 scoped finder agents, each given an architecture primer, the six
maintainer symptom classes, all known finding slugs (prevents re-filing), and
orders to trace UI→client→request→server→ack→UI and check fences before
claiming races. Load-bearing claims spot-verified by hand (17/17 confirmed).
For typing surfaces: the Playwright latency probe (600–700 ms delayed
mutations + MutationObserver on disabled/readonly attributes + focusout
tracker; caret at end before typing; ASCII doesn't exercise IME).

## Sources

Memory: `uiux-issue-audit-round4-2026-07-18`, `uiux-behavioral-audit-2026-06-13`,
`save-pending-disable-pattern-inventory`, `data-loss-audit-2026-07-21`
(E-7/E-8/E-5). Archive: `.archived-docs/ui-and-user-input/`.
