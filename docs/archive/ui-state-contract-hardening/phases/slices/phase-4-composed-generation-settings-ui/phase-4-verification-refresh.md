# Slice: Phase 4 Verification Refresh

Phase: [4](../../phase-4-composed-generation-settings-ui.md). No runtime change.

Status: complete. Depended on the required Phase 4 test slices.

## Scope

Refresh Phase 4 focused proof and update plan navigation.

## Anchors

- `docs/plan/ui-state-contract-hardening/status.md`
- `docs/plan/ui-state-contract-hardening/latest-verification.md`
- Phase 4 slice files

## Target Shape

- Client helper/control/picker/composed UI proof is recorded.
- Fastify command/import proof is recorded.
- Any skipped feasibility-dependent assertion has a specific reason and
  substitute proof.

## Invariants

- Do not reopen archived generation-settings plans.
- Do not replace failed broad commands with narrower proof.

## Done Criteria

- Required Phase 4 tests pass.
- Status and latest verification are updated.

## Validation

```bash
pnpm exec vitest run \
  src/ts/chatGenerationSettings.test.ts \
  src/ts/activeChatGenerationSettings.test.ts \
  src/lib/SideBars/chatGenerationSettingsControls.test.ts \
  src/lib/Setting/pickerGenerationSettings.test.ts \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts \
  src/ts/process/__tests__/sendChat.serverPreview.test.ts \
  src/ts/chatCommands.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/risuSaveImportRoute.test.ts \
  server/fastify/__tests__/risuSaveBundleImportRoute.test.ts \
  server/fastify/__tests__/realmImport.test.ts
git diff --check
```
