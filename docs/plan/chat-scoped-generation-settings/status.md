# Chat-Scoped Generation Settings Status

Date: 2026-06-10

This active plan is ready for Phase 0. No runtime implementation has landed in
this workstream yet.

## Snapshot

- Plan state: open, planned.
- User decisions captured: use `personaId`, use `presetId` only, include all
  sidebar toggles, and make imported chats require explicit configuration.
- Sub-agent investigation: complete for server/data/prompt, frontend/UI, and
  test/import/compat/rollout scope.
- Current risk: Phase 0 must define the required toggle resolver carefully
  because displayed toggles are dynamic and may depend on the selected preset
  and active modules.

## Phase Router

- [Phase 0](phases/phase-0-contract.md): planned. Contract, readiness helper,
  error shape, and edge policies.
- [Phase 1](phases/phase-1-chat-metadata-and-commands.md): planned. Chat row
  metadata, commands, validation, projection, and repair.
- [Phase 2](phases/phase-2-effective-generation-config.md): planned. Server
  generation gate and effective database overlay.
- [Phase 3](phases/phase-3-ui-and-send-gating.md): planned. Sidebar controls,
  picker behavior, and pre-append send blocking.
- [Phase 4](phases/phase-4-import-delete-fork-edges.md): planned. Import,
  delete, fork, copy, and new-chat lifecycle behavior.
- [Phase 5](phases/phase-5-verification.md): planned. Regression and
  TypeScript proof.

## Next Step

Run Phase 0 as a contract pass. The output should be a small implementation
brief or first patch that proves:

- the exact chat settings object name and field names;
- the exact resolver for required sidebar toggles;
- the exact structured error shape for incomplete chats;
- whether delete invalidation clears references immediately or treats missing
  references as incomplete at read time;
- the places where server and client readiness helpers will live.

## Maintenance Rules

- Keep `status.md` as the active router.
- Keep cross-phase decisions in [`plan.md`](plan.md); keep per-phase scope in
  [`phases/`](phases/).
- Any implementation phase that changes UI text must add keys under `src/lang`.
- Any new server route must update `server/fastify/src/routeManifest.ts`.
- Every phase that touches runtime behavior must include focused regression
  tests before closing the phase.
