# Audit scope: Writer coordination & the mutation outbox

Status: DRAFT 2026-07-23 — items tagged `UNVERIFIED` are being re-checked by
the data-loss residual verification pass.

## Charter

**In scope:** the single-writer lease (bootstrap registration, takeover, SSE
`writer` frames), the lost-writer latch, the encrypted pending-mutation outbox
(staging, replay, settlement, scoping), offline mode, and multi-tab /
multi-session interactions.

**Out of scope:** what the mutations themselves do (other scopes); SSE
transport liveness (see [sync-hydration.md](sync-hydration.md)).

Key code: `src/ts/server/activeWriterSession.ts`,
`src/ts/server/pendingMutationOutbox.ts`, `server/fastify/src/routes/bootstrap.ts`
(lease registration), `server/fastify/src/routes/events.ts` (writer frames).

## Issue history

This scope produced the single worst silent-loss bug found outside the
data-loss audit: **writer takeover silently dropped all mutations** while the
takeover dialog was unanswered (confirmed 2026-07-21, fixed 2026-07-22 in
`6a0b6c0b2`). Mechanism worth remembering because each step was individually
reasonable: any bootstrap re-registers the caller as writer → SSE writer frame
latches `writerAccessLost` *before* the user answers the dialog → the dialog
overlay didn't block pointer events → latched state made every write silently
local-only while the UI showed success. The fix made the dialog modal, made
latched writes fail loudly, and retained stale-writer intents.

Related fixes in the same window: `a0bb40e20` (bridge intent cleanup rekeyed
from epoch advance to exact mutation settlement), `30fda53fd`
(foreign-session outbox rows dormant instead of deleted), `99ace5424`
(refresh-or-offline dialog instead of forced reload), `6bc1f3bdf` (test suites
broken by the latch — see invariants).

**Recurring patterns here:** state latched before user consent; silent
local-only fallback presenting as success; cleanup keyed to a coarser event
(epoch advance) than the thing it cleans up (a specific mutation); foreign/
stale rows deleted when they should be retained dormant.

## Open items

- `VERIFIED-OPEN` (2026-07-23) **E-6 (cross-tab variant)** — same-session
  cross-tab order-reservation race: staging passes a separately reserved
  order promise into persistence
  (`src/ts/server/pendingMutationOutbox.ts:630`); the auto-increment
  reservation commits in one transaction (`:1870`) while the encrypted row
  inserts later in another (`:1072`, `:1091`). Another tab can reserve and
  durably dispatch the newer absolute value while the older reservation has
  no visible row yet; the older row can then appear and replay. Single-tab
  variant fixed in `6a0b6c0b2`.
- `ACCEPTED` — lost-writer recovery is reload-only in production (no un-latch
  API). Revisit only if reload-only recovery generates real complaints.

## Verified safe — do not re-audit

Initialize race and receipt-ACK sequencing (2026-07-21 audit). The takeover
dialog modality and loud latched-write failure have regression tests from
`6a0b6c0b2`.

## Invariants for new code

- Outbox rows are scoped by `(writerSessionId, databaseLineage)`; **epoch is
  not a disposal key**. Foreign-session same-lineage rows go dormant, never
  deleted.
- `acknowledgePendingMutation` **is** `discardPendingMutation`; only exact
  mutation-ID settlement may trigger it outside explicit user cancellation.
- Outbox envelopes carry `keyKind: 'subtle' | 'raw'` (absent = legacy subtle).
  A record whose crypto scheme is unusable in the current environment must
  stay retained and warned about — never silently discarded — to keep the
  bootstrap gate truthful.
- The latch is process-global with no production reset: any test simulating a
  423 must call `resetWriterAccessLostForTests()` in `beforeEach`, and mocks
  of `activeWriterSession` must export `isWriterAccessLost`.
- Dev gotcha: `dev:human` and `dev:agent` share `./data`; an agent bootstrap
  steals the user's lease, and tsx-watch restarts re-deliver the latching
  frame on SSE reconnect.

## Sources

Memory: `writer-takeover-silent-mutation-drop`,
`writer-latch-process-global-test-reset`, `data-loss-audit-2026-07-21`
(E-findings), `insecure-origin-webcrypto-fallback` (keyKind rules). Archive:
`.archived-docs/protocol-and-persistence/writer-takeover-offline-mode-2026-07-21.md`.
