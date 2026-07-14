# Latest Verification

Date: 2026-06-08

This is the maintained proof-command log for the v3 workstream. Update it
after each change to a narrowed or bounded path.

## Current State

- Plan state: closed and archived on 2026-06-08; Phase 0, Phase 1, Phase 2,
  Phase 3, Phase 4, Phase 5, Phase 6, Phase 7, Phase 8, and Phase 9 are
  complete; the v4-H2 Phase 4.5 hotfix is also complete. `H1`, `M1-M9`,
  `L1-L56`, and `K1-K4` are `DONE` in
  [`active-risk-analysis.md`](active-risk-analysis.md).
- Gate state: the v1 gate (`src/ts/__tests__/fixCompletenessGate.test.ts`)
  and the v2 gate (`fixCompletenessGateV2.test.ts`) remain live against their
  archives. The v3 gate (`fixCompletenessGateV3.test.ts`) is live against
  `.archived-docs/performance-and-stability/stability-audits/v3/`, with every scheduled
  v3 ID (`H1`, `M1-M9`, `L1-L56`, `K1-K4`) registered as `DONE`. All three
  gate commands are green in the Phase 9 closing proof below.
- Tree: Phase 8 implementation is committed through `2a1b84fe4`; the Phase 9
  closeout recorded the final proof, archived the plan, and repointed the v3
  gate. Phase 8 includes the v3 M7, L38-L55, and K4 runtime, tests, gate
  registrations, and active-risk status flips plus v4-L24 through v4-L29,
  v4-L31, v4-L35, v4-L36, and v4-L37 proof riders only. `v4-L30` remains
  Phase 5-owned, and `v4-L38` remains outside Phase 8 without a separate
  storage-persistence owner.

## Phase 9 Closing Proof (2026-06-08)

Run for
[`phases/slices/phase-9-verification-budgets/closing-proof.md`](phases/slices/phase-9-verification-budgets/closing-proof.md)
after the Phase 9 registry sweep and gate self-proof freeze. The registry
sweep, all-gates-green, closing-run, archive movement, and v3 gate repointing
exit criteria are satisfied.

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 3 files / 52 tests, exited 0. The command emitted the usual
  Vite/Svelte default-config notice.
- `pnpm test`: passed, 168 files / 1480 tests passed / 4 skipped
  (1484 total), exited 0. The command emitted the existing
  `ECONNREFUSED 127.0.0.1:3000` diagnostics from network-path tests plus the
  existing `src/lib/SideBars/LoreBook/LoreBookData.svelte`
  `state_referenced_locally` warning, but exited successfully.
- `pnpm api:test`: passed, 101 files / 1950 tests passed / 1 skipped
  (1951 total), exited 0. The run emitted normal Fastify request logs.
- `pnpm client-thinning:audit`: passed (`Client-thinning audit passed.`),
  exited 0.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors, exited 0.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors,
  exited 0.
- Skipped/failed items: no failed commands; only the expected skipped tests
  reported by the full client and API suites.

## Phase 8 Verification Refresh (2026-06-08)

Run after the Phase 8 implementation commits landed:
`72889afa9` (L38-L41), `b9f619e79` (L42), `92635146c` (v4-L24 through
v4-L29 proof rider), `014d60b5b` (M7/L43/L44 plus v4-L37 proof rider),
`7724a5fac` (L45-L48 plus v4-L35 proof rider), `3a92c05a7` (L49), and
`2a1b84fe4` (L50-L55/K4 plus I16/I17 and v4-L31/v4-L36 proof riders).

Phase 8 exit criteria are satisfied. `M7`, `L38-L55`, and `K4` are `DONE` in
the active-risk table and v3 gate. The translator, MCP, media, and plugin v4
amendments are recorded as Phase 8 proof riders only, not v3 `DONE` IDs:
translator cache/memo/fanout coverage for v4-L24 through v4-L29, abortable
imggen post-generation coverage for v4-L31, filesystem read/base64/search cap
coverage for v4-L35, inlay/model/proxy image decode cap coverage for v4-L36,
and plugin listener/observer cleanup coverage for v4-L37. `v4-L30` stays
Phase 5-owned, and `v4-L38` stays out of Phase 8. Inventory notes classify the
added translator/MCP/media/plugin cache, listener, timer, blob URL, audio
context, and debug-log sites as fixed or explicitly routed.

