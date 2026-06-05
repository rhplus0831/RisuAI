# Active Risk Analysis

Date: 2026-06-05

This file maps every confirmed audit finding to a phase, target fix, and
status. Evidence lives in
[`audit-stability-and-performance.md`](audit-stability-and-performance.md).
Proof runs live in [`latest-verification.md`](latest-verification.md).

## Summary

- Confirmed findings: 57 total: 3 high, 14 medium, 40 low.
- Scheduled fixes are complete. H1-H3, M1-M14, L1-L3, L5-L25, L27-L40,
  U1, and U4 are `DONE`.
- Gated items: L4, L7, L26, U2.
- No-action item: U3.
- Dismissed candidates: R1-R5, listed below so they are not rediscovered.

Root routing:

- Root 1 -> Phase 2: server broad-load narrowing.
- Root 2 -> Phase 3: client clone narrowing.
- Root 3 -> Phase 1: streaming render coalescing.
- Root 4 -> Phase 4: outbound request lifecycle.
- Root 5 -> Phase 5: materialization and lifecycle.
- Phase 0 supplied foundations. Phase 8 supplies the standing gate.

Principle: narrow hot-path work or add a preventive bound. Preserve protocol,
rollback scope, output bytes, and broad paths for true full-corpus consumers.

## Finding -> Phase Map

Keep these tables machine-readable. The Phase 8 gate parses `| ID | ... |`
rows and the `DONE` marker.

### High

| ID  | Phase                                          | Target fix                                            | Status            |
| --- | ---------------------------------------------- | ----------------------------------------------------- | ----------------- |
| H1  | [1](phases/phase-1-high-severity-hot-paths.md) | `loadChatHydration` guard on `message.length > 0`.    | DONE (`0dc7452e`) |
| H2  | [1](phases/phase-1-high-severity-hot-paths.md) | Scalar `ChatSelectionSnapshot` for `changeChatTo`.    | DONE (`067ab82a`) |
| H3  | [1](phases/phase-1-high-severity-hot-paths.md) | Coalesce token-driven renders; final flush on `done`. | DONE (`e41dc6c6`) |

### Medium

| ID  | Phase                                                | Target fix                                                      | Status            |
| --- | ---------------------------------------------------- | --------------------------------------------------------------- | ----------------- |
| M1  | [2](phases/phase-2-server-load-narrowing.md)         | Scoped target-chat message/hypa load.                           | DONE (`c193c008`) |
| M2  | [7](phases/phase-7-memoization-and-hygiene.md)       | Hoist module/script/RegExp work once per assembly.              | DONE (`151c6978`) |
| M3  | [2](phases/phase-2-server-load-narrowing.md)         | Field-scoped command reads or per-request load memo.            | DONE (`e0e86ab1`) |
| M4  | [2](phases/phase-2-server-load-narrowing.md)         | Single-row `loadSingleCharacterRow`; in-place mask where owned. | DONE (`254b3112`) |
| M5  | [2](phases/phase-2-server-load-narrowing.md)         | Defer `jsonPayloadBytes` until metrics are enabled.             | DONE (`b2765994`) |
| M6  | [4](phases/phase-4-outbound-request-lifecycle.md)    | Abort proxy `/fetch` upstream on close; add timeout backstop.   | DONE (`bf1a6cb2`) |
| M7  | [6](phases/phase-6-memory-and-lua.md)                | Cap embed batches; split contextual requests by token size.     | DONE (`ca798c01`) |
| M8  | [4](phases/phase-4-outbound-request-lifecycle.md)    | Add non-durable provider deadline and body cap.                 | DONE (`bf1a6cb2`) |
| M9  | [5](phases/phase-5-materialization-and-lifecycle.md) | Streaming bounded inflate per envelope/block.                   | DONE (`686220d6`) |
| M10 | [5](phases/phase-5-materialization-and-lifecycle.md) | Token-only asset scan; defer import asset report.               | DONE (`686220d6`) |
| M11 | [5](phases/phase-5-materialization-and-lifecycle.md) | Settle bundle-export drain wait on `close`/`error`.             | DONE (`686220d6`) |
| M12 | [3](phases/phase-3-client-clone-narrowing.md)        | Drop redundant `setDatabase(db)` in `/setvar`/`/addvar`.        | DONE (`0efa7ba6`) |
| M13 | [3](phases/phase-3-client-clone-narrowing.md)        | Clone only kept character fields.                               | DONE (`0efa7ba6`) |
| M14 | [3](phases/phase-3-client-clone-narrowing.md)        | Use `currentCharacterRowSnapshot` in send context.              | DONE (`0efa7ba6`) |

### Low

