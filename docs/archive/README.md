# Archive

Completed workstreams. These are the design/decision records, kept after the work
landed. They are **historical**: prefer the present-tense map in
[`../structure/`](../structure/README.md) and the live open-items list in
[`../leftover.md`](../leftover.md) for current state. The codebase is the source of
truth.

| Workstream | Archived | What it delivered |
| --- | --- | --- |
| [`fastify/`](fastify/README.md) | earlier | The Fastify migration (Phases 0–9) — the Fastify server is the only supported runtime. Holds the standing server-projection invariant contract, phase scope docs, and per-provider design references. |
| [`client-thinning/`](client-thinning/README.md) | 2026-05-30 | The server now owns the chat process: default-on server prompt assembly, the supported text-send/multimodal/asset/image-gen content subset, the non-interactive server Lua VM, the A2 post-generation pass, scriptstate persistence, and a shared provider-capability table. A1/A2/A3 blockers landed; eight Phase-5 closeout decisions resolved; audit green (23 checks / 58 tests). |
| [`durable-generation/`](durable-generation/README.md) | 2026-05-30 | **Milestone 1** (survive client disconnect, in-memory): detached `GenerationJobRegistry` jobs, server-owned result persistence at completion, reattach (`GET …/:id/stream`) and cancel (`DELETE …/:id`) endpoints, and the `activeGenerationJobs` bootstrap projection. EC-D1/D2/D4 end-to-end; EC-D3 server half done. |

## Still-open work

Both 2026-05-30 workstreams have intentionally-deferred items and follow-ups (e.g.
durable-generation Milestone 2 / browser live auto-reattach, client-thinning
`useServerPromptAssembly` removal, event patching). The single live tracker is
[`../leftover.md`](../leftover.md).

## Note on `fastify/client-thinning/`

The older [`fastify/client-thinning/`](fastify/client-thinning/) holds the Phase-9-era
server-projection invariant contract from the migration. The newer, top-level
[`client-thinning/`](client-thinning/README.md) is the rewritten-from-scratch (2026-05-29)
standing workstream that ran to closeout. They overlap in subject; the top-level one is
the later, completed record.