- `pnpm exec vitest run src/ts/process/triggers.clientBudget.test.ts src/ts/process/scriptings.test.ts src/ts/tokenizer.test.ts src/ts/translator/translator.html.test.ts src/ts/translator/translator.cache.test.ts src/ts/plugins/apiV3/factory.test.ts src/ts/plugins/apiV3/v3.svelte.test.ts src/ts/process/mcp/mcplib.test.ts src/ts/process/mcp/mcp.test.ts src/ts/process/mcp/filesystemclient.test.ts src/ts/process/files/multisend.test.ts src/ts/process/files/tests/inlays.test.ts src/ts/process/__tests__/runStage4.test.ts src/ts/process/__tests__/imggenStableDiff.test.ts src/ts/process/stableDiff.test.ts src/ts/process/tts.test.ts src/ts/process/processzip.test.ts src/ts/process/transformers.test.ts src/ts/process/dynamicutils/pdf.test.ts src/lib/Playground/PlaygroundSubtitle.test.ts`:
  passed, 20 files / 143 tests. The run used the repo-local
  `src/ts/process/__tests__/runStage4.test.ts` path instead of the obsolete
  `src/ts/process/postGeneration/runStage4.test.ts` path named in the slice
  validation list. The command emitted the usual Vite/Svelte default-config
  notice.
- `pnpm test`: passed, 168 files / 1480 tests passed / 4 skipped. The command
  emitted the existing `ECONNREFUSED 127.0.0.1:3000` diagnostics from
  network-path tests plus the existing
  `src/lib/SideBars/LoreBook/LoreBookData.svelte` `state_referenced_locally`
  warning, but exited successfully.
- `pnpm client-thinning:audit`: passed (`Client-thinning audit passed.`).
- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 1 file / 26 tests, exited 0. The command emitted the usual
  Vite/Svelte default-config notice.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `git diff --check`: clean before and after the docs refresh.
- Skipped/failed items: none.

## Phase 7 Verification Refresh (2026-06-07)

Run after the Phase 7 implementation commits landed:
`39e5a09ec` (L1), `08b8fc17d` (L3/K3), `8446d4132` (v4-M4/v4-L6 proof
rider), `833008904` (L6/L7), `60ffe516b` (L8), `a526d0c6e` (L9 plus v4-L7
proof rider), and `93dc9cef1` (L10).

Phase 7 exit criteria are satisfied. `L1`, `L3`, `L6`, `L7`, `L8`, `L9`,
`L10`, and `K3` are `DONE` in the active-risk table and v3 gate.
`v4-M4`, `v4-L6`, and `v4-L7` are recorded as Phase 7 proof riders only, not
v3 `DONE` IDs. `M7`, `L38-L55`, `K4`, and Phase 8 remain `PENDING`.

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/lorebook.test.ts server/fastify/__tests__/triggers.test.ts server/fastify/__tests__/serverLoadCostHarness.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/openai.test.ts server/fastify/__tests__/horde.test.ts`:
  passed, 7 files / 394 tests. The proof covers async stored asset reads,
  dispatch/restoration clone counts, provider parameter conventions and
  logit-bias policy, per-assembly asset/lorebook hoists, trigger clone
  narrowing, regex bounds, and history memo chat-var invalidation.
- `pnpm api:test`: passed, 101 files / 1950 passed / 1 skipped (1951 total),
  exited 0. The run emitted normal Fastify request logs.
- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 1 file / 25 tests, exited 0. The command emitted the usual
  Vite/Svelte default-config notice.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
- `git diff --check`: clean before the L10 commit and passed after this
  documentation-only refresh.
- Skipped/failed items: none.

## Phase 6 Verification Refresh (2026-06-07)

Run for the Phase 6 closeout proof. Phase 6 exit criteria are satisfied:
v4-H1/v4-L20, v4-M1/v4-L22, M6, L22, L28, L29, L30, L31, L32, and L33 have
focused regression coverage, and v3 rows M6, L22, and L28-L33 are `DONE` in
the active-risk table and v3 gate. I12 and I18 did not ride Phase 6; I19
remains documented as intentional no-action context.

- `pnpm exec vitest run src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts src/lib/ChatScreens/Chat.parserDependencies.test.ts src/lib/ChatScreens/BackgroundDom.parserDependencies.test.ts src/lib/Others/GridCatalog.svelte.test.ts src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts src/lib/ChatScreens/ChatBody.parseMemo.test.ts src/lib/ChatScreens/Chat.customHtml.test.ts src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/chatBridge.svelte.test.ts src/ts/server/characterBridge.svelte.test.ts src/ts/process/scripts.regexCache.test.ts src/ts/process/scripts.editdisplay.test.ts src/ts/observer.svelte.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 14 files / 121 tests. The command emitted the usual
  Vite/Svelte default-config notice and the existing
  `src/lib/SideBars/LoreBook/LoreBookData.svelte` `state_referenced_locally`
  warning.
