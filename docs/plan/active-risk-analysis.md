# Active Risk Analysis

Date: 2026-06-04

This file routes every confirmed audit finding to its phase, target fix, and
status. It is the map; per-finding evidence/impact/fix detail lives in
[`audit-stability-and-performance.md`](audit-stability-and-performance.md), and
proof runs live in [`latest-verification.md`](latest-verification.md).

## Summary

57 confirmed findings (3 high, 14 medium, 40 low) plus 4 context-dependent and 5
dismissed. All are routed below. **Nothing is implemented yet.** The five
cross-cutting roots from the audit map to phases: Root 1 -> Phase 2, Root 2 ->
Phase 3, Root 3 -> Phase 1 (H3), Root 4 -> Phase 4, Root 5 -> Phase 5. Phases 6-7
collect the remaining mediums/lows; Phase 0 is foundations; Phase 8 is the
standing gate.

Principle: narrow the work to what the path needs on the hot path, or add a
preventive bound — without changing the wire protocol, rollback correctness, or
output bytes. Keep the broad path for its genuine full-corpus consumer.

## Finding -> Phase Map

`status` is `scheduled` until a fix lands, then `DONE (<commit>)`.

### High

| ID | Phase | Target fix | Status |
| -- | ----- | ---------- | ------ |
| H1 | [1](phases/phase-1-high-severity-hot-paths.md) | `loadChatHydration` early-returns on `message.length > 0`; no whole-corpus `loadPersisted` for a non-HypaV3 chat | scheduled |
| H2 | [1](phases/phase-1-high-severity-hot-paths.md) | Add scalar `ChatSelectionSnapshot`/`restoreChatSelection`; `changeChatTo` uses it instead of `currentChatStateSnapshot()` | scheduled |
| H3 | [1](phases/phase-1-high-severity-hot-paths.md) | Coalesce token-driven renders to ~1/animation-frame; full flush on `done` | scheduled |

### Medium

| ID | Phase | Target fix | Status |
| -- | ----- | ---------- | ------ |
| M1 | [2](phases/phase-2-server-load-narrowing.md) | Assembly-specific scoped message/hypa load for the target chat only (reuse `getChatMessagesGroupedByIds`); leave siblings `message=[]` **[known-leftover]** | scheduled |
| M2 | [7](phases/phase-7-memoization-and-hygiene.md) | Hoist active-module resolution + `parseScripts` + compiled RegExp once per assembly (exclude cbs-action scripts) | scheduled |
| M3 | [2](phases/phase-2-server-load-narrowing.md) | Field-scoped SQLite load / per-request memo so a command parses only the tables it reads | scheduled |
| M4 | [2](phases/phase-2-server-load-narrowing.md) | `loadSingleCharacterRow` single-row `WHERE id=?` read; opt-in mask-in-place | scheduled |
| M5 | [2](phases/phase-2-server-load-narrowing.md) | Defer `jsonPayloadBytes` behind the metrics-enabled guard (thunk) | scheduled |
| M6 | [4](phases/phase-4-outbound-request-lifecycle.md) | Proxy `/fetch` aborts on `req.raw` close + `AbortSignal.any`; Fastify `requestTimeout` backstop | scheduled |
| M7 | [6](phases/phase-6-memory-and-lua.md) | Cap drained embed batch; slice contextual request into token-aware sub-batches | scheduled |
| M8 | [4](phases/phase-4-outbound-request-lifecycle.md) | Bounded deadline in `attachAbort` for non-durable paths + body-size cap | scheduled |
| M9 | [5](phases/phase-5-materialization-and-lifecycle.md) | Streaming bounded inflate (`fflate` `Gunzip` with output-cap accumulator) per envelope/block | scheduled |
| M10 | [5](phases/phase-5-materialization-and-lifecycle.md) | Asset-GC token-only `SELECT data` scan (no full hydrate); defer import asset report | scheduled |
| M11 | [5](phases/phase-5-materialization-and-lifecycle.md) | Bundle export settles drain-wait on `close`/`error`; on premature close `zip.terminate()` + destroy read stream | scheduled |
| M12 | [3](phases/phase-3-client-clone-narrowing.md) | Drop redundant `setDatabase(db)` in `/setvar`/`/addvar` (mirror `setChatVar`) | scheduled |
| M13 | [3](phases/phase-3-client-clone-narrowing.md) | `changedCharacterFields` clones per kept key (skip `CHARACTER_PATCH_EXCLUDED_KEYS` before any clone) | scheduled |
| M14 | [3](phases/phase-3-client-clone-narrowing.md) | `setupSendChatContext` uses `currentCharacterRowSnapshot(selectedChar)` + `restoreCharacterRow` | scheduled |

