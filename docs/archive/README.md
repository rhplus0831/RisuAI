# Archive

Completed workstreams. These are the design/decision records, kept after the work
landed. They are **historical**: prefer the present-tense map in
[`../../STRUCTURE.md`](../../STRUCTURE.md) and the live open-items list in
[`../leftover.md`](leftover.md) for current state. The codebase is the source of
truth.

| Workstream                                                                                                | Archived   | What it delivered                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`fastify/`](fastify/README.md)                                                                           | earlier    | The Fastify migration (Phases 0–9) — the Fastify server is the only supported runtime. Holds the standing server-projection invariant contract, phase scope docs, and per-provider design references.                                                                                                                                                                                                    |
| [`client-thinning/`](client-thinning/README.md)                                                           | 2026-05-30 | The server now owns the chat process: default-on server prompt assembly, the supported text-send/multimodal/asset/image-gen content subset, the non-interactive server Lua VM, the A2 post-generation pass, scriptstate persistence, and a shared provider-capability table. A1/A2/A3 blockers landed; eight Phase-5 closeout decisions resolved; audit green (23 checks / 58 tests).                    |
| [`db-json-to-sqlite.md`](db-json-to-sqlite.md)                                                            | 2026-06-03 | SQLite-backed persistence for the remaining `db.json` state: asset metadata, characters/chats, collections, scalar settings, legacy `db.json` import/rename, SQLite-only backup/restore, and `.risu` import/export compatibility. The archived plan is historical; current table shapes and route behavior live in code.                                                                                 |
| [`durable-generation/`](durable-generation/README.md)                                                     | 2026-05-30 | **Milestone 1** (survive client disconnect, in-memory): detached `GenerationJobRegistry` jobs, server-owned result persistence at completion, reattach (`GET …/:id/stream`) and cancel (`DELETE …/:id`) endpoints, and the `activeGenerationJobs` bootstrap projection. This snapshot predates the later lazy-projection browser auto-reattach closeout.                                                 |
| [`lazy-projection/`](lazy-projection/README.md)                                                           | 2026-05-30 | Lean, lazily hydrated projection: server-side asset GC; surgical inbound sync; server-owned generation result writes; chat messages and per-chat `hypaV3Data` in SQLite; chat-stub bootstrap + hydrate-on-open; durable `continue`/`regenerate`; persisted reroll alternates; browser auto-reattach. Lorebook stub was excluded from the closeout audit.                                                 |
| [`server-client-protocol-stability-performance/`](server-client-protocol-stability-performance/README.md) | 2026-06-02 | Protocol stability and performance closeout: opt-in protocol metrics, bounded/bulk hydration, SQLite replay history, P1 correctness hardening, targeted hot mutation paths, read-projection efficiencies, stream/generation resilience, import/export/asset durability, client loop suppression, route operations coverage, and verification budgets. Remaining performance narrowing is evidence-gated. |
| [`mutation-range-mismatch/`](mutation-range-mismatch/README.md)                                           | 2026-06-03 | Command mutation-range narrowing (Phases 0–8): every over-broad command write was narrowed to its target SQLite range or held at a documented safe floor. Tier 1–4 settings/plugin-storage/single-row/collection paths, the projection-range splits, the gate-complete verification budgets, and the character-scoped Tier-5 routes (script/trigger PUTs, `DELETE chats/:id`, `DELETE characters/:id`) on `targeted-character-row`. Only the rare creates and `DELETE modules/:id` stay at the broad floor by choice.                                  |

## Still-open work

The archived workstreams have intentionally-deferred items and follow-ups (e.g.
durable-generation Milestone 2 / server-restart durability, multi-tenant Lua
hardening, and evidence-gated protocol runtime narrowing). The single live tracker is
[`../leftover.md`](leftover.md).

## Note on `fastify/client-thinning/`

The older [`fastify/client-thinning/`](fastify/client-thinning/) holds the Phase-9-era
server-projection invariant contract from the migration. The newer, top-level
[`client-thinning/`](client-thinning/README.md) is the rewritten-from-scratch (2026-05-29)
standing workstream that ran to closeout. They overlap in subject; the top-level one is
the later, completed record.