- `pnpm test`: passed, 158 files / 1423 tests passed / 4 skipped. The command
  emitted repeated `ECONNREFUSED 127.0.0.1:3000` diagnostics from network-path
  tests plus the same Svelte warning, but exited successfully.
- `pnpm client-thinning:audit`: passed (`Client-thinning audit passed.`).
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
- Skipped/failed items: none.

## Phase 6 Render Cache Hygiene (2026-06-07)

Run for the Phase 6 L32/L33 `render-cache-hygiene` slice. L32 and L33 moved
to `DONE` in the active-risk table and v3 gate.

- `pnpm exec vitest run src/ts/process/scripts.regexCache.test.ts src/ts/process/scripts.editdisplay.test.ts src/ts/observer.svelte.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed after this slice's implementation. The proof covers the
  `bestMatchCache` LRU cap and eviction behavior, `resetScriptCache()` clearing
  best-match entries with the other script caches, BGM chat-switch cleanup
  pausing/removing the current audio and nulling the live element, and a later
  BGM control attaching cleanly.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `git diff --check`: passed with no output.
- Skipped/failed items: no remaining failed commands.

## Phase 6 CustomHTML Template Memo (2026-06-07)

Run for the Phase 6 L31 `customhtml-template-memo` slice. L31 moved to
`DONE` in the active-risk table and v3 gate.

- First `pnpm exec vitest run src/lib/ChatScreens/Chat.customHtml.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  failed, 1 passed / 1 failed file; 26 passed / 2 failed tests. The new
  customHTML regression passed; the failures were confined to the v3 gate's
  hard-coded DONE id lists still omitting L31.
- Rerun `pnpm exec vitest run src/lib/ChatScreens/Chat.customHtml.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 2 files / 28 tests. The command emitted the usual Vite/Svelte
  default-config notice. The proof covers multiple customHTML `Chat.svelte`
  rows sharing one parsed GUI template for unchanged `guiHTML` and CBS
  conditions, `ReloadGUIPointer` bumps not being a template-version key,
  `guiHTML` edits invalidating and reparsing once for the new version, CBS
  condition changes invalidating the template key, and parser failures
  returning the empty placeholder without caching the failure.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `git diff --check`: passed with no output.
- Skipped/failed items: no remaining failed commands.

## Phase 6 Parse Memo Key Caching (2026-06-07)

Run for the Phase 6 L30 `parse-memo-key-caching` slice. L30 moved to `DONE`
in the active-risk table and v3 gate.

- First `pnpm exec vitest run src/lib/ChatScreens/ChatBody.parseMemo.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  failed, 2 files / 29 passed / 3 failed tests. The failures were confined to
  the new L30 proof mutating the pre-proxy character object instead of the live
  `DBState.db.characters[0]` row, and the v3 gate expected-DONE arrays not yet
  including L30.
- Rerun `pnpm exec vitest run src/lib/ChatScreens/ChatBody.parseMemo.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 2 files / 32 tests. The command emitted the usual Vite/Svelte
  default-config notice. The proof covers repeated per-message parse-key builds
  reusing cached character, active-chat, module, and settings signature
  fragments while message-local data still changes the final key. It also
  covers same-array, same-length in-place edits to character scripts,
  character triggers, character assets, module regex, preset regex, module
  assets, and module triggers, proving each changes the final key and bumps
  only the relevant signature build counters; reload-epoch changes still
  invalidate every corpus fragment. Cached-only LLM detection can reuse a
  prebuilt non-raw parse memo key and cached detection key without rebuilding
  the full parse key for the same message.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `git diff --check`: passed with no output.
- Skipped/failed items: no remaining failed commands.

## Phase 6 Draft Mirror Gating (2026-06-07)

Run for the Phase 6 L22 `draft-mirror-gating` slice. L22 moved to `DONE` in
the active-risk table and v3 gate.

- `pnpm exec vitest run src/ts/server/characterBridge.svelte.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 2 files / 32 tests. The command emitted the usual
  Vite/Svelte default-config notice. The proof covers nested character draft
  edits updating the local projection without re-reading the server seed field,
  selected-character switches reseeding the draft, real server projection
  applies with changed character fields reseeding, and local edits dispatching
  sanitized patches while excluded keys such as `chaId` stay out of the
  projection and command patch.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `git diff --check`: passed with no output.