| ID  | Phase                                                | Target fix                                                     | Status                            |
| --- | ---------------------------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| L1  | [2](phases/phase-2-server-load-narrowing.md)         | Memoize `getActiveModules` per assembly.                       | DONE (`c193c008`)                 |
| L2  | [2](phases/phase-2-server-load-narrowing.md)         | Hoist invariant run-var expansion.                             | DONE (`c193c008`)                 |
| L3  | [7](phases/phase-7-memoization-and-hygiene.md)       | Hoist/compile lorebook keyword regexes.                        | DONE (`151c6978`)                 |
| L5  | [2](phases/phase-2-server-load-narrowing.md)         | Skip asset scan when mutation does not read assets.            | DONE (`e0e86ab1`)                 |
| L6  | [2](phases/phase-2-server-load-narrowing.md)         | Narrow message-only character/chat lookup.                     | DONE (`e0e86ab1`)                 |
| L8  | [7](phases/phase-7-memoization-and-hygiene.md)       | Replace `OFFSET 999` prune walk with bounded delete.           | DONE (`151c6978`)                 |
| L9  | [7](phases/phase-7-memoization-and-hygiene.md)       | Drop redundant `chats` DELETE.                                 | DONE (`151c6978`)                 |
| L10 | [2](phases/phase-2-server-load-narrowing.md)         | Load command-event history only when replay is requested.      | DONE (`b2765994`)                 |
| L11 | [5](phases/phase-5-materialization-and-lifecycle.md) | Add `cleanedUp` guard before `memoryEvents.subscribe`.         | DONE (`686220d6`)                 |
| L12 | [5](phases/phase-5-materialization-and-lifecycle.md) | Close proxy WS viewer on already-done jobs.                    | DONE (`686220d6`)                 |
| L13 | [5](phases/phase-5-materialization-and-lifecycle.md) | Guard detached runners and cancel-persist on close.            | DONE (`686220d6`)                 |
| L14 | [5](phases/phase-5-materialization-and-lifecycle.md) | Heartbeat durable SSE viewer during long assembly.             | DONE (`686220d6`)                 |
| L15 | [5](phases/phase-5-materialization-and-lifecycle.md) | Bound no-viewer proxy-job replay/buffer.                       | DONE (`686220d6`)                 |
| L16 | [6](phases/phase-6-memory-and-lua.md)                | Skip empty orphan-cleanup write txn.                           | DONE (`ca798c01`)                 |
| L17 | [6](phases/phase-6-memory-and-lua.md)                | Bound per-chat memory batches for fairness.                    | DONE (`ca798c01`)                 |
| L18 | [6](phases/phase-6-memory-and-lua.md)                | Reuse scoped/memoized loader in memory batches.                | DONE (`ca798c01`)                 |
| L19 | [6](phases/phase-6-memory-and-lua.md)                | Aggregate Lua exec budget across hook phases.                  | DONE (`ca798c01`)                 |
| L20 | [4](phases/phase-4-outbound-request-lifecycle.md)    | Thread request `AbortSignal` into the Lua runtime.             | DONE (`bf1a6cb2`)                 |
| L21 | [6](phases/phase-6-memory-and-lua.md)                | Reuse engine safely or cache compiled prelude.                 | DONE (`ca798c01`)                 |
| L22 | [4](phases/phase-4-outbound-request-lifecycle.md)    | Cap streaming-provider SSE accumulation buffer.                | DONE (`bf1a6cb2`)                 |
| L23 | [4](phases/phase-4-outbound-request-lifecycle.md)    | Block embedded-private IPv6 forms.                             | DONE (`bf1a6cb2`)                 |
| L24 | [4](phases/phase-4-outbound-request-lifecycle.md)    | Reject prototype keys in `setObjectValue`.                     | DONE (`bf1a6cb2`)                 |
| L25 | [4](phases/phase-4-outbound-request-lifecycle.md)    | Count Lua egress only after URL validation.                    | DONE (`bf1a6cb2`)                 |
| L27 | [5](phases/phase-5-materialization-and-lifecycle.md) | Guard backup manifest `JSON.parse`.                            | DONE (`686220d6`)                 |
| L28 | [5](phases/phase-5-materialization-and-lifecycle.md) | Make legacy restore re-import transactional.                   | DONE (`686220d6`)                 |
| L29 | [5](phases/phase-5-materialization-and-lifecycle.md) | Persist writer-session origin on command events.               | DONE (`686220d6`)                 |
| L30 | [5](phases/phase-5-materialization-and-lifecycle.md) | Re-arm reattach after completion.                              | DONE (`686220d6`)                 |
| L31 | [3](phases/phase-3-client-clone-narrowing.md)        | Scope/throttle script-definition watcher scans.                | DONE (`0efa7ba6`)                 |
| L32 | [3](phases/phase-3-client-clone-narrowing.md)        | Scope lorebook-editor clone/id-assign.                         | DONE (`0efa7ba6` + follow-up)     |
| L33 | [3](phases/phase-3-client-clone-narrowing.md)        | Avoid modules-array deep clone in `$effect`.                   | DONE (`0efa7ba6`)                 |
| L34 | [3](phases/phase-3-client-clone-narrowing.md)        | Use chat-scoped snapshot in `toggleSelectedChatModule`.        | DONE (`0efa7ba6`)                 |
| L35 | [3](phases/phase-3-client-clone-narrowing.md)        | Use single-row snapshot in MCP `setCharacterInfo`.             | DONE (`0efa7ba6`)                 |
| L36 | [3](phases/phase-3-client-clone-narrowing.md)        | Surface runner rejections and roll back.                       | DONE (`0efa7ba6`)                 |
| L37 | [7](phases/phase-7-memoization-and-hygiene.md)       | Remove logs of full command/preset objects.                    | DONE (`151c6978`)                 |
| L38 | [7](phases/phase-7-memoization-and-hygiene.md)       | Remove per-render `Trigger time` log.                          | DONE (`151c6978`)                 |
| L39 | [7](phases/phase-7-memoization-and-hygiene.md)       | Scan transcript in place.                                      | DONE (`151c6978`)                 |
| L40 | [7](phases/phase-7-memoization-and-hygiene.md)       | Memoize trigger-effect regex sites.                            | DONE (`151c6978`)                 |

