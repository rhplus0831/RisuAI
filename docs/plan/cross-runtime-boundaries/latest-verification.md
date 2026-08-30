# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-31

## Candidate

- Implementation commit: `e520f5bb7`
- Phase 4 predecessors: prompt-message value ownership at `d31f0eb16` and
  integration follow-up at `53e9fa0c3`
- Phase 3 predecessor: prompt-settings vocabulary at `96e0dedfb`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 4 prompt-memory query source projection after complete
  prompt-message ownership; no prompt content/order, token formula, Lua,
  provider dispatch, model-profile resolution, persistence, receipt, revision,
  or event behavior changed.

## Server-Consumer Proof

- All Fastify prompt, token, Lua, assembly, dispatch, and generation-route
  consumers share one server-owned prompt-message/multimodal record.
- Prompt-memory query construction receives Fastify-owned transcript/source
  projections and the existing server-owned embedding settings contract.
- Closed ownership assertions prevent the migrated production imports from
  returning.
- The architecture inventory records 232 root-`src` edges: 150 production, 74
  server-test, and 8 browser-smoke. Of these, 135 are runtime/mixed.

## Commands And Results

- The prompt-message tranche passed Agent Preset, assembly, lorebook, Lua,
  prompt-memory, plain/static section, token, trigger, dispatch, completion,
  chat-generation, and ownership suites. The integration owners included 100
  dispatch, 96 completion, and 181 chat-generation tests.
- Prompt-memory query projection passed 3 direct, 1 ownership, and 181
  generation-chat tests.
- Architecture inventory passed at 232 edges, 20 compatibility surfaces/42
  probes, 9,898 client references/326 groups, and 56 owner-gap rows.
- Shared-core, client declarations, Fastify, browser-smoke, and root Svelte
  typechecks passed. Focused Prettier and `git diff --check` passed.

## Dependency Release And Verdict

Prompt-message ownership and prompt-memory query projection are released through
`e520f5bb7`; together with the preceding Phase 4 seams they preserve all
behavioral owners while reducing the checked boundary to 232 edges. Phase 4
continues with the trigger-compatibility policy seam; declaration decoupling and
those remaining edges stay open.