### Low (scheduled)

| ID | Phase | Target fix | Status |
| -- | ----- | ---------- | ------ |
| L1 | [2](phases/phase-2-server-load-narrowing.md) | Memoize `getActiveModules` per assembly (port the SPA `lastModules` memo) | scheduled |
| L2 | [2](phases/phase-2-server-load-narrowing.md) | Hoist whole-transcript run-var expansion off the per-message path where invariant | scheduled |
| L3 | [7](phases/phase-7-memoization-and-hygiene.md) | Hoist/compile lorebook keyword regexes outside the activation loop **[known-leftover]** | scheduled |
| L5 | [2](phases/phase-2-server-load-narrowing.md) | Skip the full `getAllAssetMetadata` scan when a mutation does not read assets | scheduled |
| L6 | [2](phases/phase-2-server-load-narrowing.md) | Narrow the character/chat load for message-only routes (locate one row) | scheduled |
| L8 | [7](phases/phase-7-memoization-and-hygiene.md) | Replace the `OFFSET 999` prune walk with a bounded delete (e.g. `MIN(revision)` keep-window) | scheduled |
| L9 | [7](phases/phase-7-memoization-and-hygiene.md) | Drop the redundant `chats` DELETE the FK cascade already performs | scheduled |
| L10 | [2](phases/phase-2-server-load-narrowing.md) | Load command-event history only when replay is requested | scheduled |
| L11 | [5](phases/phase-5-materialization-and-lifecycle.md) | Add the `cleanedUp` guard before `memoryEvents.subscribe` | scheduled |
| L12 | [5](phases/phase-5-materialization-and-lifecycle.md) | Close the proxy WS viewer when it attaches to an already-done job | scheduled |
| L13 | [5](phases/phase-5-materialization-and-lifecycle.md) | `onClose` awaits/guards detached runners; cancel-persist checks DB-open | scheduled |
| L14 | [5](phases/phase-5-materialization-and-lifecycle.md) | Heartbeat the durable SSE viewer during long assembly | scheduled |
| L15 | [5](phases/phase-5-materialization-and-lifecycle.md) | Tighten no-viewer proxy-job buffer cap / enable replay bound | scheduled |
| L16 | [6](phases/phase-6-memory-and-lua.md) | Skip the orphan-cleanup write txn when nothing is orphaned **[known-leftover]** | scheduled |
| L17 | [6](phases/phase-6-memory-and-lua.md) | Round-robin/bound per-chat memory job batches for fairness | scheduled |
| L18 | [6](phases/phase-6-memory-and-lua.md) | Reuse the Phase 2 scoped/memoized loader in memory batches | scheduled (after Phase 2) |
| L19 | [6](phases/phase-6-memory-and-lua.md) | Aggregate Lua exec-time/engine budget across hook phases **[known-leftover]** | scheduled |
| L20 | [4](phases/phase-4-outbound-request-lifecycle.md) | Thread the request `AbortSignal` into the Lua runtime | scheduled |
| L21 | [6](phases/phase-6-memory-and-lua.md) | Reuse/pool the wasmoon engine or cache the compiled prelude (within the per-call isolation model) | scheduled |
| L22 | [4](phases/phase-4-outbound-request-lifecycle.md) | Cap the streaming-provider SSE accumulation buffer | scheduled |
| L23 | [4](phases/phase-4-outbound-request-lifecycle.md) | Unwrap 6to4/NAT64/IPv4-compat embedded addresses in the SSRF guard **[known-leftover]** | scheduled |
| L24 | [4](phases/phase-4-outbound-request-lifecycle.md) | Reject `__proto__`/`constructor`/`prototype` keys in `setObjectValue` | scheduled |
| L25 | [4](phases/phase-4-outbound-request-lifecycle.md) | Increment the Lua egress rate counter only after URL validation passes | scheduled |
| L27 | [5](phases/phase-5-materialization-and-lifecycle.md) | Guard per-manifest `JSON.parse` in `listBackups` (skip/flag a corrupt manifest) | scheduled |
| L28 | [5](phases/phase-5-materialization-and-lifecycle.md) | Wrap legacy `db.json` restore re-import in a transaction; emit restore event after it | scheduled |
| L29 | [5](phases/phase-5-materialization-and-lifecycle.md) | Persist writer-session origin on command events so reconnect replay keeps own-echo suppression | scheduled |
| L30 | [5](phases/phase-5-materialization-and-lifecycle.md) | Re-arm reattach after completion so a second live-job chat reattaches | scheduled |
| L31 | [3](phases/phase-3-client-clone-narrowing.md) | Scope/throttle the script-definition watcher per-keystroke scan | scheduled |
| L32 | [3](phases/phase-3-client-clone-narrowing.md) | Scope the discrete lorebook-editor clone + id-assign to the edited collection **[known-leftover]** | scheduled |
| L33 | [3](phases/phase-3-client-clone-narrowing.md) | Avoid deep-cloning the modules array as a dependency read in the `stores.svelte` `$effect` | scheduled |
| L34 | [3](phases/phase-3-client-clone-narrowing.md) | `toggleSelectedChatModule` uses a chat-scoped snapshot | scheduled |
| L35 | [3](phases/phase-3-client-clone-narrowing.md) | MCP `setCharacterInfo` uses a single-row snapshot | scheduled |
| L36 | [3](phases/phase-3-client-clone-narrowing.md) | Fire-and-forget command runners surface/await rejections and roll back | scheduled |
| L37 | [7](phases/phase-7-memoization-and-hygiene.md) | Remove stray `console.log`s of full command/preset objects | scheduled |
| L38 | [7](phases/phase-7-memoization-and-hygiene.md) | Remove the `console.log('Trigger time', ...)` on the per-render `editdisplay` path | scheduled |
| L39 | [7](phases/phase-7-memoization-and-hygiene.md) | Scan the transcript in place instead of copying it in `findGeneratedAssistantMessage` | scheduled |
| L40 | [7](phases/phase-7-memoization-and-hygiene.md) | Memoize the 9 `new RegExp` trigger-effect sites (reuse `getCompiledRegex`) | scheduled |

