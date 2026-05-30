# Lazy-Projection Handover

Date: 2026-05-30 · Branch: `fastify` · Plan: [`docs/lazy-projection/`](docs/lazy-projection/)

Session handover for the **lazy-projection** workstream. **Phases 1–4, 6a, 6b are
fully done**, and **6c landed server-side** ("don't lose a rerolled result"). Two
pieces remain, both now committed to under **Option C** (each backed by a unit
invariant **and** a real-browser E2E test):

- **A — full 6c swipe-persistence** (client side): reconstruct the reroll swipe
  buffer from the persisted `alternates` so rerolled candidates survive a reload,
  not just disconnect. The server half already stores + ships them.
- **B — Phase 5 lorebook stub**: stub `globalLore` + disabled-module `lorebook`;
  rework `lorebookBridge` with a hard no-data-loss invariant; hydrate on open.

The codebase is the source of truth. Line numbers drift; the **symbol names** are
the stable handle — `rg` for the symbol before acting.

Baselines (green at HEAD `79fca3e5`): `pnpm api:test` = **1384**,
`pnpm test` = **992** (+4 skipped), `pnpm client-thinning:audit` = pass,
`pnpm smoke:fastify-browser` = pass (build ≈18s + 1 E2E). SQLite schema is at
**v6** (`CURRENT_SCHEMA_VERSION`, `server/fastify/src/db.ts`).

**Hard rule (memory `fastify-no-users-no-interim-compat`):** no interim /
back-compat / demo states. Each slice is a coherent, fully-working unit that
leaves all suites green — land related steps together. The maintainer validates
in the real app before shipping (this is a personal, not-yet-released port).

---

## Status

| Phase | State | Commit(s) | Delivers |
| ----- | ----- | --------- | -------- |
| 1 Asset GC → server | ✅ | `f6657d49` | server-side asset GC. |
| 2 Surgical inbound sync | ✅ | `36c5f39a` | revision echo-skip + targeted `GET /projection/:resource`. |
| 3 Unify generation persistence | ✅ | `24f25b91` | server owns all result writes. |
| 7 Browser auto-reattach | ✅ | `6aabc4e9` | reattach to in-flight generations. |
| **4.1–4.4** messages + hypaV3Data → SQLite, stub bootstrap + hydrate-on-open | ✅ | `b27c0b9e`…`5000be42` | `messages` / `chat_hypa_v3` tables; surgical writes; stub projection + per-chat hydration; adversarially reviewed twice. |
| **6 (a)** remove auto-continue | ✅ | `5b751fcb` | deleted the off-by-default feature + settings + i18n + recursion. |
| **6 (b)** durable continue/regenerate | ✅ | `d48bff23`, `b145ed72` | widened `resolveDurableGeneration` + the durable job to `send\|continue\|regenerate` (shared `resolvePostGenerationResult`/`buildRawModeMessage`); mode-aware reattach (job carries `mode` on `activeGenerationJobs`). Adversarially reviewed (one reattach finding, fixed `b145ed72`). |
| **6 (c) server** reroll buffer | ✅ | `79fca3e5` | "don't lose a rerolled result": regenerate preserves the displaced candidate as a flagged `alternate` row (v6 migration, negative `seq`), cleared on send/continue; shipped on the `chatMessages` hydration wire. Adversarial review: 0 findings. |
| **A — 6 (c) client** swipe-persistence | ⏳ TODO | — | reconstruct the swipe buffer from `alternates` so rerolls survive reload; lazy-persist swaps. Unit (extracted module) + E2E. |
| **B — Phase 5** Lorebooks stub | ⏳ TODO | — | stub `globalLore` + disabled-module `lorebook`; rework `lorebookBridge` (no-data-loss invariant); hydrate on open. Unit (watcher harness) + E2E. |

Progress memory: `lazy-projection-phase6b-landed`, `lazy-projection-phase6c-landed`,
`lazy-projection-phase4-landed`, `lazy-projection-phases-1-2-3-7-landed`.

---

## Testing capability (read this — it reverses an earlier wrong assumption)

An earlier handover claimed the swipe/reroll UX and the lorebook watcher "cannot be
validated without the real app." **That is false.** Both a unit harness and a real
browser E2E run in this environment:

**Unit — reactive `.svelte.ts` modules are drivable.** A `*.svelte.test.ts` file is
compiled with runes. Keep `stores.svelte` **real** (do NOT mock it — `DBState` is a
`$state` rune, so deep mutations re-trigger `$effect`s) and mock only the command
layer. Drive effects with `flushSync()` (Svelte 5.55) and the 250 ms dispatch
debounce with `vi.useFakeTimers()` + `vi.advanceTimersByTime`. Use `vi.hoisted` for
spies (vitest hoists `vi.mock`). This was proven against `watchServerBackedLorebooks`:
a `globalLore` real→`[]` re-stub deterministically fires `runServerCommand` (the
data-loss path) — exactly the invariant Phase 5 must kill.

