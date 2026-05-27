# Phase 9 Client Thinning - 9-1 Command Foundation

Date: 2026-05-25

9-1 is closed. It adds the shared command foundation that later Phase 9
resource slices must reuse, plus one small settings harness command.

## Landed

- Added command event plumbing in `server/fastify/src/commands/events.ts`
  with the initial `settings.updated` catalog entry and an in-process
  sink. SSE exposure remains deferred to 9-5.
- Added `applyJsonCommandMutation` in
  `server/fastify/src/commands/mutations.ts`. It opens a SQLite
  transaction, validates `baseRevision`, clones the current `db.json`
  database blob, applies one JSON mutation, writes the blob, bumps the
  schema revision once, emits one command event after commit, and restores
  the previous blob on thrown errors after a write.
- Registered command routes from `server/fastify/src/app.ts`.
- Added `PATCH /api/v1/commands/settings/runtime` as the harness command.
  The 9-1 allowlist intentionally contains only
  `useServerPromptAssembly`.
- Added `src/ts/server/commands.ts` with a typed browser command helper,
  auth header handling through `getNodeServerProxyAuth`, typed conflict
  results, and the `patchRuntimeSettings` helper.

## Covered

- Auth rejection once a password is configured.
- Missing/invalid `baseRevision` validation.
- 409 conflict responses with `currentRevision`.
- Successful command response shape, event shape, event sink recording,
  and bootstrap visibility after mutation.
- Validation rollback/no revision bump for malformed settings payloads.
- Thrown mutation rollback/no revision bump in the shared JSON command
  helper.
- Browser helper path, method, body, auth header, success, conflict,
  command error, and unavailable behavior.

## Out Of Scope

- Broad settings command groups beyond the one harness setting.
- UI mutation call-site replacement beyond adding the helper.
- SSE event projection.
- Read-only `DBState.db` guard.
- Provider-key masking.
- Server-side `.risu` import/export.

## Verification

Passed:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Results:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 657 tests passed, 4 skipped.
- `pnpm api:test` - 1056 tests passed.
- `pnpm build` - passed with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Start **9-2a - Scalar settings groups**:

- Extend the command route and browser helper foundation for real scalar
  settings groups.
- Keep provider-key masking deferred to 9-6 and prompt-template fields
  deferred to 9-2c.
- Replace server-backed web settings call sites with local draft state
  plus command helper calls while leaving legacy local mode paths alone.
