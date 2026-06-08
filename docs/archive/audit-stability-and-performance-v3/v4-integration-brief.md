# V4 Integration Brief

Date: 2026-06-07

Phase 4 is complete at `3d1777616`; keep the v3 plan as the spine. This
brief routes the v4 audit into the remaining post-Phase-4 work without
creating a standalone v4 mega-plan. The purpose is to close repeated failure
families, add cheap invariants where possible, and avoid an enumerated
finding-by-finding repair wave.

Phase 4.5 update: v4-H2 is closed as a small proxy/transport hotfix before
Phase 5. The `/fetch` response filter now strips stale decompression framing
headers and the focused proof is recorded in
[`latest-verification.md`](latest-verification.md). No v3 active-risk IDs move
for this v4-only closeout.

Primary sources:
[`status.md`](status.md),
[`next-steps.md`](next-steps.md),
[`active-risk-analysis.md`](active-risk-analysis.md),
[`latest-verification.md`](latest-verification.md),
[`../../audit-stability-and-performance-v4.md`](../../audit-stability-and-performance-v4.md),
and [`../../audit-v4-findings/README.md`](../../audit-v4-findings/README.md).

## Routing Summary

| Classification | Route |
| --- | --- |
| Phase 4.5 hotfix before Phase 5 | Completed for v4-H2 as a small proxy/transport closeout. `/fetch` now strips `content-length` and `transfer-encoding` from proxy responses after undici decompression, matching the hub route's framing policy, and has a real-socket gzip framing regression test. Because this uses the shared proxy response filter, v4-I23's stale WS `upstream_headers` framing inventory is also covered without opening a separate runtime slice. |
| Amend Phase 5 | Keep Phase 5 as the next main batch, but amend `guard-repairs` before implementation. Make it a tree-wide guarded-write/feature-breakage sweep instead of only the v3 L34/L35/L36 enumerated sites. Add v4-L30 and v4-L33 to the Phase 5 guard matrix. |
| Amend Phase 6 | Add the v4 render/window batch: v4-H1 + v4-L20 transcript window reset/screenshot bound, and v4-M1 + v4-L22 render parser dependency narrowing. These are the same broad-projection re-mint consumer family as v3 Phase 6. |
| Amend Phase 7 | Add provider dispatch convention fixes: v4-M4 and v4-L6, plus v4-L7 as a sibling of v3-L9 user-regex bounds. Treat v4-L5 as a free rider only if the history window is already being touched. |
| Amend Phase 8 | Add a translator subsystem slice for v4-L24 through v4-L29, with v4-L30 fixed earlier in Phase 5 if possible. Add v4-L31 and v4-L35 through v4-L37 to the existing stage-4/MCP/media/plugin lifecycle batches. Keep v4-L38 out unless a storage-persistence owner accepts it separately. |
| Gate/invariant first | Treat the invariant as an entry condition, not a separate mega-phase. This covers v4-M2, v4-M3, v4-M5, v4-L11 through v4-L13, v4-L17 through v4-L19, v4-L21, v4-L23, v4-L32, v4-L34, and v4-L36 through v4-L38 before they either ride Phases 6-8 or become small closeouts. |
| Measure-first | v4-L19 JWT mint cost, v4-L21 document-listener fanout, v4-L23 `Intl.DateTimeFormat` churn, v4-L27 deeplX fallback latency, and v4-L34 GraphMem embedding cost need runtime or focused reproduction evidence before being pulled ahead of scheduled H/M work. |
| Defer/no-action | v4 informational rows remain inventory unless they ride a touched fix. Do not open a new plan just to schedule every low/info row. |

## High And Medium Routing

| ID | Classification | Routing decision |
| --- | --- | --- |
| H1 | Amend Phase 6 | Start Phase 6 with a transcript-window identity reset. Reset `loadPages` per active chat and make screenshot expansion bounded or transient; this also covers L20. |
| H2 | Phase 4.5 hotfix before Phase 5 | Closed as the Phase 4.5 proxy/transport hotfix. It was high severity, tiny in scope, and adjacent to the just-closed Phase 4 transport work. |
| M1 | Amend Phase 6 | Pair with L22. Scope `Chat.svelte` CBS condition inputs to props or untracked reads so streaming projection writes do not re-run every visible message parser. |
| M2 | Gate/invariant first | No remaining v3 phase owns memory lifecycle. Define a memory ownership invariant first: chat/character delete removes `memory_*` rows and pending jobs, embed workers validate chat liveness, and summaries persist nonzero token costs. Then schedule M2 with L11-L13 as a small memory closeout. |
| M3 | Gate/invariant first | Define a generation-output budget invariant before patching one stream site: total accumulated output cap plus absolute max duration on sliding deadlines. Then decide whether it becomes a small transport closeout or rides Phase 7. |
| M4 | Amend Phase 7 | Add the `-1000` disabled-parameter convention to server dispatch. If users are currently hitting disabled-slider send failures, it is safe to pull this as a tiny rider after H2 and before Phase 5. |
| M5 | Gate/invariant first | Add a retry-loop invariant: every full-generation retry path must have a reachable cap on both success-filter and failure branches. Fix `banCharacterset` under that rule; do not bury it inside unrelated Phase 5 bridge work. |

