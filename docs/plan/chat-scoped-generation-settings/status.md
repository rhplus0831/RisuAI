# Chat-Scoped Generation Settings Status

Date: 2026-06-10

Phase 0 and Phase 1 are complete. Phase 1 landed the chat-owned
`generationSettings` metadata command on the server and client command
surfaces. Runtime prompt assembly/send gating, UI controls, import
normalization, and delete/fork lifecycle behavior remain future phases.

## Snapshot

- Plan state: open, Phase 1 complete; Phase 2 is next.
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
- Current risk: Phase 2 must make server prompt assembly and generation dispatch
  consume only chat-owned settings. Until Phase 2+ lands, the metadata command
  does not block sends, prompt preview, continue, regenerate, UI interactions,
  or import/delete/fork lifecycle paths.

## Phase Router

- [Phase 0](phases/phase-0-contract.md): complete. Contract, readiness helper,
  error shape, and edge policies are locked.
- [Phase 1](phases/phase-1-chat-metadata-and-commands.md): complete. Chat row
  metadata, commands, validation, projection, and repair.
- [Phase 2](phases/phase-2-effective-generation-config.md): next. Server
  generation gate and effective database overlay.
- [Phase 3](phases/phase-3-ui-and-send-gating.md): planned. Sidebar controls,
  picker behavior, and pre-append send blocking.
- [Phase 4](phases/phase-4-import-delete-fork-edges.md): planned. Import,
  delete, fork, copy, and new-chat lifecycle behavior.
- [Phase 5](phases/phase-5-verification.md): planned. Regression and
  TypeScript proof.

## Next Step

Run Phase 2 as the server prompt/generation pass. Reuse the Phase 0 readiness
and incomplete-chat error helpers plus the Phase 1 chat-owned settings metadata;
do not add global persona, preset, jailbreak, or `globalChatVariables` fallbacks
while building the effective database overlay.

## Maintenance Rules

- Keep `status.md` as the active router.
- Keep cross-phase decisions in [`plan.md`](plan.md); keep per-phase scope in
  [`phases/`](phases/).
- Any implementation phase that changes UI text must add keys under `src/lang`.
- Any new server route must update `server/fastify/src/routeManifest.ts`.
- Every phase that touches runtime behavior must include focused regression
  tests before closing the phase.
