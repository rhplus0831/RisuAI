# Active Risk Analysis

Date: 2026-06-04

This file maps every confirmed audit finding to a phase, target fix, and status.
Evidence and fix detail live in
[`audit-stability-and-performance.md`](audit-stability-and-performance.md), and
proof runs live in [`latest-verification.md`](latest-verification.md).

## Summary

57 confirmed findings are scheduled or routed: 3 high, 14 medium, 40 low. Four
context-dependent items and five dismissed items are recorded so they are not
rediscovered.

Phase mapping:

- Root 1 -> Phase 2.
- Root 2 -> Phase 3.
- Root 3 -> Phase 1 (H3).
- Root 4 -> Phase 4.
- Root 5 -> Phase 5.
- Phase 0 supplies foundations. Phase 8 supplies the standing gate.

Principle: narrow hot-path work or add a preventive bound. Preserve wire
protocol, rollback scope, output bytes, and the broad path for true full-corpus
consumers.

## Finding -> Phase Map

`status` is `scheduled` until a fix lands, then `DONE (<commit>)`.

### High

| ID  | Phase                                          | Target fix                                            | Status            |
| --- | ---------------------------------------------- | ----------------------------------------------------- | ----------------- |
| H1  | [1](phases/phase-1-high-severity-hot-paths.md) | `loadChatHydration` guard on `message.length > 0`.    | DONE (`0dc7452e`) |
| H2  | [1](phases/phase-1-high-severity-hot-paths.md) | Scalar `ChatSelectionSnapshot` for `changeChatTo`.    | DONE (`067ab82a`) |
| H3  | [1](phases/phase-1-high-severity-hot-paths.md) | Coalesce token-driven renders; final flush on `done`. | DONE (`e41dc6c6`) |

### Medium

| ID  | Phase                                                | Target fix                                                      | Status            |
| --- | ---------------------------------------------------- | --------------------------------------------------------------- | ----------------- |
| M1  | [2](phases/phase-2-server-load-narrowing.md)         | Scoped target-chat message/hypa load. [known-leftover]          | DONE (`c193c008`) |
| M2  | [7](phases/phase-7-memoization-and-hygiene.md)       | Hoist module/script/RegExp work once per assembly.              | scheduled         |
| M3  | [2](phases/phase-2-server-load-narrowing.md)         | Field-scoped command reads or per-request load memo.            | DONE (`e0e86ab1`) |
| M4  | [2](phases/phase-2-server-load-narrowing.md)         | Single-row `loadSingleCharacterRow`; in-place mask where owned. | DONE (`254b3112`) |
| M5  | [2](phases/phase-2-server-load-narrowing.md)         | Defer `jsonPayloadBytes` until metrics are enabled.             | DONE (`b2765994`) |
| M6  | [4](phases/phase-4-outbound-request-lifecycle.md)    | Abort proxy `/fetch` upstream on close; add timeout backstop.   | DONE (`bf1a6cb2`) |
| M7  | [6](phases/phase-6-memory-and-lua.md)                | Cap embed batches; split contextual requests by token size.     | scheduled         |
| M8  | [4](phases/phase-4-outbound-request-lifecycle.md)    | Add non-durable provider deadline and body cap.                 | DONE (`bf1a6cb2`) |
| M9  | [5](phases/phase-5-materialization-and-lifecycle.md) | Streaming bounded inflate per envelope/block.                   | scheduled         |
| M10 | [5](phases/phase-5-materialization-and-lifecycle.md) | Token-only asset scan; defer import asset report.               | scheduled         |
| M11 | [5](phases/phase-5-materialization-and-lifecycle.md) | Settle bundle-export drain wait on `close`/`error`.             | scheduled         |
| M12 | [3](phases/phase-3-client-clone-narrowing.md)        | Drop redundant `setDatabase(db)` in `/setvar`/`/addvar`.        | DONE (`0efa7ba6`) |
| M13 | [3](phases/phase-3-client-clone-narrowing.md)        | Clone only kept character fields.                               | DONE (`0efa7ba6`) |
| M14 | [3](phases/phase-3-client-clone-narrowing.md)        | Use `currentCharacterRowSnapshot` in send context.              | DONE (`0efa7ba6`) |

### Low (scheduled)

