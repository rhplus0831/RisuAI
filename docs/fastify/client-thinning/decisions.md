# Decisions

Date: 2026-05-28

The recorded decision and rationale for each exit criterion, settled in a
working Q&A over the open findings. This is the "why" record; the contract is in
[`README.md`](./README.md) and the work breakdown in
[`closeout-buckets.md`](./closeout-buckets.md). Findings and evidence are in
[`open-findings.md`](./open-findings.md).

## EC1 — Provider ownership {#ec1}

**Decision:** Option A — server-owned generation + hard-blocked browser fallback.
Additionally **remove the `useServerGeneration` toggle** (treat it as const-true
in Fastify mode). Unsupported provider formats return an explicit "not supported
in server mode" error rather than silently dispatching with masked placeholders.
The Vertex token refresh moves server-side. Masking stays.

**Why:** Masking provider secrets is only honest if no browser path needs them.
Today server generation is *opt-in* (`useServerGeneration` defaults false) and
*partial* — many proxy/`xcustom` formats are already server-routed, but
non-server-routable formats (notably Gemini `reverse_proxy`/`xcustom`) and
preview bodies fall back to the browser, so masked secrets break those flows. Of the three reconciliations —
(A) server-own + block, (B) stop masking, (C) per-key scoped masking — only A
keeps the stated security invariant; B abandons it and C is the most error-prone.
Removing the toggle removes the whole class: there is no "browser generation" mode
to leave reachable. Server Vertex routing already exists
(`server/fastify/src/generation/vertexAuth.ts`), so this is removal of the browser
fallback + client token write, not new server work. Unsupported-format errors
turn a silent security hole into an explicit burn-down list.

## EC2 — Plugin durable storage {#ec2}

**Decision:** Default = Option B. Durable plugin storage stays the
already-server-backed `risuai.pluginStorage`; the three *device-local* sandbox
APIs — sync `localStorage` (`SafeLocalStorage`), IndexedDB (`SafeIdbFactory`), and
the local async `getLocalPluginStorage()`/`SafeLocalPluginStorage` — are disabled
in Fastify mode. Add an opt-in **Plugin Compatibility Mode**:

- **Account-wide**, and a **command-backed** server setting (not a browser-local
  flag — a local flag controlling whether browser-local storage is allowed would
  be self-undermining; account-wide also fits the projection model).
- When on, restores those **three device-local APIs**. `risuai.pluginStorage`
  stays server-backed and toggle-independent (durable plugin storage never moves
  off the server).
- Relaxes storage **location only, never resource ownership**: the
  `unsupportedServerBridgeKeys` guard, the `pluginV2` fix, and reserved-key
  shadowing protection stay enforced in both states. Compatibility Mode must never
  be a back door to write server-owned DB resources locally.
- UI: under Advanced Settings → "not recommended", warning that the data is
  device-local, unsynced, and **excluded from server backup/export**.

**Why:** A safe, honest default with an explicit, discouraged escape hatch beats
either silently breaking plugins (pure B) or silently weakening the invariant
(pure C). The server-backed durable path (`risuai.pluginStorage`) already exists,
so the remaining surfaces are *explicitly device-local* — including the local
async `getLocalPluginStorage()`, which the audit showed is distinct from
`risuai.pluginStorage`. Treating all three uniformly (off by default, restored
together by Compatibility Mode) keeps one escape hatch instead of special cases.
The audit also narrowed the scope: bulk/unknown-key persistence and write-time
reserved-key shadowing are already server-backed/blocked, so the remaining work is
those three sandbox APIs, `pluginV2`, read-time shadowing, and `saveMethod`
honesty.

## EC3 — Import current-shape {#ec3}

**Decision:** Option A — in the JSON import path, pass the **returned normalized
clone** from the already-exported `normalizeRisuSaveImportDatabase`
(`importSnapshot.ts:83`) to `applyImportedDatabase`; delete the narrow route-local
normalizer.

**Why:** The bug *is* a duplicate normalizer drifting out of sync — exactly the
"closed, then rediscovered" pattern in miniature. Unifying on one normalizer
removes the entire class. The JSON whole-db path is **test-only** (no production
browser caller), so A has zero production behavior change; it just makes test
seeds realistic. (Optional defense-in-depth: also gate the JSON body out of
production — not load-bearing once unified.)

## EC4 — Stable-id validation + prompt items {#ec4}

**Decision:**

- **4a — split helpers (i):** each id helper splits into `repairX` (import only,
  may mint ids) and `validateX` (command path, rejects missing/duplicate). Create
  commands also require a client-supplied id (no server-side minting). Not a
  shared helper with an `allowRepair` flag.