- Skipped/failed items: none.

## Phase 6 Watcher Short-Circuits (2026-06-07)

Run for the Phase 6 L28/L29 `watcher-short-circuits` slice. L28 and L29 moved
to `DONE` in the active-risk table and v3 gate.

- `pnpm exec vitest run src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/chatBridge.svelte.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 3 files / 70 tests. The command emitted the usual
  Vite/Svelte default-config notice. The proof covers selected-character
  `localLore` snapshots reusing cached strings for unchanged chat array
  references, re-stringifying only the replaced chat array, pruning disappeared
  chat ids, dispatching replacement for a non-open selected-character chat,
  direct entry-draft flushes advancing the watcher/cache rollback baseline, a
  message-only guarded write reusing chat/folder scalar maps with no queued
  patch, and real chat/folder scalar edits still dispatching after the
  short-circuit path.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `git diff --check`: passed with no output.
- Skipped/failed items: none.

## Phase 6 Catalog Derived Lists (2026-06-07)

Run for the Phase 6 M6 `catalog-derived-lists` slice. M6 moved to `DONE` in
the active-risk table and v3 gate. I12 and I18 did not ride this slice.

- `pnpm exec vitest run src/lib/Others/GridCatalog.svelte.test.ts src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 3 files / 35 tests, duration 19.58s. The command emitted the usual
  Vite/Svelte default-config notice and the existing
  `src/lib/SideBars/LoreBook/LoreBookData.svelte` `state_referenced_locally`
  warning. The proof covers the pure MobileCharacters row helper preserving
  lastInteraction/name ordering, hideTrash filtering, legacy key fallback,
  search normalization, and ago text, plus the mounted derived list
  recomputing on corpus invalidation while search-only changes reuse the
  formatted/sorted rows.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `git diff --check`: passed with no output.
- Skipped/failed items: none.

## Phase 6 Render Parser Dependency Narrowing (2026-06-07)

Run for the v4-only Phase 6 `render-parser-dependency-narrowing` slice
covering v4-M1/v4-L22. No v3 active-risk rows moved to `DONE`, and the v3
gate registry was not edited. v4-L23 parser-helper churn was left untouched.

- `pnpm exec vitest run src/lib/ChatScreens/Chat.parserDependencies.test.ts src/lib/ChatScreens/BackgroundDom.parserDependencies.test.ts`:
  passed, 2 files / 5 tests. The command emitted the usual
  Vite/Svelte default-config notice. The proof covers unrelated guarded
  projection writes not re-running `risuChatParser` for visible `Chat.svelte`
  rows, changed message/name/role/parser-index props and explicit reload
  still invalidating the correct chat parse surface, unrelated guarded writes
  not re-running `BackgroundDom` `risuChatParser`/`ParseMarkdown`, and
  selected-character parser fields, background HTML, module background
  embedding, and reload pointer changes still invalidating the background
  surface.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- Skipped/failed items: none.

## Phase 6 Transcript Window Reset (2026-06-07)

Run for the v4-only Phase 6 `transcript-window-reset` slice. No v3
active-risk rows moved to `DONE`, and the v3 gate registry was not edited.

- `pnpm exec vitest run src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts`:
  passed, 1 file / 4 tests, duration 17.19s. The command emitted the usual
  Vite/Svelte default-config notice. The proof covers deep-jump expansion in
  the current chat, active-chat identity reset after a deep jump, bounded
  mount/window when opening another long chat, and screenshot window cleanup
  on both success and capture-error paths.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- Skipped/failed items: none.

## Phase 5 Verification Refresh (2026-06-07)

Run after the Phase 5 implementation commits landed:
`cb9864493` (M8), `a1a10e2e3` (L23/L24/L26), `6be6c9384`
(L25/L27), `2cab1eec4` (L21), `8640c5a8e` (L34/L35/L36 plus
v4-L30/v4-L33 riders), and `68edd23d7` (L37).