| ID  | Phase                                                | Target fix                                                     | Status                            |
| --- | ---------------------------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| L1  | [2](phases/phase-2-server-load-narrowing.md)         | Memoize `getActiveModules` per assembly.                       | DONE (`c193c008`)                 |
| L2  | [2](phases/phase-2-server-load-narrowing.md)         | Hoist invariant run-var expansion.                             | DONE (`c193c008`)                 |
| L3  | [7](phases/phase-7-memoization-and-hygiene.md)       | Hoist/compile lorebook keyword regexes. [known-leftover]       | scheduled                         |
| L5  | [2](phases/phase-2-server-load-narrowing.md)         | Skip asset scan when mutation does not read assets.            | DONE (`e0e86ab1`)                 |
| L6  | [2](phases/phase-2-server-load-narrowing.md)         | Narrow message-only character/chat lookup.                     | DONE (`e0e86ab1`)                 |
| L8  | [7](phases/phase-7-memoization-and-hygiene.md)       | Replace `OFFSET 999` prune walk with bounded delete.           | scheduled                         |
| L9  | [7](phases/phase-7-memoization-and-hygiene.md)       | Drop redundant `chats` DELETE.                                 | scheduled                         |
| L10 | [2](phases/phase-2-server-load-narrowing.md)         | Load command-event history only when replay is requested.      | DONE (`b2765994`)                 |
| L11 | [5](phases/phase-5-materialization-and-lifecycle.md) | Add the `cleanedUp` guard before `memoryEvents.subscribe`.     | scheduled                         |
| L12 | [5](phases/phase-5-materialization-and-lifecycle.md) | Close the proxy WS viewer on already-done jobs.                | scheduled                         |
| L13 | [5](phases/phase-5-materialization-and-lifecycle.md) | Guard detached runners and cancel-persist on close.            | scheduled                         |
| L14 | [5](phases/phase-5-materialization-and-lifecycle.md) | Heartbeat the durable SSE viewer during long assembly.         | scheduled                         |
| L15 | [5](phases/phase-5-materialization-and-lifecycle.md) | Bound no-viewer proxy-job replay/buffer.                       | scheduled                         |
| L16 | [6](phases/phase-6-memory-and-lua.md)                | Skip empty orphan-cleanup write txn. [known-leftover]          | scheduled                         |
| L17 | [6](phases/phase-6-memory-and-lua.md)                | Bound per-chat memory batches for fairness.                    | scheduled                         |
| L18 | [6](phases/phase-6-memory-and-lua.md)                | Reuse the Phase 2 scoped/memoized loader in memory batches.    | scheduled (after Phase 2)         |
| L19 | [6](phases/phase-6-memory-and-lua.md)                | Aggregate Lua exec budget across hook phases. [known-leftover] | scheduled                         |
| L20 | [4](phases/phase-4-outbound-request-lifecycle.md)    | Thread request `AbortSignal` into the Lua runtime.             | DONE (`bf1a6cb2`)                 |
| L21 | [6](phases/phase-6-memory-and-lua.md)                | Reuse engine safely or cache compiled prelude.                 | scheduled                         |
| L22 | [4](phases/phase-4-outbound-request-lifecycle.md)    | Cap the streaming-provider SSE accumulation buffer.            | DONE (`bf1a6cb2`)                 |
| L23 | [4](phases/phase-4-outbound-request-lifecycle.md)    | Block embedded-private IPv6 forms. [known-leftover]            | DONE (`bf1a6cb2`)                 |
| L24 | [4](phases/phase-4-outbound-request-lifecycle.md)    | Reject prototype keys in `setObjectValue`.                     | DONE (`bf1a6cb2`)                 |
| L25 | [4](phases/phase-4-outbound-request-lifecycle.md)    | Count Lua egress only after URL validation.                    | DONE (`bf1a6cb2`)                 |
| L27 | [5](phases/phase-5-materialization-and-lifecycle.md) | Guard backup manifest `JSON.parse`.                            | scheduled                         |
| L28 | [5](phases/phase-5-materialization-and-lifecycle.md) | Make legacy restore re-import transactional.                   | scheduled                         |
| L29 | [5](phases/phase-5-materialization-and-lifecycle.md) | Persist writer-session origin on command events.               | scheduled                         |
| L30 | [5](phases/phase-5-materialization-and-lifecycle.md) | Re-arm reattach after completion.                              | scheduled                         |
| L31 | [3](phases/phase-3-client-clone-narrowing.md)        | Scope/throttle script-definition watcher scans.                | DONE (`0efa7ba6`)                 |
| L32 | [3](phases/phase-3-client-clone-narrowing.md)        | Scope lorebook-editor clone/id-assign. [known-leftover]        | DONE (`0efa7ba6` + L32 follow-up) |
| L33 | [3](phases/phase-3-client-clone-narrowing.md)        | Avoid modules-array deep clone in `$effect`.                   | DONE (`0efa7ba6`)                 |
| L34 | [3](phases/phase-3-client-clone-narrowing.md)        | Use a chat-scoped snapshot in `toggleSelectedChatModule`.      | DONE (`0efa7ba6`)                 |
| L35 | [3](phases/phase-3-client-clone-narrowing.md)        | Use a single-row snapshot in MCP `setCharacterInfo`.           | DONE (`0efa7ba6`)                 |
| L36 | [3](phases/phase-3-client-clone-narrowing.md)        | Surface runner rejections and roll back.                       | DONE (`0efa7ba6`)                 |
| L37 | [7](phases/phase-7-memoization-and-hygiene.md)       | Remove logs of full command/preset objects.                    | scheduled                         |
| L38 | [7](phases/phase-7-memoization-and-hygiene.md)       | Remove per-render `Trigger time` log.                          | scheduled                         |
| L39 | [7](phases/phase-7-memoization-and-hygiene.md)       | Scan transcript in place.                                      | scheduled                         |
| L40 | [7](phases/phase-7-memoization-and-hygiene.md)       | Memoize trigger-effect regex sites.                            | scheduled                         |