## Phase 5 Amendments

Phase 5 should still be the next main v3 batch after the H2 hotfix, but its
guard-repair scope must change before implementation.

1. Rename the practical shape of `guard-repairs` from "fix L34/L35/L36
   sites" to "tree-wide guarded-write and feature-breakage sweep".
2. Keep the existing v3 targets: IGP append, inlay error bubble, `.po`
   transcript mutations, `@@inject`, I11 coercion, and guard-enabled tests.
3. Add v4-L30: `getCurrentTranslatorPreset()` must not write through the
   read-only projection. Either normalize on a clone or route the write
   through a trusted projection write plus a scoped command, depending on
   whether the normalized value should persist.
4. Add v4-L33 to the same Phase 5 test matrix as a guard-adjacent client
   feature breakage: MCP handshake failures should be isolated per client and
   surfaced as unavailable tools, not reject all LLM feature initialization.
   This is not itself a projection write, so the invariant is "LLM feature
   bootstrap remains usable under the guard and partial MCP failure".
5. Before editing, run an inventory over direct projection writes and
   read-path normalizers: `getDatabase()`, `DBState.db`, translator preset
   getters, display/script injection, IGP/inlay/file transcript mutation, and
   MCP tool bootstrap. Fix only live guarded-write or feature-breaking sites;
   put deliberate no-action entries in the slice.

Exit amendment: Phase 5 is not done until the guard-enabled tests prove the
original v3 guard repairs plus v4-L30 and v4-L33, and the slice records the
tree-wide inventory instead of only the enumerated files.

## Later Phase Amendments

Phase 6:

- Add `transcript-window-reset`: v4-H1 and v4-L20. State tied to the active
  chat must reset or be keyed; screenshot should not leave a session-wide
  infinite window behind.
- Add `render-parser-dependency-narrowing`: v4-M1 and v4-L22. Parser work
  must not scale with every visible message on unrelated guarded projection
  writes.
- Consider v4-L23 only after a profile or if parser helper code is already
  touched.

Phase 7:

- Add `provider-parameter-conventions`: v4-M4 and v4-L6. The server dispatch
  layer must preserve SPA disabled-sentinel semantics and either pass
  assembled biases to providers or drop the dead assembly work.
- Extend `user-regex-bounds` with v4-L7, since it is the same imported-regex
  event-loop blocking family outside the original v3 trigger-effect sites.
- Treat v4-L1/v4-L2/v4-L3 as send-path polish after the H/M batch, unless they
  reproduce in normal use before then.

Phase 8:

- Add a translator slice for v4-L24 through v4-L29. Keep v4-L30 in Phase 5 because it is a
  guard break, but the rest belongs with client subsystem hygiene: output
  memo, compiled-regex memo, cache quota/LRU, deeplX fallback behavior, and
  `combineTranslation` call fanout.
- Extend existing MCP/media/plugin slices with v4-L31 and v4-L35 through v4-L37 after the
  matching abort/cap/lifecycle invariant is named. Do not expand Phase 8 to
  every optional subsystem low unless a listener/cache/abort/cap invariant
  covers the family.

Memory closeout:

- v4-M2 plus v4-L11 through v4-L13 do not fit Phases 5-8 cleanly because Phase 3 is already
  closed. Keep them as a small gated closeout after the H2 hotfix and before
  or after Phase 5 based on owner priority. The key is the invariant, not the
  exact phase number.

## Proposed Invariants And Gates

- Proxy framing gate: any route that forwards a decompressed or transformed
  upstream body must strip hop-by-hop/framing headers (`content-length`,
  `transfer-encoding`, and stale `content-encoding`) and have at least one
  real-socket regression test.
- Projection-write gate: guard-enabled tests must cover every live direct
  transcript/projection write site. No read-path getter may normalize by
  writing into `DBState.db` or `getDatabase()` unless it clones first or enters
  a trusted write with durable command persistence.
- Render budget gate: a streaming-frame projection write must not call the
  full message parser for every visible message. Prove with parser call-count
  tests or a render-count probe around `Chat.svelte` and `BackgroundDom`.
- Provider dispatch gate: server dispatch must preserve SPA disabled-sentinel
  omissions for every forwarded parameter; assembled per-request fields must
  either reach the provider adapter or be removed from assembly.
- Generation budget gate: every streamed/looped generation path needs both a
  total output cap and a reachable retry/time cap. `continue` statements must
  not bypass retry accounting.
- Memory lifecycle gate: chat/character deletion must own all server memory
  rows and jobs for that chat, and memory summaries should persist real token
  costs so send-time fallbacks are exceptional.
- Lifecycle/cap gate: plugin/MCP/media/translator additions need paired
  cleanup or bounded cache/buffer ownership, with unload/reload or quota tests
  for the family rather than one file at a time.

## Recommended Next Move

1. Amend Phase 5's guard-repair slice as described above.
2. Open Phase 5.
3. After Phase 5, start Phase 6 with v4-H1/v4-M1 rather than lower-impact render
   lows.

This keeps v3 continuous while preventing v4 from becoming another broad
audit treadmill.
