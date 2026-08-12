# B — Transcript Mutation (CODEX track)

Compared current `HEAD` in `risuai-fastify` with the pinned original-Risu baseline at `/home/codex/risu-baseline-71c476e9c`, limited to the audit delta and the transcript-mutation scope in the brief. Intentional divergences and standing decisions were excluded unless the current code contradicted their recorded adjudication.

## B-1 — Buffered Continue in extend mode preserves the old row identity

- **Severity:** medium
- **Current behavior:** For buffered Continue with `continueDisposition === 'extend'`, the server replaces the target with `{ ...target, data }`, preserving its `chatId`, `time`, and other metadata (`server/fastify/src/prompt/assemble.ts:2721-2732`). The regression test explicitly expects the original `msg-char-1` identity to survive (`server/fastify/__tests__/generation.chat.test.ts:6394-6399`).
- **Baseline behavior:** Buffered Continue first moves the replacement index back to the existing assistant row, then assigns a newly constructed row with `time: Date.now()`, new generation metadata, and `chatId: generationId` (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1631-1657`). This happens independently of the say-nothing setting.
- **Consequence / repro:** Disable `useSayNothing`, select buffered generation, and Continue an existing assistant message. Current HEAD mutates the existing row in place; the baseline replaces it with a new row identity and timestamp. Identity-sensitive navigation, reconciliation, and export code can therefore observe different records for the same action.
- **Classification:** `candidate-fix`
- **Confidence:** high
- **Adjudication note:** This is eligible despite the prior exclusion: CA-OR-7 says the discrepancy was resolved by `8bf88e43c`, but both current source and its test still require the non-baseline identity-preserving behavior.

## B-2 — Buffered Continue runs `editoutput` once instead of the baseline's two passes

- **Severity:** medium
- **Current behavior:** Buffered post-generation calls `processScriptFull(..., 'editoutput')` once over the combined text; the source labels the single pass an accepted divergence (`server/fastify/src/prompt/assemble.ts:3114-3118`). The test likewise expects one stateful invocation (`server/fastify/__tests__/generation.chat.test.ts:6473-6532`).
- **Baseline behavior:** The buffered response is first passed through `editoutput`, then Continue concatenates the prior row and runs `editoutput` a second time over the combined text (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1631-1640`).
- **Consequence / repro:** Use a stateful Lua `editoutput` script that adds its invocation count, then run buffered Continue. The baseline persists the twice-processed result (for example, a final `[2]` marker), while current HEAD persists the once-processed result (`[1]`). This is a direct content divergence, not just an internal call-count difference.
- **Classification:** `candidate-fix`
- **Confidence:** high
- **Adjudication note:** CA-OR-8 says this was resolved by `8bf88e43c`; current source and the current regression test instead explicitly preserve the discrepancy, so that adjudication no longer matches HEAD.

## B-3 — Say-nothing streaming Continue has different live and durable transcript semantics

- **Severity:** high
- **Current behavior:** The server creates a transient user boundary containing `*says nothing*` (`server/fastify/src/prompt/assemble.ts:754-772`), but client streaming handles append-style Continue by creating a new assistant row whose visible stream starts at the completion, with browser-time metadata (`src/ts/process/postGeneration/streamResponse.ts:124-169`). Finalization instead combines the boundary and completion into a persisted assistant row with server-side generation metadata (`server/fastify/src/prompt/assemble.ts:3084-3126`). When post-generation does not otherwise change the text, the server omits `finalText` (`server/fastify/src/routes/generationChat.ts:2112-2140`), and the client retains the completion-only streamed text (`src/ts/process/serverBackedSendChat.ts:840-863`).
- **Baseline behavior:** The UI appends `*says nothing*` as a user row before generation (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:170-179`, `:207-213`). Streaming Continue targets that last row, uses its existing data as the prefix, and only mutates `.data`; it does not change the role or replace the row metadata (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1531-1538`, `:1582-1585`).
- **Consequence / repro:** Enable `useSayNothing`, Continue after an assistant row using a streaming provider, and let it return `B`. Current live state shows an assistant row `B`; reload shows a separately finalized assistant row `*says nothing*B`, potentially with a different timestamp. The baseline shows and retains a user row `*says nothing*B` with the boundary's original identity. A mid-stream cancellation preserves the same role/prefix/metadata split. This finding concerns row projection and identity, not the separately adjudicated raw-versus-processed cancellation output.
- **Classification:** `candidate-fix`
- **Confidence:** high

