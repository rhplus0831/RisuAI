# Deferred Items

Date: 2026-05-30

Items intentionally deferred or still ambiguous. Each notes what it is, why it is
not being done yet, and what would make it actionable.

## Resolved During This Audit

- **Durable generation `/chat` writer/423 gate location:** no longer deferred.
  The gate is the global active-writer `preHandler` in
  `server/fastify/src/activeWriter.ts`; `isServerOwnedMutation()` includes
  `POST /api/v1/generate/chat` and `/api/v1/generate/preview-prompt`.

## Remaining Ambiguous / Deferred Tasks

- **Durable-generation post-gen failure policy.** Step 3 must decide what a
  detached durable job does if `runServerPostGeneration` throws: persist raw
  provider text with a warning, or record a job error for reattach/bootstrap.
  Current connected `/generate/chat` behavior is best-effort/no fallback, but a
  disconnected durable result needs an explicit policy.
- **Durable-generation modes beyond `send`.** Milestone 1 is send-only. Widening to
  `continue` or `regenerate` needs idempotency, append/replace semantics, and proof
  before those modes become durable.
- **Durable-generation transient projection.** Step 2 now names
  `activeGenerationJobs: Array<{ chatId: string; jobId: string }>` as the bootstrap
  wire shape for reload-resume. Implementation must add that shape to the server and
  client projection contracts and prove it does not persist in `db.json`.
- **Event patching contract.** Per-event surgical projection patching remains
  deferred until SSE reconnect/replay semantics are specified and tested
  (`Last-Event-ID` or an equivalent read/replay endpoint).
- **Group-chat residual cleanup.** The UI branches are removed; decisions #3/#4
  keep `Message.saying` and the load-time filter. The remaining cleanup scope is the
  stale `removeFromGroup` language key plus the `cbs.ts` / `risuai.d.ts` group-chat
  comments, with proof that no live behavior changes.
- **Additional audit-rule hardening.** The known defeated rules are hardened.
  Further string/regex rules become work only after a sincere defeat is demonstrated
  against the real audit binary.
- **Vite dev Fastify marker.** `pnpm dev` proxies `/api` but does not inject
  `globalThis.__FASTIFY__`; decide separately whether true Fastify-backed dev mode
  needs a documented build/serve flow or a dev-time marker injection.
