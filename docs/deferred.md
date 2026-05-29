# Deferred Items

Date: 2026-05-30

Items intentionally deferred — not blocked, just not being done yet. Each notes
what it is, why it's deferred, and what unblocks it.

## Durable generation — locate the `/chat` writer/423 gate

- **What:** find where `/api/v1/generate/chat` enforces the active-writer / 423 gate
  today, so durable generation's submission lock (Step 2) and server-owned result
  write (Step 3) can hook into it. A prior grep found no `activeWriter` enforcement
  in `server/fastify/src/routes/generationChat.ts` or
  `server/fastify/src/commands/mutations.ts`, so the gate's location must be found
  first.
- **Type:** a code-location lookup, not a design decision.
- **Why deferred (2026-05-30):** durable generation is sequenced after the pending
  client-thinning batches (provider-resolver unification → `useServerPromptAssembly`
  default-on); the gate lookup is only needed once durable-generation Step 2 starts.
- **Unblocks:** durable-generation Step 2
  (`durable-generation/steps/step-2-lifecycle-decoupling.md`) and Step 3 gotcha A
  (`durable-generation/steps/step-3-server-owned-result-persistence.md`).
