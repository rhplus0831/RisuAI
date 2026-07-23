# Audit scope: Performance, stability & transfer size

Status: DRAFT 2026-07-23 — the transfer-size section is being re-verified by
a dedicated Codex pass (its 29 findings were never re-checked after 2026-06-13).

## Charter

**In scope:** runtime performance and stability regressions (client and
server), network transfer efficiency (over-transmission in either
direction), and developer-loop performance (test suite).

**Out of scope:** functional correctness (other scopes). This scope audits
cost, not behavior.

## Issue history

- **Stability/perf audits v1–v4** (2026-06-05/08): 102 + 89 + 75 findings
  across v2–v4, all executed/folded and CLOSED. Archived at
  `.archived-docs/performance-and-stability/stability-audits/`. Each
  version's dismissed/refuted IDs live in its `active-risk-analysis.md` —
  **must not be re-opened**.
- **Transfer-size audit** (2026-06-13): 29 findings (H1–H3, M1–M4, L1–L22)
  at `.archived-docs/protocol-and-persistence/server-client-protocol/audits/network-transfer-size.md`.
  Cross-cutting themes: whole-collection replace on single edit, heavy
  bootstrap collections never read on load, SSE prompt/done duplicate
  fields, base64-in-JSON for binary, dead content-addressed dedup.
- **Frontend clone narrowing** (2026-06-04) and one-off regressions since
  (regex slowdown `7c6abf995`; char-select JSON deep-clone on hot paths).
- **Test-suite profile** (2026-07-22): threads pool landed (2m05s→1m45s);
  ~95% of CPU is per-file re-import of the 121-module core SCC.

## Open items

**Transfer-size findings re-verified 2026-07-23** (dedicated Codex pass
against HEAD `88066c2a8`): **21 of 29 REMEDIATED — including all three highs
and all four mediums** (H1 bootstrap no longer carries the database at all;
H2 tail-suffix commands; H3 sparse lorebook upsert/delete/reorder; M3+L8
`/assets/exists` probe + raw-binary bulk upload; M4+L21 binary WS frames +
`perMessageDeflate`; the memory-job family L9–L12). Full per-ID table with
evidence and fixing commits:
[transfer-size-reverification-2026-07-23.md](transfer-size-reverification-2026-07-23.md).
What remains:

- `VERIFIED-OPEN` **L13** — memory events broadcast to every SSE client, no
  chat/interest filtering (`server/fastify/src/memoryEvents.ts:44`,
  `routes/events.ts:176`).
- `VERIFIED-OPEN` **L14** — memory chunk/summary reads unbounded, no
  cursor/limit (`routes/memoryReads.ts:46`, `:56`); workload-dependent —
  current Hypa UI loads all summaries anyway; pagination is hardening for
  very large histories.
- `VERIFIED-OPEN` **L15** — SSE stream uncompressed (route hijacks the reply
  and raw-writes, bypassing Fastify compression, `routes/events.ts:73`,
  `:147`).
- `VERIFIED-OPEN` **L16** — command SSE frames carry
  `origin.writerSessionId`; note the field is *used* for own-echo detection
  (`src/ts/bootstrap.ts:1847`) — removing it requires a different own-echo
  protocol, so this is arguably ACCEPTED-shaped.
- `VERIFIED-OPEN` **L18** — bulk endpoints unbounded (`readBulkIds` has no
  max, `routes/resourceReads.ts:989`; `ensureAllChatsHydrated` sends every
  unhydrated chat in one request).
- `VERIFIED-OPEN` **L20** — realm import progress repeats
  `phase`/`message`/`percent` on every frame (`routes/realmImport.ts:1790`;
  client requires all three, so a delta format needs both sides).
- `PARTIAL` **L2** — full-bootstrap recovery reframed: the database-bearing
  bootstrap is gone and most large bodies are hash-substituted, but
  replay-gap recovery still refreshes all four resource groups
  (`src/ts/server/resourceInvalidation.ts:207`); no changes-since delta.
- `PARTIAL`→likely `ACCEPTED` **L5** — inline streams omit the duplicate
  terminal `done.result`; durable streams retain it deliberately (replay/
  reattach needs a self-contained final result,
  `serverChatEvents.ts:267`).
- `EVIDENCE-GATED` (all four; metrics tooling live, `RISU_PROTOCOL_METRICS=1`
  + `pnpm analyze:db`) — prompt-construction narrowing, sprawling-resource
  bootstrap fallback, asset-byte fanout, `.risu` export streaming. Also the
  four Tier-5 commands left on the `message-free` floor by frequency×cost
  decision.
- `POSTPONED by user decision (2026-07-22) — do not propose proactively` —
  knot-core fragmentation of the 121-module SCC (database↔globalApi↔commands↔
  process↔parser↔stores) to cut test import cost.

## Verified safe / decided — do not re-audit

- The transfer-size audit's "already tight" list: field-level command writes,
  payload-free SSE deltas, id-only generation bodies, token deltas,
  bootstrap stubs, gzip/brotli on all HTTP responses.
- All dismissed IDs from v1–v4 (archived active-risk files).
- `--no-isolate` for the frontend suite: **rejected with evidence** (121/435
  files fail, wall time worse). Do not retry without a test-hardening
  project.
- Peripheral edge-severing doesn't move suite time while the core SCC is
  intact (measured: `482372a12` cut util/alert closures with zero time win).

## Invariants for new code

- Never JSON-clone the characters array on hot scalar-only paths.
- Don't reintroduce per-token SSE accumulation parsing
  (`streamCoalescer.ts` keeps parses ≤2 per stream).
- New measurements follow the opt-in env-flag pattern
  (`RISU_PROTOCOL_METRICS`), captured in tests via
  `vi.mock('../src/protocolMetrics.js')`.
- Runtime narrowing work is evidence-gated: name the dominant stage/resource
  on a real corpus before building.

## Sources

Memory: `stability-perf-audits-v1-v4-closed`, `transfer-size-audit-2026-06-13`,
`frontend-test-suite-perf-profile`, `protocol-stability-measurements-landed`,
`char-select-snapshot-deepclone-fixed`. Archive:
`.archived-docs/performance-and-stability/`,
`.archived-docs/protocol-and-persistence/server-client-protocol/`.