### Context-dependent

| ID | Routing | Note |
| -- | ------- | ---- |
| U1 | [2](phases/phase-2-server-load-narrowing.md) | Bulk hydration whole-corpus read — micro-opt; resolve `knownChatIds` via `SELECT id ... WHERE id IN (...)` rather than full `loadPersisted`. Low payoff (callers already pass the whole corpus); fold into Phase 2 if cheap. |
| U4 | [3](phases/phase-3-client-clone-narrowing.md) | `setCurrentChat` broad clone — cheap consistency cleanup (`currentChatScopedSnapshot` + `dispatchCompatibleChatUpdateScoped`); the marquee per-generation caller is dead on the server route. |
| U2 | gated | Foreign `fields` re-stub — the broad mappings are intentional for gap/reconnect recovery; further narrowing is the `leftover.md` sprawling-resource evidence gate. **Not scheduled.** |
| U3 | no action | Session-bounded hydration id `Set`s — bounded by corpus size, cleared on resync, reactivity impact ~nil. **No fix.** |

## Gated / Owner-Decision (not scheduled)

Carried from the audit's **[known-leftover]** tags; these stay on the existing
`RISU_PROTOCOL_METRICS` evidence path or need an owner decision. Do not schedule
without that trigger.

- **L4** — targeted-assembly scriptstate persist rewrites the full characters
  table. Accepted breadth of the assembly persist; narrowing it is gated with
  the other Tier-5 write breadth.