### Context-dependent

| ID  | Routing                                       | Note                                                                   |
| --- | --------------------------------------------- | ---------------------------------------------------------------------- |
| U1  | [2](phases/phase-2-server-load-narrowing.md)  | Bulk hydration known-id check. Folded into Phase 2: DONE (`b2765994`). |
| U4  | [3](phases/phase-3-client-clone-narrowing.md) | `setCurrentChat` scoped snapshot cleanup. DONE (`0efa7ba6`).           |
| U2  | gated                                         | Foreign `fields` re-stub; keep on `leftover.md` evidence gate.         |
| U3  | no action                                     | Session-bounded hydration id `Set`s; bounded and cleared on resync.    |

## Gated / Owner-Decision (not scheduled)

These are carried from the audit's [known-leftover] tags. Keep them gated on
`RISU_PROTOCOL_METRICS` evidence or an owner decision.

- L4 — targeted-assembly scriptstate persist rewrites the full characters
  table. Accepted breadth of the assembly persist; narrowing it is gated with
  the other Tier-5 write breadth.
- L7 — `POST characters`, `create-and-select`, `POST modules`,
  `DELETE modules/:id` full ~13-table rewrite. Explicitly maintainer-deferred
  after a frequency x cost review (`leftover.md`); `DELETE modules/:id` also
  carries the cross-table `removeModuleReferences` blocker.
- L26 — ordinary/bundle `.risu` export full materialization + extra
  JSON-clone+normalize. The streaming block-envelope writer is gated on large
  real-export evidence; the extra clone+normalize on export is a cheaper
  sub-win that _can_ be picked up opportunistically in Phase 5 if it proves
  free, but the streaming rewrite is out of scope.
- U2 — sprawling-resource full-bootstrap narrowing (see above).

Several scheduled lows also carry `[known-leftover]` (L3, L16, L19, L23, L32).
Those leftover notes describe broader work; the scheduled slices are smaller
self-host wins. Only L4, L7, L26, and U2 are fully gated.

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

Route the 57 confirmed findings plus U1/U4 across Phases 0-8. Of those, the
scheduled fix set excludes L4/L7/L26/U2 (gated) and U3 (no action). Phase 1
highs, Phase 2 server-root work, and Phase 3 client clone narrowing are done.
Every fix needs a regression test and Phase 8 gate entry.

## Investigated And Dismissed

Carried from the audit so future readers do not re-open them. All are verified
non-issues against current code:

- Inline continue/regenerate partial-text loss — unreachable; the real
  client always sends `durable:true` for server-dispatched continue/regenerate.
- Per-generation memory cosine-ranks all embeddings — false on the live
  route; `/generate/chat` passes empty query vectors, so the ranking loop never
  runs.
- Orphan cleanup cascade-deletes a shared chunk for another model —
  impossible by invariant (shared chunk ⇒ identical `chatMemos` ⇒ orphaned or
  kept together).
- `buildMemoryWindow` clones all characters — dead local-assembler path,
  already downgraded to inventory-only by the frontend-performance workstream.
- `addMetadataToElement` logs per render — dead code behind an
  `aiWatermarkingLawApplies()` stub hardcoded to `return false`.

## Non-Goals

- Do not change the projection/bootstrap/revision/event wire model, `.risu`
  envelope bytes, rendered output, or persisted state.
- Do not edit the broad SQLite loaders / full-collection snapshots out of
  existence — keep them for their genuine full-corpus consumers.
- Do not schedule the gated items (L4, L7, L26, U2) without evidence/owner sign-off.
- Do not re-open a dismissed candidate above.
