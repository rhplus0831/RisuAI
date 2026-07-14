# Latest Verification

Date: 2026-05-30

Batch: provider-resolver unification (decision #5) + `useServerPromptAssembly`
default flip (decision #1) — the two former closeout implementation
batches, landed together. Provider routing is now single-sourced in
[`../reference/provider-capability-table.md`](reference/provider-capability-table.md)
(`resolveProviderCapability`), consumed by both `serverCompletion.ts` (browser) and
`chatDispatch.ts` (server `/chat`); the stale `reverse_proxy` + `reverseProxyOobaMode`
`/chat` rejection is gone (the openai adapter applies `oobaSystemHoist`). The flag now
defaults `true`, so server prompt assembly is the supported default path and the
documented `unsupported` content classes hard-fail by default.

- `pnpm test` (client) — 83 files, 952 passed, 4 skipped. Incl. the new pure-table
  matrix `providerCapability.test.ts`, the browser `reverse_proxy` + ooba parity case
  in `serverCompletion.test.ts`, and the flag-off opt-out added to the server-backed
  *completion*-dispatch sweep in `sendChat.fixtures.serverBacked.test.ts` (the one
  describe that exercised local assembly under the old default-off).
- `pnpm api:test` (server) — 73 files, 1324 passed. Incl. the new
  `providerCapabilityRoute.test.ts` (ooba flip + preserved per-format messages +
  server-only unknown-id guard + ollama-cloud key gate); the ooba case was removed
  from `generation.chat.test.ts`'s unsupported list.
- `pnpm client-thinning:audit` — Passed (23 checks now, incl. the new
  `A4R-provider-capability shared routing table`).
- `pnpm exec vitest run util/client-thinning-audit.test.ts` — 58 tests passed (+3 for
  the new rule: failing-server-fork, keeps-helpers bypass, passing).

---

Prior batch: closeout-decision reflection (2026-05-30). Recorded the eight resolved
closeout decisions in the docs (canonical record:
[`../phases/phase-5-closeout.md`](phases/phase-5-closeout.md#closeout-decisions-2026-05-30))
and added the decision-#2 best-effort TODO at `generationChat.ts`
(`buildPostGenerationFrame` catch). No behavior change.

- `pnpm client-thinning:audit` — Passed.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts`
  — 51 tests passed.

---

Prior batch: group-chat legacy removal (dead `type === 'group'` UI branches + type
compatibility) plus its proof invariant.

- `pnpm client-thinning:audit` — Passed. Printed `Client-thinning audit passed.`
  (22 rules now, including the new `A4R-group-chat-removed`).
- `pnpm exec vitest run util/client-thinning-audit.test.ts` — 55 tests passed
  (was 52; +3 for the new rule: a failing UI-branch fixture, a keep-layers-removed
  bypass fixture, and the passing fixture).
- `pnpm check` (svelte-check) — 0 errors, 0 warnings across the project (the two
  edited Svelte files dropped dead branches and a vestigial `type` field).
- `pnpm test` (client) — 82 files, 899 passed, 4 skipped.

Not run this batch:

- `pnpm api:test` — no `server/fastify/**` files changed (group-chat removal is
  client-only), so the server suite is orthogonal; the last full server run (slice
  4) passed `pnpm api:test` (72 files, 1314 tests).

Context: client-only change. The two UI surfaces (`GridCatalog.svelte`,
`ChatList.svelte`) lost their dead group-chat branches; the load-time filter, the
server prompt-assembly group hard-fail, the `isGroupChat: false` request hardcode,
and `Message.saying` are all intentionally kept and are now structurally guarded by
the `A4R-group-chat-removed` invariant.
