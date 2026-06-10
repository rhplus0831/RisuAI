# Chat-Scoped Generation Settings Status

Date: 2026-06-10

Phase 0 is complete as a contract/helper scaffold. No runtime send behavior,
chat settings persistence commands, UI controls, import normalization, or
delete/fork behavior has landed in this workstream yet.

## Snapshot

- Plan state: open, Phase 0 complete.
- User decisions captured: use `personaId`, use `presetId` only, include all
  sidebar toggles, and make imported chats require explicit configuration.
- Sub-agent investigation: complete for server/data/prompt, frontend/UI, and
  test/import/compat/rollout scope.
- Phase 0 output: `src/ts/chatGenerationSettings.ts` owns the
  `generationSettings` object contract, readiness reason codes, required
  sidebar toggle resolver, stale-key reporting, and the stable incomplete-chat
  error body.
- Current risk: Phase 1 must persist and validate the contract without
  accidentally treating legacy global persona, preset, jailbreak, or
  `globalChatVariables` values as readiness fallbacks.

## Phase Router

- [Phase 0](phases/phase-0-contract.md): complete. Contract, readiness helper,
  error shape, and edge policies are locked.
- [Phase 1](phases/phase-1-chat-metadata-and-commands.md): next. Chat row
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

Run Phase 1 as the metadata/command pass. Use the Phase 0 helper instead of
redefining field names, missing reason codes, sidebar toggle resolution, stale
key behavior, or incomplete-chat error shape.

## Maintenance Rules

- Keep `status.md` as the active router.
- Keep cross-phase decisions in [`plan.md`](plan.md); keep per-phase scope in
  [`phases/`](phases/).
- Any implementation phase that changes UI text must add keys under `src/lang`.
- Any new server route must update `server/fastify/src/routeManifest.ts`.
- Every phase that touches runtime behavior must include focused regression
  tests before closing the phase.