- **4b — subtractive (i):** remove `promptTemplate` from the prompt-settings
  command; the existing `/prompt-items/*` CRUD/reorder commands are the only
  editing path.

**Why (4a):** EC7's audit candidate is literally "no command-path helper calls
`randomUUID()`." That audit only works if the command validators *never* call it —
which the split guarantees and a boolean flag defeats. A shared-helper-with-a-flag
is also how repair leaked into commands in the first place. The audit narrowed
the message case: duplicate ids are already rejected, so only the missing-`chatId`
generation needs removing. Per the audit this also covers **create**: create
commands require a client-supplied id and reject missing (consistent with the
optimistic-projection model, where the client assigns the id), so prompt-item
create (`prompts.ts:64`) is in scope and EC7's no-mint rule needs no create
exemption.

**Why (4b):** `promptTemplate` is an id-bearing child array (like lorebook
entries), not a scalar setting — editing it through the scalar settings patch is a
category error that bypasses per-item id validation. Per-item CRUD/reorder
commands and events **already exist** and the UI already uses them, and preset
switch already carries `promptTemplate` server-side via `applyPreset`. So the fix
is *subtractive* (remove the redundant settings path), which is lower-effort than
it first appeared and reduces code debt. The one raw client use — the enable
toggle `{ promptTemplate: [] }` — routes through a command instead.

## EC5 — Single active writer {#ec5}

**Decision:** A **session-based single-writer lock**, not a conflict-resolution
page. Port the `Risuai-NodeOnly` reference commit
`1c1d7bc6dc0bbe8e176730dd6b6b894ea1d8033b` to Fastify: mint a per-page-load
session id; register the active writer on **bootstrap/page-load** (last-loader
wins); reject non-active sessions with **423** on every server-owned mutating
route (commands, import, assets, backups, legacy storage); the client **reacts on
423** by notifying and reloading. Still remove the blind 409 replay as
a backstop. Conflict-resolution page and retry-safety classification are dropped.

**Why:** This app was not designed for multi-device use; a 409 almost always means
a stale tab left open on another device (typically a phone), and the user is
usually aware of the mistake. That makes conflicts rare and self-inflicted — so
*prevent* the write at the source rather than build machinery to *resolve* it
after. The lock collapses the whole problem: no "overwrite vs reload" UX, no
rebase, and crucially no retry-safety classification (the hardest part of EC7 for
this finding). It also loses no durable data: only the stale device's
un-persisted local edits are dropped on reload, and those were made after the user
moved on. "Overwrite my changes" turned out to rarely be a clean semantic (a
replacement command resends a whole stale snapshot, discarding the other device's
work too; positional/delta commands can corrupt) — another reason prevention beats
resolution here.

Sub-choices: acquire the lock on **bootstrap/page-load** (cleaner; users already
treat the app as single-device — revisit with lazy-on-first-write if needed); and
**react-on-423** for v1 (proactive read-only via the `/api/v1/events` SSE stream
is a later upgrade).

## EC6 — Character asset validation {#ec6}

**Decision:** Extend `validateCharacterAssetRefs` to cover `vits.files.*` (iterate
the dynamic map) and `gptSoVitsConfig.ref_audio_data.assetId`, reusing the existing
optional-asset-ref validators; reject-on-missing.

**Why:** Mechanical — no fork. The validator is already shared by create and patch,
so the additive fields cover both. Field correction from the audit: the server
asset field is `ref_audio_data.assetId`, not `ref_audio_path`. EC6 stays scoped to
the character audio refs; the broader walker-vs-validator drift class (e.g.
`characterOrder.img` vs `imgFile` — `assetReferences.ts:69` / `characters.ts:215`)
is left to EC7's audit rather than broadened here.

## EC7 — Repeatable audit {#ec7}

**Decision:** A ts-morph/rg audit script that re-checks the invariants, updated to
reflect the decisions above: assert no mutation route bypasses the active-session
check (EC5), no command-path helper mints ids (EC4), no resource has both a typed
command and a generic-settings channel (EC4), sandbox storage APIs are gated with
Compatibility Mode off (EC2), and every asset-walker field has a validator (EC6).
The retry-safety classification originally planned for EC5 is removed.

**Why:** The standing audit is what stops the close/reopen cycle — a future
"complete" claim must be checkable, not re-derived by hand. `pnpm check` can pass
while the contract is wrong, so the structural checks are the real gate.
