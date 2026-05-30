# Phase 6: Durable Continue / Regenerate + Reroll Buffer

Date: 2026-05-30

Status: PLANNED. Needs Phase 3; best after Phase 4.

## Goal

Extend durability from `send` (Milestone 1) to `continue` and `regenerate`, so a
mid-generation disconnect loses nothing and no rerolled result is lost. Add a
chat-level reroll buffer.

Design detail:
[`../reference/durable-generation-modes.md`](../reference/durable-generation-modes.md).

## Background (current semantics)

- `resolveDurableGeneration` restricts durability to `send`
  (`src/ts/process/request/durableGeneration.ts`).
- **continue** appends to the last message: `streamResponse.ts:62-66` seeds
  `prefix` from the existing data; `nonStreamResponse.ts:86-89` computes
  `beforeChat.data + mess`. Also auto-triggered today via `evaluateAutoContinue`
  (`src/ts/process/autoContinue.ts`).
- **regenerate** replaces the **latest** assistant message (server-validated:
  "must be the latest assistant message", `server/fastify/src/prompt/assemble.ts`).
  Rerolled candidates today are transient, in-memory only
  (`src/ts/process/prereroll.ts`); `Message` has no persisted swipe field.

## Decisions (locked)

- **Remove auto-continue** (it is off by default — `autoContinueChat`,
  `autoContinueMinTokens`, `database.svelte.ts:568-569`). One user click = one
  append; the durable continue job never chains.
- **Shared staging primitive**: generation runs into a staging message keyed by
  `generationId`; one idempotent commit on success.
  - **continue** → commit = **replace target with the full extended text** (matches
    today's computed full text; idempotent on `generationId`).
  - **regenerate** → commit = add the candidate as an alternate row + make it active.
- **Reroll buffer on the `Chat`**, holding the inactive alternates (as flagged rows
  in the Phase 4 `messages` table). Persisted server-side → survives disconnect.
  **Cleared on `send`/`continue`** (the confirm boundary). **No order preservation**
  — the only guarantee is "no rerolled result is lost."
- **Navigation stays client-side**: active = the positioned `message[]` tail
  (durable for free because it is the persisted tail); flipping candidates is
  display state, persisted lazily on the next durable action.

## Changes

- Delete auto-continue (`autoContinue.ts`, the `status:'continue'` recursion in
  `index.svelte.ts:344-347`, the two settings, `usedContinueTokens`).
- Widen `resolveDurableGeneration` to `continue`/`regenerate`.
- Implement the `generationId`-keyed staging lifecycle + idempotent commits in the
  durable job (`generationChat.ts`).
- regenerate commit: insert the alternate row; flip the active tail. `send`/`continue`
  commit: delete the chat's alternate rows.
- Decide the prefetch buffer (`prereroll.ts`) relationship: persist pre-generated
  candidates into the alternate rows (consistent with "don't lose results") rather
  than keep them transient.

## Seams

- `server/fastify/src/routes/generationChat.ts`, `prompt/assemble.ts`.
- `src/ts/process/index.svelte.ts`, `request/durableGeneration.ts`,
  `postGeneration/{streamResponse,nonStreamResponse}.ts`, `prereroll.ts`,
  `autoContinue.ts`.

## Risks / landmines

- **Idempotency.** continue replace + regenerate alternate-insert must be no-ops on
  replay (keyed by `generationId`).
- One-job-per-chat lock already prevents a `send`-during-reroll race (`409`).
- Clear-on-`send`/`continue` must not race a running reroll job (the lock blocks it).

## Exit criteria

- A disconnect mid-continue or mid-reroll loses nothing; reload shows the active
  tail + the recoverable alternates.
- Auto-continue is gone; continue/regenerate run durably and idempotently.