```
const { runServerCommand } = vi.hoisted(() => ({ runServerCommand: vi.fn(async () => ({ status: 'ok', revision: 1 })) }))
vi.mock('./commands', () => ({ canUseServerCommands: () => true, runServerCommand, /* builders: identity stubs */ }))
vi.mock('./projectionWriteGuard.svelte', () => ({ withTrustedServerProjectionWrite: (fn) => fn() }))
// real DBState; flushSync() after each mutation; vi.advanceTimersByTime(delay) to fire the debounce
```

**E2E — the real Fastify-served app runs in headless Chromium.**
`pnpm smoke:fastify-browser` (`playwright.fastify-smoke.config.ts` +
`server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts`) does
`buildsite` → boot real Fastify (`buildApp`, `staticRoot: dist`) → Chromium loads the
real client. Chromium is installed. The page exposes a `window.__RISU_FASTIFY_BROWSER_SMOKE__`
test bridge (`waitForLoaded`, `getDatabaseSnapshot`, `patchRuntimeSettings`,
`activeWriterHeaders`). Extend this spec (or add a sibling under `browser-smoke/`) to
drive the real swipe buttons / lorebook editor across a reload. **The bridge is wired
where `VITE_FASTIFY_BROWSER_SMOKE` is set** — grep `__RISU_FASTIFY_BROWSER_SMOKE__` to
find/extend it (you will likely add `sendChat` / `reroll` / open-character helpers).

**Adversarial review pattern** (used all session, keep using it on A and B): a
`Workflow` with per-dimension reviewers → per-finding default-refute verifiers →
synthesize confirmed. 6b surfaced + fixed one finding; 6c came back clean.

---

## Architecture in place (read before touching storage)

`data/db.json` holds chat **metadata only** — no `message[]`, no `hypaV3Data`. Those
two unbounded per-chat blobs live in SQLite (`data/risu.db`):

- **`messages` table** — PK `(chat_id, seq)`, `uid` (the per-message id, the
  `Message.chatId` misnomer), `json` (lossless source of truth), and **`alternate`**
  (6c: 0 = active transcript row; 1 = a preserved reroll candidate with a NEGATIVE
  `seq` so the PK never collides and the active diff never touches it). Every active
  query filters `alternate = 0`; the reroll buffer is read/cleared via the dedicated
  `*AlternateMessage(s)` ops. `server/fastify/src/messageStore.ts`.
- **`chat_hypa_v3` table** — `chat_id` PK, `json`.