- `pnpm exec vitest run src/ts/server/settingsBridge.svelte.test.ts src/ts/server/chatBridge.svelte.test.ts src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/characterBridge.svelte.test.ts src/ts/server/promptTemplateBridge.svelte.test.ts src/ts/server/scriptDefinitionBridge.svelte.test.ts src/ts/storage/database.svelte.test.ts src/ts/storage/database.importPreset.test.ts src/ts/translator/presets.test.ts src/ts/translator/translator.cache.test.ts src/ts/process/__tests__/igp.test.ts src/ts/process/__tests__/sendChatErrors.test.ts src/ts/process/files/multisend.test.ts src/ts/process/scripts.editdisplay.test.ts src/ts/process/__tests__/command.projectionGuard.test.ts src/ts/process/mcp/mcp.test.ts src/ts/process/mcp/googlesearchclient.test.ts src/ts/bootstrap.test.ts src/ts/alert.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 20 files / 218 tests, duration 20.56s. The command emitted the
  usual Vite/Svelte default-config notice. The v3 gate and active-risk map
  agree that `M8`, `L21`, `L23`, `L24`, `L25`, `L26`, `L27`, `L34`, `L35`,
  `L36`, and `L37` are `DONE`; `v4-L30` and `v4-L33` are recorded only as
  Phase 5 guard-repair proof riders.
- Phase 5 bridge/preset proofs: M8 proves pending bridge writes flush on
  `pagehide`, `visibilitychange(hidden)`, direct flush hooks, and watcher /
  component teardown without double-dispatch. L23/L24/L26 prove rollback
  suppression for settings, global-lorebook, and chat-row metadata paths,
  including sibling rollback parity. L25/L27 prove coalesced prompt-template
  and lorebook entry edits roll back to the first pre-edit baseline. L21
  proves failed preset commands restore `botPresets`, `botPresetsId`, ids, and
  `setPreset`-copied scalar settings.
- Phase 5 guard/error proofs: L34/L35/L36 prove IGP, send-error inlays, and
  `.po` transcript writes work with the projection guard enabled and persist
  through scoped current-chat message commands; I20 rides as display-only
  trusted projection write coverage and I11's object coercion is fixed in the
  IGP path. The guard inventory records dispositions for `DBState.db`,
  `getDatabase()`, translator preset getters, IGP/inlay/file transcript
  mutation, display/script injection, and MCP bootstrap/handshake. v4-L30
  proves LLM translator preset lookup uses snapshot reads without writing
  through a read-only projection. v4-L33 proves one internal MCP handshake
  failure is isolated to that client/tool set and does not reject all client
  LLM feature initialization. L37/I21 prove null-safe global error/rejection
  handlers and robust `alertError` coercion.
- First `pnpm test`: failed, 1 failed / 153 passed files; 1 failed / 1392
  passed / 4 skipped tests, duration 59.64s. The failure was confined to the
  archived v2 completeness gate proof-name drift:
  `L23: test "server/fastify/__tests__/realmImport.test.ts" does not contain
  "keeps valid JSON Realm import output unchanged with batched assets"` and
  `K4: test "src/ts/server/lorebookBridge.svelte.test.ts" does not contain
  "K4: typing drafts clone only the edited entry before debounce settle"`.
  The run also emitted repeated `ECONNREFUSED 127.0.0.1:3000` lines and the
  existing Svelte `state_referenced_locally` warning for
  `src/lib/SideBars/LoreBook/LoreBookData.svelte`.
- Diagnostic `pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts`
  after refreshing the archived-gate proof names: passed, 1 file / 18 tests,
  duration 728ms. The command emitted the usual Vite/Svelte default-config
  notice.
- Rerun `pnpm test`: passed, 154 files / 1393 passed / 4 skipped tests,
  duration 57.25s. The run emitted the same repeated
  `ECONNREFUSED 127.0.0.1:3000` lines and the existing Svelte
  `state_referenced_locally` warning.
- First `pnpm client-thinning:audit`: failed with
  `[EC4 stable command ids] promptTemplate must not be writable through
  generic settings commands. (server/fastify/src/routes/commands.ts:1)`.
  Diagnostic inspection showed this was an audit false positive from scanning
  the whole route file and seeing preset-specific `promptTemplate` support;
  the audit now checks the actual generic `SETTINGS_GROUP_KEYS` registry.
- Rerun `pnpm client-thinning:audit`: passed
  (`Client-thinning audit passed.`).
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors before and after
  the verification-refresh test/audit-tooling edits.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors
  before and after the verification-refresh test/audit-tooling edits.
- Skipped/failed items: no remaining failed commands. `pnpm test` reports the
  expected 4 skipped tests; the original full-suite and client-thinning audit
  failures are preserved above with their exact diagnostics.

## Phase 4.5 V4-H2 Proxy Framing Hotfix (2026-06-07)

Run after the v4 integration brief routed H2 as a small proxy/transport
closeout before Phase 5.

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/hub.test.ts`:
  passed, 2 files / 32 tests. The new proxy proof uses a real socket and a
  gzip upstream with fixed compressed `content-length`; the proxied response
  omits stale `content-encoding` / `content-length` framing and returns the
  full decompressed body. The shared response-header filter also strips
  `transfer-encoding`, matching the hub framing policy.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/streamJobs.test.ts server/fastify/__tests__/streamJobsRoutes.test.ts`:
  passed, 2 files / 70 tests. This covers the shared response-header filter's
  stream-job header-frame consumer after the v4-I23 inventory rider.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
- Skipped/failed items: none.

## Phase 4 Verification Refresh (2026-06-07)

Run after the Phase 4 implementation commits landed:
`0ec993848` (M9), `4d5e749af` (L2/L5), `ad856d2f9` (L56),
`319c25098` (L17/L18), `e3fe55ede` (L4), `a4510d29a` (L19), and
`3d1777616` (L20).

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/index.test.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/requestAbort.test.ts server/fastify/__tests__/streamJobs.test.ts server/fastify/__tests__/streamJobsRoutes.test.ts server/fastify/__tests__/realmImport.test.ts server/fastify/__tests__/hub.test.ts server/fastify/__tests__/horde.test.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/static.test.ts server/fastify/__tests__/generation.chat.test.ts`:
  passed, 11 files / 300 tests.