## B-4 — Say-nothing Continue loses its boundary on a pre-token failure or cancellation

- **Severity:** medium
- **Current behavior:** The transient say-nothing boundary is filtered from the durable submit snapshot (`server/fastify/src/prompt/assemble.ts:836-840`, `:1434-1437`). A provider error with no result only records failure (`server/fastify/src/routes/generationChat.ts:4687-4695`), and cancellation persistence is gated on non-empty accumulated output (`server/fastify/src/routes/generationChat.ts:4711-4716`). No transcript row is therefore persisted before the first token.
- **Baseline behavior:** The UI commits the user boundary before invoking generation (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:170-179`, `:207-213`). Request failure returns without removing it (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1524-1530`), and a stopped stream likewise returns without rolling it back (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1599-1600`).
- **Consequence / repro:** With `useSayNothing` enabled, Continue an assistant row and make the provider reject before producing a token, or press Stop before the first token. Current HEAD leaves the transcript unchanged; the baseline retains the user `*says nothing*` row. Retry context and the visible action history then differ.
- **Classification:** `candidate-fix`
- **Confidence:** high

## B-5 — Stop before operation acceptance can delete the newly sent user message

- **Severity:** high
- **Current behavior:** Atomic send stages an optimistic outbox row and records how to roll it back (`src/ts/server/generationOperations.ts:416-466`). The pending local operation is discoverable for Stop before server acceptance (`src/ts/server/generationOperations.ts:296-334`). A `cancelled_before_acceptance` acknowledgement rolls back that row (`src/ts/server/generationOperations.ts:1063-1091`). Server-side, early cancellation creates an unbound tombstone (`server/fastify/src/routes/generationOperations.ts:716-755`); a later submit binds to it without appending the input instead of taking the normal append path (`server/fastify/src/routes/generationOperations.ts:312-338`, `:390-406`). The durable test asserts zero appended messages for this race (`server/fastify/__tests__/durableGeneration.test.ts:1053-1095`).
- **Baseline behavior:** The UI appends the user row to the selected chat before generation starts (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:183-213`). The abort controller is created afterward, and aborting generation does not remove the input row (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:304-313`, `:330-333`).
- **Consequence / repro:** Delay or drop the operation submit after the optimistic row appears, then press Stop before the server accepts it. Current HEAD lets the cancellation tombstone win and removes/never appends the user's sent message; the baseline retains that message and only stops the response. This is user-authored transcript data loss relative to the baseline.
- **Classification:** `candidate-fix`
- **Confidence:** high

## B-6 — PO multisend selects the exact generated assistant instead of serializing the transcript tail

- **Severity:** medium
- **Current behavior:** PO multisend requires a uniquely accepted user row and an immediately adjacent assistant result, hydrating if necessary (`src/ts/process/files/multisend.ts:42-73`). It then serializes that exact assistant using the accepted message ID (`src/ts/process/files/multisend.ts:95-114`). If no qualifying result exists, it reports failure rather than exporting a substitute row.
- **Baseline behavior:** PO multisend appends the source user message, calls `sendChat`, and blindly serializes the final transcript row afterward (`/home/codex/risu-baseline-71c476e9c/src/ts/process/files/multisend.ts:41-57`).
- **Consequence / repro:** Let an output trigger append another row after the generated assistant. Current HEAD exports the generated assistant; the baseline exports the trigger-added tail. If generation fails, the baseline can serialize the just-added source/user row as `msgstr`, whereas current HEAD produces no translation result. The new behavior is safer, but byte-for-byte and failure behavior are not compatible.
- **Classification:** `candidate-keep`
- **Confidence:** high

## B-7 — PO multisend flushes an unterminated final entry and recognizes plural `Notes`

- **Severity:** low
- **Current behavior:** The parser recognizes both `Note` and `Notes`, uses a shared entry flush, and flushes once more at EOF (`src/ts/process/files/multisend.ts:27`, `:83-92`, `:122-169`).
- **Baseline behavior:** Entries flush only on a blank separator; there is no EOF flush (`/home/codex/risu-baseline-71c476e9c/src/ts/process/files/multisend.ts:66-68`, `:107-108`). Its recognition condition only accepts singular `#. Note =`, so plural `#. Notes =` is not treated as context (`/home/codex/risu-baseline-71c476e9c/src/ts/process/files/multisend.ts:25-29`).
- **Consequence / repro:** Import a PO file whose final entry has no following blank line and contains `#. Notes = context`. Current HEAD includes the note as prompt context and generates/serializes the final entry. The baseline treats the plural note differently and never processes the unterminated last entry. This appears to be a deliberate parser correctness improvement.
- **Classification:** `candidate-keep`
- **Confidence:** high

## B-8 — Reroll history is chat-scoped instead of character-scoped

- **Severity:** high
- **Current behavior:** Reroll state keys include both character and chat IDs and all reset, record, reroll, and un-reroll operations use that exact key (`src/ts/process/rerollNavigation.svelte.ts:75-127`, `:152-186`, `:399-467`).
- **Baseline behavior:** The shared reroll buffer resets only when `selectedCharID` changes; switching between chats belonging to the same character retains the buffer. Reroll then applies buffered rows to whichever chat is currently selected (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:217-270`).
- **Consequence / repro:** Build multiple reroll candidates in Chat A, select an older candidate, switch to Chat B for the same character, then invoke reroll/un-reroll. The baseline can splice Chat A's buffered tail into Chat B. Current HEAD keeps Chat B independent. This is a compatibility delta with severe baseline behavior, but retaining current chat isolation is the safer outcome.
- **Classification:** `candidate-keep`
- **Confidence:** high

## B-9 — Sends in different chats can run concurrently

- **Severity:** medium
- **Current behavior:** Activity and cancellation ownership are derived for the currently selected chat (`src/lib/ChatScreens/DefaultChatScreen.svelte:387-427`), and send is blocked only if that chat owns or is preparing a generation (`src/lib/ChatScreens/DefaultChatScreen.svelte:1579-1593`). A second chat can therefore append and generate while the first chat is active.
- **Baseline behavior:** Send immediately returns whenever the global `$doingChat` flag is set (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:143-147`); generation manages that single global busy state (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:180-187`).
- **Consequence / repro:** Start a slow generation in Chat A, navigate to Chat B, and send before A finishes. Current HEAD durably appends and generates B concurrently; the baseline ignores the second send. Current behavior enables intentional cross-chat multitasking, but it is not exact baseline behavior and should receive explicit compatibility sign-off.
- **Classification:** `candidate-keep`
- **Confidence:** high

## Areas swept clean

- **Ordinary successful send:** The current server preserves the baseline-relevant input-trigger/edit-input/run-variable ordering and persists the supplied accepted user row rather than fabricating an additional one (`server/fastify/src/prompt/assemble.ts:1088-1164`, `:2437-2451`; `server/fastify/src/routes/generationOperations.ts:388-427`). No additional delta-scoped row-order, row-ID, or metadata mismatch was found outside B-5's pre-acceptance cancellation race.
- **Streaming Continue without say-nothing:** Extend-style streaming mutates the prior assistant target in place; no additional delta-scoped persisted-row mismatch was found.
- **Buffered Continue with say-nothing:** Apart from B-2's processing count, the new assistant row's role and generation identity match the baseline buffered replacement shape.
- **Regenerate, recovery, and idempotence:** The ordinary regenerate target replacement, stale-operation fences, final projection, retry, and cleanup-pending paths did not reveal another duplicate or missing active transcript row. Ledger lifecycle states alone do not project transcript rows.
- **Reroll lifecycle:** Send/Continue confirmation clears the relevant current reroll state, and failed/stale projections did not reveal another delta-scoped transcript mutation beyond B-8's scope change.
- **Multisend:** Primary result serialization and processed-entry quoting were otherwise unchanged; the material deltas found are B-6 and B-7.
- **Excluded by the audit contract:** Standing group-generation decisions and already-adjudicated raw/processed cancellation, post-token failure restoration, primary-result fallback, banned/blank buffering, isolated multigen state, and auto-Continue removal were not re-reported because their recorded status still matches the inspected code.

## Unverified boundary

- The browser bootstrap parser does not visibly copy `continueDisposition` in `src/ts/server/bootstrap.ts:716-745`, while the server job projection includes it (`server/fastify/src/generationJobs.ts:114-137`). Durable replay makes the generation info event essential before transcript projection (`server/fastify/src/streamJobs.ts:119`), so source inspection did not establish a user-visible divergence; a reconnect exactly across that event remains a targeted test gap.
- No destructive crash/fault-injection run was performed under the report-only write constraint. Crash/restart conclusions above are based on source paths and existing regression tests, so unusual storage faults outside those covered states remain unverified.
