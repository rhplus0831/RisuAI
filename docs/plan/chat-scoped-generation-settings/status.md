# Chat-Scoped Generation Settings Status

Date: 2026-06-10

Phase 0, Phase 1, and Phase 2 are complete. Phase 2 landed the server-side
generation gate and effective database overlay for chat-owned generation
settings. UI controls, import normalization, and delete/fork lifecycle behavior
remain future phases.

## Snapshot

- Plan state: open, Phase 2 complete; Phase 3 is next.
- User decisions captured: use `personaId`, use `presetId` only, include all
  sidebar toggles, and make imported chats require explicit configuration.
- Sub-agent investigation: complete for server/data/prompt, frontend/UI, and
  test/import/compat/rollout scope.
- Phase 0 output: `src/ts/chatGenerationSettings.ts` owns the
  `generationSettings` object contract, readiness reason codes, required
  sidebar toggle resolver, stale-key reporting, and the stable incomplete-chat
  error body.
- Phase 1 output: server `PUT /api/v1/commands/chats/:chatId/generation-settings`
  and client `saveChatGenerationSettingsCommand` /
  `dispatchSaveChatGenerationSettings` persist validated chat-owned metadata,
  project it with chat rows, repair malformed stored values back to incomplete
  state, and keep `generationSettings` out of generic chat patching.
- Phase 2 output: server prompt assembly, prompt preview, continue/regenerate,
  and provider dispatch now resolve chat-owned persona, preset, jailbreak, and
  sidebar toggle values through an assembly-only effective database overlay, and
  return the stable incomplete-chat error before appending messages or creating
  jobs.
- Current risk: Phase 3 must make sidebar controls and client send gating edit
  the active chat before optimistic lifecycle work. Import/delete/fork lifecycle
  paths remain future phases.

## Phase Router

- [Phase 0](phases/phase-0-contract.md): complete. Contract, readiness helper,
  error shape, and edge policies are locked.
- [Phase 1](phases/phase-1-chat-metadata-and-commands.md): complete. Chat row
  metadata, commands, validation, projection, and repair.
- [Phase 2](phases/phase-2-effective-generation-config.md): complete. Server
  generation gate and effective database overlay.
- [Phase 3](phases/phase-3-ui-and-send-gating.md): next. Sidebar controls,
  picker behavior, and pre-append send blocking.
- [Phase 4](phases/phase-4-import-delete-fork-edges.md): planned. Import,
  delete, fork, copy, and new-chat lifecycle behavior.
- [Phase 5](phases/phase-5-verification.md): planned. Regression and
  TypeScript proof.

## Next Step

Run Phase 3 as the UI and client send-gating pass. Sidebar persona, preset,
jailbreak, and prompt/module toggle controls should edit the active chat's
`generationSettings`, and client send paths should block incomplete chats before
optimistic append or lifecycle work.

## Maintenance Rules

- Keep `status.md` as the active router.
- Keep cross-phase decisions in [`plan.md`](plan.md); keep per-phase scope in
  [`phases/`](phases/).
- Any implementation phase that changes UI text must add keys under `src/lang`.
- Any new server route must update `server/fastify/src/routeManifest.ts`.
- Every phase that touches runtime behavior must include focused regression
  tests before closing the phase.