- Phase 4 lifecycle/deadline/cancel proofs: M9 proves SIGTERM and SIGINT reach
  `app.close()` / `onClose`, duplicate signals do not double-close, and a hung
  close uses the signal-style force backstop. L2 proves active standalone
  completion streams slide past the original deadline while idle streams still
  abort. L5 proves proxy JSON activity extends `deadlineAt` while silent proxy
  jobs still abort. L56 proves mid-stream local proxy aborts DELETE the server
  job once, while terminal `done` / `error` and non-local WebSocket close do
  not DELETE.
- Phase 4 import/provider/transport proofs: L17 proves hung Realm dynamic
  downloads abort at the import deadline and SSE client disconnect aborts
  upstream resource fetches. L18 proves known-length and unknown-length Realm
  JSON caps, JSON-card per-asset and cumulative resource caps, staged-file
  cleanup, and valid disk-staged JSON imports. L4 proves a hung Horde cleanup
  DELETE receives its own bounded abort signal. L19 proves gzip negotiation for
  bootstrap JSON and static assets with byte-identical decompressed bodies,
  small responses below the threshold stay uncompressed, and chat SSE stays
  uncompressed. L20 proves `/assets/*` receives immutable one-year cache
  headers while `/`, SPA fallback HTML, API 404s, and non-GET fallback
  rejections stay outside that policy.
- `pnpm exec vitest run src/ts/globalApi.proxy.test.ts src/ts/network/proxyJobWs.test.ts src/ts/server/realmImport.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 4 files / 39 tests. The command emitted the usual Vite/Svelte
  default-config notice. The v3 gate and active-risk map agree that `M9`,
  `L2`, `L4`, `L5`, `L17`, `L18`, `L19`, `L20`, and `L56` are `DONE`.
- `pnpm api:test`: passed, 101 files / 1909 passed / 1 skipped.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
- Skipped/failed items: none.

## Phase 3 Verification Refresh (2026-06-07)

Run after the Phase 3 implementation commits landed:
`18cc05099` (M2), `91551a7c9` (L15), `570f11e75` (L16), and
`2a889d4d3` (K1).

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memoryBudgetAllocator.test.ts server/fastify/__tests__/memorySelectionService.test.ts server/fastify/__tests__/promptMemoryAdapter.test.ts server/fastify/__tests__/memoryPlanner.test.ts server/fastify/__tests__/memoryRepository.test.ts server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/memoryEmbedJobHandler.test.ts server/fastify/__tests__/memorySummarizeJobHandler.test.ts server/fastify/__tests__/memorySimilarityRanking.test.ts server/fastify/__tests__/generation.chat.test.ts`:
  passed, 10 files / 196 tests.
