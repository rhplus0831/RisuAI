# Alternate-greeting delete and reorder bypass durable mutation recovery

- **Severity:** Medium
- **Affected surface:** `SIDE-07` (character alternate-greeting editor), with downstream `CHAT-05`/`CHAT-11` greeting selection
- **Primary locations:** `src/lib/SideBars/CharConfig.svelte:558-638,2353-2388`; `src/ts/server/characterBridge.svelte.ts:339-417`; `src/ts/server/pendingMutationOutbox.ts:134-163`

## Trigger

1. Delete an alternate greeting or move one up/down in Character settings.
2. While the dedicated command is in flight, make the command revision conflict or make the request temporarily unavailable.
3. Alternatively, close/reload the page before the non-durable request has reached Fastify.

## Expected behavior

Structural greeting edits should have the same crash/retry semantics as neighboring character-profile edits. The atomic character-plus-chat cascade should be staged before network dispatch, retained across transient failure/page exit, replayed in owner order, and identified to the UI as queued until accepted. A terminal rejection should roll back and report an error.

## Actual behavior

Delete/reorder optimistically changes both `characterDraft.value.alternateGreetings` and every resident chat's `fmIndex`, but dispatches the atomic Fastify command through bare `runServerCommand`. A conflict, unavailable response, or command-factory error invokes the rollback immediately. The greeting list and affected chats visibly revert, the user's intent is lost, and no error or queued state is shown because the promise is discarded with `void`.

Unlike ordinary edits to greeting text or other character fields, there is no encrypted outbox row to replay after a transient failure or page exit. If Fastify commits but the response is lost, the local rollback can temporarily disagree with SQLite until SSE/resource refresh restores the accepted cascade.

## Underlying cause

The dedicated cascade was added to preserve `fmIndex` references atomically, but it bypasses the migration's durable dispatch layer. `applyAlternateGreetingMutation` flushes older debounced character/chat patches, updates both projections, synchronizes their watcher baselines, and then calls `void runServerCommand(...)` directly (`CharConfig.svelte:568-637`).

The neighboring character bridge stages its PATCH intent with `stagePendingMutation` before the debounce and sends it with `dispatchDurableMutation` (`characterBridge.svelte.ts:339-399`). The durable-command allowlist permits `PATCH /characters/:id` but has no entry for `PATCH /characters/:id/alternate-greetings` (`pendingMutationOutbox.ts:134-163`), so the structural endpoint cannot simply reuse that recovery path without extending the allowlist and replay/local-effect handling.

## Affected data flow

1. Move/delete buttons call `applyAlternateGreetingMutation` (`CharConfig.svelte:558-568,2365-2385`).
2. `mutateAlternateGreetings` calculates the new array and remapped `fmIndex` for every chat. The component writes the result into the draft and live character projection, then advances both watcher baselines (`CharConfig.svelte:572-601`).
3. `mutateAlternateGreetingsCommand` sends `PATCH /api/v1/commands/characters/:characterId/alternate-greetings` with `baseRevision`, the new array, and the structural operation (`src/ts/server/commands.ts:3375-3389`). No durable handle, mutation receipt, or retained settlement is attached.
4. Fastify validates the operation against the current array length, transactionally rewrites all chat rows and the character row, and returns the revision, event, cascade certificate, and corrected chat indices (`server/fastify/src/commands/characters.ts:179-223`; `server/fastify/src/routes/commands.ts:5134-5187`).
5. On success, the client validates the certificate/indices and converts the response to a `characterPatch` local effect (`src/ts/server/commands.ts:8169-8192`); bootstrap advances the character-row projection revision (`src/ts/bootstrap.ts:799-807`). The already-painted chat indices remain the displayed state.
6. On any non-OK direct result, `executeServerCommand` invokes the rollback (`src/ts/server/commands.ts:5343-5376`). The rollback is value-aware, but only reverts the projections; no retained intent or user-facing outcome remains (`CharConfig.svelte:613-636`).

## User impact

A multi-chat structural edit appears to work and then silently snaps back during ordinary transient synchronization problems. Because it affects the greeting array and every referencing chat, users may repeat the operation or generate from a chat while unsure which greeting mapping the server retained.

## Recommended fix

- Add the exact `PATCH /characters/:id/alternate-greetings` shape to the durable allowlist and build a frozen `DurableMutationIntent` for the cascade.
- Stage the intent under the character-owner semantic key before painting the projection, with dependencies on flushed character/chat metadata predecessors, then dispatch it through `dispatchDurableMutation`.
- Preserve the current atomic Fastify route and certificate validation. For retryable/conflict outcomes, retain the optimistic projection and expose a queued state; for terminal rejection, run the existing value-aware rollback and show a localized error.
- Add tests for accepted, revision-conflict/retained, network-retained, terminal validation, and page-reload replay outcomes. Assert both greeting order and all chat `fmIndex` values in the UI and SQLite.
