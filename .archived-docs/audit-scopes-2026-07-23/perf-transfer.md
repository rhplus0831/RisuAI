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
Implementation decisions recorded 2026-07-23 bring the remediated count to 24
once the pending changes are committed. Current disposition:

- `MEASUREMENT LANDED; PROTOCOL EVIDENCE-GATED` **L13** —
  opt-in `memory_event_fanout` metrics now quantify listener fanout and bytes;
  scoped subscriptions remain deferred until captures show material cost.
- `FIXED` **L14** — memory chunks and summaries use 200-row
  keyset pages, while unpaged legacy reads fail explicitly above 1,000 rows.
- `MEASUREMENT LANDED; PROTOCOL EVIDENCE-GATED` **L15** —
  opt-in per-connection SSE byte/frame/lifetime/close metrics landed; streaming
  compression remains deferred pending volume and proxy-latency evidence.
- `ACCEPTED` **L16** (decided 2026-07-23) — the typical 68-byte origin field is
  retained because replacing it requires a connection-specific own-echo protocol.
- `FIXED` **L18** — both bulk hydration routes cap raw IDs at
  32 and bodies at 64 KiB; whole-corpus callers drain sequential 32-ID batches.
- `FIXED` **L20** — Realm clients negotiate
  `realmProgressDelta`, retaining full progress frames for older clients.
- `ACCEPTED` **L2** (decided 2026-07-23) — the four-resource replay-gap recovery
  snapshot remains the rare correctness fallback until existing metrics show
  recurring material cost.
- `ACCEPTED` **L5** (decided 2026-07-23) — durable `done.result` remains the
  self-contained replay/reattach result after droppable token frames are gone.
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