### Context-Dependent

| ID  | Routing                                       | Note                                                           |
| --- | --------------------------------------------- | -------------------------------------------------------------- |
| U1  | [2](phases/phase-2-server-load-narrowing.md)  | Bulk hydration known-id check. DONE (`b2765994`).              |
| U4  | [3](phases/phase-3-client-clone-narrowing.md) | `setCurrentChat` scoped snapshot cleanup. DONE (`0efa7ba6`).   |
| U2  | gated                                         | Foreign `fields` re-stub; keep on `leftover.md` evidence gate. |
| U3  | no action                                     | Hydration ID sets are bounded and cleared on resync.           |

## Gated / Owner-Decision

Keep these gated on `RISU_PROTOCOL_METRICS` evidence or owner approval.

- L4 - targeted-assembly scriptstate persist rewrites the full characters table.
  This is accepted assembly-persist breadth unless evidence says otherwise.
- L7 - four create/delete routes still do a full 13-table rewrite for a
  single-row change. Maintainers deferred it after frequency x cost review.
  `DELETE modules/:id` also has the cross-table `removeModuleReferences`
  blocker.
- L26 - ordinary and bundle `.risu` export still materialize the full corpus and
  extra clone/normalize before encoding. Streaming block-envelope writing needs
  large real-export evidence.
- U2 - sprawling-resource full-bootstrap narrowing.

L3, L16, L19, L23, and L32 also had `[known-leftover]` notes in the audit.
Their scheduled sub-wins are done; only L4, L7, L26, and U2 remain fully gated.

## Source Anchors

- Server load/clone: `server/fastify/src/repository.ts`,
  `messageStore.ts`, `commands/mutations.ts`, `routes/projection.ts`,
  `routes/generationChat.ts`, `assetGc.ts`, `risuSave/*.ts`.
- Client clones/watchers: `src/ts/chatCommands.ts`,
  `characterCommands.ts`, `globalApi.svelte.ts`, `process/sendChatContext.ts`,
  `process/command.ts`, `moduleCommands.ts`, `storage/database.svelte.ts`,
  `server/*Bridge.svelte.ts`.
- Streaming: `src/lib/ChatScreens/Chat.svelte`, `ChatBody.svelte`,
  `parser/parser.svelte.ts`, `process/postGeneration/streamResponse.ts`,
  `process/request/serverChat.ts`, `server/.../routes/generation.ts`.
- Outbound/egress: `routes/proxy.ts`, `proxy.ts`, `generation/*.ts`,
  `prompt/luaRuntime.ts`, `generation/additionalParams.ts`.
- Reference templates: `c9e728b1` for scalar snapshots and
  `getChatMessagesGroupedByIds` for scoped loaders.

## Dismissed Candidates

These were investigated and verified as non-issues against current code:

- Inline continue/regenerate partial-text loss: unreachable; server-dispatched
  continue/regenerate always sends `durable:true`.
- Per-generation memory cosine-ranks all embeddings: false on the live route;
  `/generate/chat` passes empty query vectors.
- Orphan cleanup cascade-deletes a shared chunk for another model: impossible by
  invariant. Shared chunks are orphaned or kept together.
- `buildMemoryWindow` clones all characters: dead local-assembler path.
- `addMetadataToElement` logs per render: dead code behind
  `aiWatermarkingLawApplies()`.

## Non-Goals

- Do not change projection/bootstrap/revision/event wire model, `.risu` bytes,
  rendered output, or persisted state.
- Do not remove broad SQLite loaders or full-collection snapshots. Keep them for
  true full-corpus consumers.
- Do not schedule L4, L7, L26, or U2 without evidence or owner approval.
- Do not re-open dismissed candidates without new evidence.
