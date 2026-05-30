# Reference: Durable Generation Modes

Date: 2026-05-30

Backs Phase 6. The staging primitive, continue (extend), and regenerate + the
chat-level reroll buffer.

## Current semantics

- Durability is `send`-only (`src/ts/process/request/durableGeneration.ts`).
- **continue** appends to the last assistant message: `streamResponse.ts:62-66`
  (`msgIndex -= 1`, `prefix = message[msgIndex].data`) and `nonStreamResponse.ts:86-89`
  (`beforeChat.data + mess`). Also **auto-triggered** by `evaluateAutoContinue`
  (`src/ts/process/autoContinue.ts`), so one send can fan out into several appends.
- **regenerate** replaces the **latest** assistant message — server-validated
  ("must be the latest assistant message", `server/fastify/src/prompt/assemble.ts`).
  Candidates are transient, in-memory only (`src/ts/process/prereroll.ts`:
  `addRerolls`/`Prereroll`/`PreUnreroll`); `Message` has **no** persisted swipe
  field.

## The shared primitive

Generation runs into a **staging message keyed by `generationId`**; on success,
**one idempotent commit**. continue and regenerate share this machinery and differ
only in assembly mode and commit disposition.

- **Idempotency** is on `generationId`: a reattach/replay re-commit is a no-op.
- This mirrors the durable `send` pattern already in place
  (`persistDurableGenerationResult`, `server/fastify/src/routes/generationChat.ts:756`).

## continue

- **Remove auto-continue** (off by default: `autoContinueChat`,
  `autoContinueMinTokens`, `src/ts/storage/database.svelte.ts:568-569`; recursion at
  `index.svelte.ts:344-347`). One click = one append → the durable job never chains.
- **Commit = replace target with the full extended text.** The code already
  computes the full text (`beforeChat.data + mess`); replacing the target message's
  `data` with it, keyed by `generationId`, is idempotent and matches today's
  behavior. ("Append new tokens only" would need extra bookkeeping for no gain.)

## regenerate + reroll buffer

- **Reroll buffer lives on the `Chat`** (Decision 3 → chat-level, not per-`Message`),
  realized as **alternate rows** in the Phase 4 `messages` table (flagged, no active
  `seq`), belonging to the chat. Persisted server-side → survives disconnect.
- **Active = the positioned `message[]` tail; alternates = the flagged rows.** No
  separate active-index needed (active is whatever is positioned).
- **Commit (regenerate)** = insert the new candidate as an alternate row and flip
  the active tail — idempotent on `generationId`.
- **Cleared on `send`/`continue`** (the confirm boundary): delete the chat's
  alternate rows. Bounded growth; **no per-message swipe history**.
- **No order preservation.** The only guarantee is that no rerolled result is lost
  while the buffer is live.
- **Navigation stays client-side.** Flipping candidates is display state; the active
  selection is durable for free because it is the persisted tail; persist a swap
  lazily on the next durable action.
- **Prefetch.** The transient multi-candidate prefetch (`prereroll.ts`,
  `mrerolls`) persists into the alternate rows rather than staying in-memory —
  consistent with "don't lose results."

## Safety

- The one-job-per-chat lock (durable-gen Milestone 1) already prevents a
  `send`-during-reroll race (`409`), so clear-on-`send`/`continue` never races a
  running reroll job.
- continue replace + regenerate alternate-insert must both be replay-idempotent on
  `generationId`.