- Phase 3 memory-budget proofs: M2 costs existing `tokens: 0` Hypa summaries
  via the assembly-time fallback, proves `memoryTokensRatio` and category
  ratios cap selected summaries, and prevents old over-injected summaries from
  overflowing final budgeting. L15 proves unchanged summarized prefixes are
  memoized across planner and live assembly passes, while edited content and
  tokenizer-option changes re-encode.
- Phase 3 deadline and decode proofs: L16 proves hung normal embedding,
  single contextual embedding, batched contextual embedding, and summarize
  `runOpenAI` calls abort within the provider deadline, and that under-deadline
  calls clear the deadline. K1 proves embedding vectors decode lazily, empty
  or invalid query vectors skip vector reads while preserving diagnostics, and
  valid-vector ranking still reads vectors and preserves ranking diagnostics.
- `pnpm api:test`: passed, 100 files / 1888 passed / 1 skipped.
- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 1 file / 24 tests. The command emitted the usual Vite/Svelte
  default-config notice. The v3 gate and active-risk map agree that `M2`,
  `L15`, `L16`, and `K1` are `DONE`.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
- Skipped/failed items: none.

## Phase 2 Verification Refresh (2026-06-07)

Run after the Phase 2 implementation commits landed:
`e9c6bd7e9` (L13), `7f3ebe2ca` (L14), `b9f473bd0` (K2),
`d877343f1` (M1), `44059700f` (M3), `1465bcef0` (L11), and
`6e1c63303` (L12).

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 3 files / 50 tests. The archived v1/v2 gates and the active v3 gate
  are green; the v3 registry and active-risk map agree that `H1`, `M1`, `M3`,
  `M4`, `M5`, `L11-L14`, and `K2` are `DONE`.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/serverLoadCostHarness.test.ts server/fastify/__tests__/commandMutationReadNarrowing.test.ts server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts server/fastify/__tests__/commandCollectionRange.test.ts server/fastify/__tests__/commandMutationBudget.test.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/projection.test.ts server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/hub.test.ts server/fastify/__tests__/routeProtection.test.ts`:
  passed, 10 files / 301 tests.
- Phase 2 scoped-load proofs: M1 no-var editinput transcript persistence adds
  no whole-corpus load beyond the plain send and asserts the
  `messages.replaced` parent id is the character id; M3 settings and
  prompt-settings commands read only the settings row, with the
  `hypaV3Presets` co-write using the patched request value; L11 collection
  commands read settings plus only requested collection tables and retain the
  broad embedded-settings fallback; L13 plugin-storage single-key PUT/DELETE
  skip database-shape loads while bulk merge keeps its required read; L14
  single character-lorebook hydration uses the one-row path and matches bulk
  hydration for the same character.
- Phase 2 correctness proofs: L12 global lorebook and script/trigger command
  routes preserve target-payload validation while leaving unrelated
  child-lore/script rows unrepaired; K2 proxy/hub protected requests verify
  auth exactly once and unauthenticated protected requests still stop before
  forwarding/body parsing.
- `pnpm api:test`: passed, 100 files / 1872 passed / 1 skipped.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.

## Phase 1 Verification Refresh (2026-06-07)

Run after the Phase 1 implementation commits landed:
`45fd16f2f` (H1), `e792b293d` (M4), and `71b36a150` (M5).

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 3 files / 50 tests. The archived v1/v2 gates and the active v3 gate
  are green; the v3 registry and active-risk map agree that only `H1`, `M4`,
  and `M5` are `DONE`.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts`:
  passed, 1 file / 65 tests.
- H1 proof coverage in `generation.chat.test.ts`: explicit durable
  `DELETE` cancel, sliding-deadline/silent transport return, in-loop abort
  race before a provider `done` frame, and non-streaming `resultFrames`-style
  silent return.
