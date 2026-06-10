# Phase 4: Import, Delete & Fork Edges

Status: complete.

Goal: make every chat lifecycle path produce deterministic generation settings
state, especially imports and deleted references.

## Scope

- New chats start incomplete unless a caller supplies an explicit configured
  settings payload.
- Fork/copy clones the source chat's generation settings and completeness.
- `.risu`, bundle, JSON database, character-card, and Realm imports preserve
  chat content but mark imported chats incomplete until local user confirmation.
- Import may preserve legacy or future-format values only as UI prefill data;
  those values do not make the chat generation-ready.
- Persona/preset deletion invalidates affected chats without retargeting them
  to a global/default selection.
- Module/toggle removal makes stale toggle values inert and prunes them on next
  settings save; toggle rename is delete plus add.

## Anchors

- `server/fastify/src/risuSave/importSnapshot.ts`
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/routes/realmImport.ts`
- `server/fastify/src/realmImport/characterCard.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/databaseDefaults.ts`
- `server/fastify/src/commands/chats.ts`
- `server/fastify/src/routes/commands.ts`
- `src/ts/characters.ts`
- `src/ts/characterCards.ts`
- `src/lib/SideBars/SideChatList.svelte`
- `src/ts/chatCommands.ts`

## Target Shape

- Imports never infer chat settings from source or local global
  `botPresetsId`, `selectedPersona`, `globalChatVariables`, or
  `jailbreakToggle`.
- Imported chats remain inspectable and editable.
- Import results mention incomplete chat count where the import UI already
  reports status.
- Backup restore may preserve exact repository state because restore is not a
  chat import; if a restore path is user-facing like import, Phase 0 must decide
  its behavior explicitly.

## Invariants

- Legacy `bindedPersona` is not a readiness fallback.
- Missing imported preset/persona ids are cleared or treated as invalid and
  reported.
- Unknown imported toggle keys are inert.
- Realm-created starter chats are incomplete by default.
- Deleting a referenced preset/persona makes only affected chats incomplete.

## Exit Criteria

- Native create, fork/copy, `.risu` import, bundle import, JSON/chat import,
  character-card import, and Realm import have explicit tests or documented
  coverage.
- Imported chats can be opened but cannot send until configured.
- Configured metadata round-trips on export only where the contract says it
  should, and imported copies still require confirmation.
- Delete invalidation behavior is tested for preset and persona deletion.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bootstrap.test.ts \
  server/fastify/__tests__/risuSaveImportRoute.test.ts \
  server/fastify/__tests__/risuSaveBundleImportRoute.test.ts \
  server/fastify/__tests__/realmImport.test.ts \
  server/fastify/__tests__/commands.test.ts
pnpm exec vitest run src/ts/characters.importChat.test.ts \
  src/ts/characterCards.pngImport.test.ts \
  src/ts/chatCommands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Focused execution for this phase also covered import/export codec regressions:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/risuSaveCodec.test.ts \
  server/fastify/__tests__/risuSaveExportRoute.test.ts \
  server/fastify/__tests__/risuSaveBundleExportRoute.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
```

## Risks

- Old fixtures may assume every loaded chat can send immediately. Update tests
  to distinguish native configured fixtures from imported incomplete chats.
- Import/export and restore routes may share helpers. Keep the "import requires
  reconfirmation" rule out of exact backup restore unless Phase 0 schedules it.
