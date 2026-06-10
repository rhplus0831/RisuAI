# Chat-Scoped Generation Settings Status

Date: 2026-06-10

Phase 0, Phase 1, Phase 2, Phase 3, and Phase 4 are complete. Phase 4 landed
deterministic import, delete, fork/copy, and new-chat lifecycle behavior for
chat-owned generation settings. The broader regression/TypeScript proof remains
planned for Phase 5.

## Snapshot

- Plan state: open, Phase 4 complete; Phase 5 remains planned.
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
- Phase 3 output: the active-chat frontend helper, chat-scoped picker mode,
  sidebar preset/persona/jailbreak/sidebar toggle controls, client pre-append
  guard, lower-level `sendChat` guard, and direct append guard are in place.
  Server-backed sends also keep `presetChain` and `promptInfo` from overriding
  chat-scoped preset/toggle values.
- Phase 3 focused validation passed:
  `pnpm exec vitest run src/ts/activeChatGenerationSettings.test.ts src/lib/SideBars/chatGenerationSettingsControls.test.ts src/lib/Setting/pickerGenerationSettings.test.ts src/ts/chatCommands.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts src/ts/process/__tests__/sendChatContext.test.ts`
  (`6` files, `87` tests).
- Phase 4 output: native create-chat remains incomplete by default unless a
  valid explicit `generationSettings` payload is supplied; server fork/copy
  inherits source chat settings unless explicitly overridden; full-database,
  `.risu`, bundle, legacy `.bin`, browser chat-file, Realm, and character-card
  imports leave chats incomplete until local confirmation; imported future-format
  values are preserved only as incomplete UI prefill where command-safe; preset
  and persona deletion leaves chat-owned ids intact and invalidates only affected
  chats; Realm starter chats now persist with generated chat ids.
- Phase 4 focused validation passed:
  `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts`,
  `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveBundleImportRoute.test.ts server/fastify/__tests__/risuSaveCodec.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveBundleExportRoute.test.ts`,
  `pnpm exec vitest run src/ts/characters.importChat.test.ts src/ts/chatCommands.test.ts`,
  `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/realmImport.test.ts`,
  `pnpm exec vitest run src/ts/characterCards.pngImport.test.ts`,
  `pnpm exec tsc -p tsconfig.client-lib.json`, and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
- Current risk: Phase 5 still needs the planned broader verification pass.

## Phase Router

- [Phase 0](phases/phase-0-contract.md): complete. Contract, readiness helper,
  error shape, and edge policies are locked.
- [Phase 1](phases/phase-1-chat-metadata-and-commands.md): complete. Chat row
  metadata, commands, validation, projection, and repair.
- [Phase 2](phases/phase-2-effective-generation-config.md): complete. Server
  generation gate and effective database overlay.
- [Phase 3](phases/phase-3-ui-and-send-gating.md): complete. Active-chat
  helper, sidebar controls, picker behavior, and pre-append/lower-level send
  blocking.
- [Phase 4](phases/phase-4-import-delete-fork-edges.md): complete. Import,
  delete, fork, copy, and new-chat lifecycle behavior.
- [Phase 5](phases/phase-5-verification.md): planned. Regression and
  TypeScript proof.

## Next Step

Run Phase 5 next. Complete the broader regression and TypeScript proof for the
chat-scoped generation settings workstream.

## Maintenance Rules

- Keep `status.md` as the active router.
- Keep cross-phase decisions in [`plan.md`](plan.md); keep per-phase scope in
  [`phases/`](phases/).
- Any implementation phase that changes UI text must add keys under `src/lang`.
- Any new server route must update `server/fastify/src/routeManifest.ts`.
- Every phase that touches runtime behavior must include focused regression
  tests before closing the phase.