`server/fastify/src/repository.ts` is the boundary: `loadPersisted`/`writePersisted`
(message-free db.json), `loadPersistedWithMessages` (hydrated join — active messages
only), `loadStubProjection` (wire stubs), `splitChatMessagesIntoTable`,
`syncChatMessages` (surgical per-chat active diff), `ensureMessagesExtracted`,
`loadChatHydration` (one chat's `{ message, hypaV3Data, alternates }`).

Write atomicity: the mutation engine (`commands/mutations.ts`) writes the SQLite rows +
revision bump inside `BEGIN IMMEDIATE`, then db.json **after** COMMIT (db.json can only
lag, never lead, on a crash). 6c added an optional in-transaction `sqlite(db)` hook on
`applyJsonCommandMutation` for the alternate-row writes (atomic with the message sync).

Client hydration: `src/ts/server/chatMessageHydration.svelte.ts` hydrates the active
chat on open (reactive `$effect`), re-hydrates after a full re-apply / `characters`
event-merge (`resetChatHydration()`), and exposes `ensureAllChatsHydrated` for bulk
readers. Merge: `hydrateServerChatMessages` (`storage/database.svelte.ts`). The
`chatMessages` projection response now also carries `alternates` — the **client
currently ignores it** (the consumer is task A).

---

## A — Phase 6c client swipe-persistence (do first; finishes Phase 6)

**Goal:** a rerolled candidate survives a *reload*, not just a disconnect. The server
already preserves displaced candidates as `alternate` rows and ships them on
`GET /projection/chatMessages?id=` as `alternates`. The remaining work is purely
client: feed those into the swipe buffer so the user can still swipe back to them
after reloading.

State of play:
- Swipe nav lives in `src/lib/ChatScreens/DefaultChatScreen.svelte`: `reroll()`
  (≈:283) / `unReroll()` (≈:377), over component-local `rerolls: Message[][]`,
  `rerollid`, `lastCharId` (≈:92-94). These are **non-exported closures** — not
  unit-testable in place. The prefetch buffer is `src/ts/process/prereroll.ts`
  (`addRerolls`/`Prereroll`/`PreUnreroll`), wired in `postGeneration/orchestrateResponse.ts`.

Steps:
1. **Extract** the swipe state machine out of the component into a testable
   `.svelte.ts` module (e.g. `src/ts/process/rerollNavigation.svelte.ts`) holding
   `rerolls`/`rerollid` + `reroll`/`unReroll`, with explicit inputs (current chat,
   dispatch callbacks) — a **behavior-preserving** extraction (the E2E test in step 4
   is the safety net). Re-wire `DefaultChatScreen.svelte` to call it.
2. **Hydrate the buffer**: on chat-open / projection refresh, seed `rerolls` from the
   persisted `alternates` (extend the `chatMessages` client parse in
   `src/ts/server/projection.ts::fetchServerChatMessages` — it currently drops
   `alternates` — and merge in `chatMessageHydration.svelte.ts`). Keyed by the active
   tail's `generationInfo.generationId` (what `reroll()`/`prereroll` already key on).
3. **Lazy-persist swaps**: a swipe changes the active tail; persist it on the next
   durable action (decision in `reference/durable-generation-modes.md`). The active
   tail is already durable for free; do not add an active-index column.
4. **Tests:** unit the extracted module (flushSync harness); **E2E** in `browser-smoke`:
   send → reroll (echo provider) → swipe-back → **reload** → assert the prior
   candidate is recoverable. Adversarial review.

Caution: the buffer's clear-on-send/continue is **server-side** (6c) — keep the client
in sync (don't resurrect a cleared buffer from a stale `alternates` snapshot; reconcile
on the revision).

## B — Phase 5: Lorebooks stub (HIGH RISK — data loss; unit-invariant first)

Stub character `globalLore` + **disabled**-module `lorebook` in the projection;
hydrate on character/module open; **enabled** modules stay resident (synchronous CBS
`{{lorebook}}` at `src/ts/cbs.ts:353` reads `achara.globalLore` for the selected char;
`getModuleLorebooks()`/`getModuleRegexScripts()` iterate `db.enabledModules` during
synchronous render — `src/ts/process/modules.ts`). Group chat is removed, so the CBS
read is almost always the selected (hydrated) char — confirm no live path passes a
non-hydrated one.

**The data-loss hazard is the phase.** `src/ts/server/lorebookBridge.svelte.ts` runs a
reactive snapshot/diff (`watchServerBackedLorebooks` → `collectLorebookCollectionSnapshots`
→ `dispatchWatchedReplacement`) that **auto-persists** any lorebook change. If it ever
diffs a hydrated→stubbed (`[real]`→`[]`) transition it persists the deletion and
**loses the real entries**. The rework must:
- **(invariant, test first)** NEVER persist a stubbed / not-yet-hydrated entity. Track
  a hydrated-entity registry; `collectLorebookCollectionSnapshots` skips non-hydrated
  entities and `dispatchWatchedReplacement` hard-guards on it. Write the failing unit
  test FIRST (the harness above reproduces the deletion), then make it green.
- only operate per-entity on hydration (no full-corpus walk).
- split the integrity/normalization defaults: `src/ts/bootstrap.ts:373`
  `v.globalLore ??= []` would erase the stub marker — a stubbed entity must stay
  distinguishable from a genuinely-empty hydrated one (a hydrated registry sidesteps
  field-presence ambiguity).

Projection: bootstrap (`routes/bootstrap.ts` via `loadStubProjection`) strips
`globalLore` for non-open characters and `lorebook` for disabled modules. Hydration
reuses the Phase 2 targeted-fetch primitive + a nested merge like
`hydrateServerChatMessages`.

**Tests:** unit the no-data-loss invariant (watcher harness) + the per-entity hydrate
merge; **E2E** in `browser-smoke`: open character → `globalLore` hydrates → edit →
persists; trigger a re-stub → assert **no** deletion command fired. Adversarial review
(re-run; the data-loss dimension is the one that matters).

---

## Pointers

- Plan + decisions: [`docs/lazy-projection/plan.md`](docs/lazy-projection/plan.md),
  [`reference/decisions.md`](docs/lazy-projection/reference/decisions.md),
  [`reference/durable-generation-modes.md`](docs/lazy-projection/reference/durable-generation-modes.md),
  [`reference/stub-hydration.md`](docs/lazy-projection/reference/stub-hydration.md).
- Test commands: `pnpm api:test` (server), `pnpm test` (browser),
  `pnpm client-thinning:audit` (invariant gate), `pnpm smoke:fastify-browser`
  (real-browser E2E). `tsc --noEmit` on the server has pre-existing test-file type
  errors and is NOT the gate (vitest uses esbuild).
- Scope decision (2026-05-30): 6c was first scoped to server-side "don't lose a
  rerolled result" under the (wrong) belief the swipe UX couldn't be validated here;
  with E2E confirmed working, **Option C** restores the full swipe-persistence (A) and
  Phase 5 (B), each unit- **and** E2E-validated.