- `pnpm exec vitest run src/ts/chatCommands.test.ts src/ts/process/__tests__/sendChatContext.test.ts src/ts/characterCommands.test.ts src/ts/__tests__/sendCloneCountProbe.test.ts`:
  passed, 4 files / 69 tests. The run printed repeated
  `ECONNREFUSED 127.0.0.1:3000` lines before the final passing summary.
- Send clone-count after M4+M5 for the deterministic plain-send fixture:
  `jsonCloneCount: 1`, `structuredCloneCount: 2`, `totalCloneCount: 3`,
  `maxClonedSize: 198`.
- Send fixture: 3 characters; 40 messages before send; 41 messages after
  submit; 42 final messages; 200-byte message bodies; transcript JSON before
  send `9941`; active chat JSON `10086`; active character JSON `10364`;
  characters JSON `11710`.
- Send command shape: 2 commands total; 0 message replace; 1 message append;
  1 character patch; 0 generation-result commands; 1 persisted message;
  `persistedWholeTranscript: false`.
- Server-chat probe shape: 1 durable `send` call; user message length 16.
  Compared with the Phase 0 baseline below, the plain send no longer uploads
  or persists the whole transcript and no longer performs the large transcript
  or character-row clone.
- `pnpm api:test`: passed, 100 files / 1857 passed / 1 skipped.
- `pnpm test`: passed, 152 files / 1340 passed / 4 skipped. The run emitted
  repeated `ECONNREFUSED 127.0.0.1:3000` lines and the existing Svelte
  `state_referenced_locally` warning for
  `src/lib/SideBars/LoreBook/LoreBookData.svelte`.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.

## Phase 0 Baseline Run (2026-06-07)

Run after the v3 gate, send clone-count probe, and terminal-frame assertion
helper landed.

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 3 files / 50 tests. The v3 gate is green with all scheduled IDs
  `PLANNED`.
- `pnpm test`: passed, 152 files / 1337 passed / 4 skipped. The run emitted
  repeated `ECONNREFUSED 127.0.0.1:3000` lines and one Svelte warning before
  the final passing summary.
- `pnpm api:test`: passed, 100 files / 1853 passed / 1 skipped.
- `pnpm client-thinning:audit`: passed (`Client-thinning audit passed.`).
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.

Focused baseline confirmations:

- `pnpm exec vitest run src/ts/__tests__/sendCloneCountProbe.test.ts src/ts/__tests__/cloneCostGateCompleteness.test.ts`:
  passed, 2 files / 10 tests.
- Send clone-count baseline for one deterministic plain send:
  `jsonCloneCount: 44`, `structuredCloneCount: 2`, `totalCloneCount: 46`,
  `maxClonedSize: 10463`.
- Send fixture: 3 characters; 40 messages before send; 41 messages after
  submit; 42 final messages; 200-byte message bodies; transcript JSON before
  send `9941`; active chat JSON `10086`; active character JSON `10364`;
  characters JSON `11710`.
- Send command shape: 2 commands total; 1 message replace; 0 message append;
  1 character patch; 0 generation-result commands; 41 persisted messages;
  `persistedWholeTranscript: true`.
- Server-chat probe shape: 1 durable `send` call; user message length 16.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts __tests__/generation.chat.test.ts __tests__/terminalFrameAssertions.test.ts`:
  passed, 2 files / 68 tests. The terminal-frame helper smoke covers ordered
  SSE frame parsing/normalization, single terminal checks, success `done`,
  provider `error` then bare `done`, duplicate terminal rejection, and the
  no-success-`done` abort assertion helper.

## Inherited Baseline (v2 Phase 9 Closing Run, 2026-06-06)

Recorded in the v2 archive
([`../v2/latest-verification.md`](../v2/latest-verification.md))
at the same tree this plan starts from:

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts`:
  passed, 2 files / 26 tests.
- `pnpm test`: passed, 1312 passed / 4 skipped.
- `pnpm api:test`: passed, 1846 passed / 1 skipped.
- `pnpm client-thinning:audit`: passed.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
- `pnpm check`: pre-existing 14-error svelte-check baseline in 5 files
  (documented; unrelated).

## Audit-Time Check (2026-06-06, v3 audit session)

Run at `ad07004ba` during the v3 audit:

- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
- Full suites were not re-run during the audit (read-only); the inherited v2
  closing run above is the authoritative full baseline at this tree. Phase 0
  re-runs and re-records the full set.