- **L7** — `POST characters`, `create-and-select`, `POST modules`,
  `DELETE modules/:id` full ~13-table rewrite. Explicitly maintainer-deferred
  after a frequency×cost review (`leftover.md`); `DELETE modules/:id` also
  carries the cross-table `removeModuleReferences` blocker.
- **L26** — ordinary/bundle `.risu` export full materialization + extra
  JSON-clone+normalize. The streaming block-envelope writer is gated on large
  real-export evidence; the extra clone+normalize on export is a cheaper
  sub-win that *can* be picked up opportunistically in Phase 5 if it proves
  free, but the streaming rewrite is out of scope.
- **U2** — sprawling-resource full-bootstrap narrowing (see above).

Note: several **scheduled** lows are also tagged `[known-leftover]` (L3, L16,
L19, L23, L32) — those leftover notes describe a *broader* narrowing; the
specific defensive/perf fix scheduled here is a cheap, self-host-relevant win
that also advances the leftover item. Only L4, L7, L26, U2 are fully gated.

## Source Anchors

- Server load/clone (Roots 1/5): `server/fastify/src/repository.ts`,
  `messageStore.ts`, `commands/mutations.ts`, `routes/projection.ts`,
  `routes/generationChat.ts`, `assetGc.ts`, `risuSave/*.ts`.
- Client clones/watchers (Root 2): `src/ts/chatCommands.ts`,
  `characterCommands.ts`, `globalApi.svelte.ts`, `process/sendChatContext.ts`,
  `process/command.ts`, `moduleCommands.ts`, `storage/database.svelte.ts`,
  `server/*Bridge.svelte.ts`.
- Streaming (Root 3): `src/lib/ChatScreens/Chat.svelte`, `ChatBody.svelte`,
  `parser/parser.svelte.ts`, `process/postGeneration/streamResponse.ts`,
  `process/request/serverChat.ts`, `server/.../routes/generation.ts`.
- Outbound/egress (Root 4): `routes/proxy.ts`, `proxy.ts`, `generation/*.ts`,
  `prompt/luaRuntime.ts`, `generation/additionalParams.ts`.
- Reference templates: `c9e728b1` (scalar snapshot) +
  `src/ts/compatibilityAdapters.test.ts`; `getChatMessagesGroupedByIds`
  (scoped loader).

## Decision

Schedule all 57 confirmed findings plus U1/U4 across Phases 0-8; gate L4/L7/L26/
U2 and take no action on U3. Order phases by root-cause leverage (Phase 1 highs
first, then Phase 2 server root). Every fix lands with a regression test and a
Phase 8 gate registration.

## Investigated And Dismissed

Carried from the audit's "Investigated And Dismissed" so future readers do not
re-open them. All verified non-issues against the current code:

- **Inline continue/regenerate partial-text loss** — unreachable; the real
  client always sends `durable:true` for server-dispatched continue/regenerate.
- **Per-generation memory cosine-ranks all embeddings** — false on the live
  route; `/generate/chat` passes empty query vectors, so the ranking loop never
  runs.
- **Orphan cleanup cascade-deletes a shared chunk for another model** —
  impossible by invariant (shared chunk ⇒ identical `chatMemos` ⇒ orphaned or
  kept together).
- **`buildMemoryWindow` clones all characters** — dead local-assembler path,
  already downgraded to inventory-only by the frontend-performance workstream.
- **`addMetadataToElement` logs per render** — dead code behind an
  `aiWatermarkingLawApplies()` stub hardcoded to `return false`.

## Non-Goals

- Do not change the projection/bootstrap/revision/event wire model, `.risu`
  envelope bytes, rendered output, or persisted state.
- Do not edit the broad SQLite loaders / full-collection snapshots out of
  existence — keep them for their genuine full-corpus consumers.
- Do not schedule the gated items (L4, L7, L26, U2) without evidence/owner sign-off.
- Do not re-open a dismissed candidate above.
