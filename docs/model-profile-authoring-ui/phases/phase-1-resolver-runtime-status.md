# Phase 1: Resolver Runtime Status

Status: not started.

Goal: teach profile resolution about provider-first profiles, runtime defaults,
and explicit profile status before commands or UI depend on those semantics.

## Scope

- Add Ready, Incomplete, Compatibility, and Unsupported status helpers for
  resolved profiles and role summaries.
- Stop silently falling back to legacy for explicit broken profile bindings.
- Keep legacy fallback behavior for explicit legacy mode, static model bypasses,
  safe normalization, and conversion.
- Implement runtime precedence for profile-bound roles:
  1. app/runtime hard defaults
  2. `modelRuntimeDefaults`
  3. profile `runtimeOptions`
- Keep legacy flat/separate parameter behavior for legacy-mode roles and
  conversion only.
- Resolve first-class providers from `providerId`:
  - `openai`
  - `anthropic`
  - `google`
  - `vertex`
  - `custom-api`
- Mark missing `providerId` as Compatibility unless it can be safely inferred.
- Keep compatibility profiles readable without forcing provider-first editing.

## Out Of Scope

- New commands.
- Visible UI.
- Server route guardrails.
- Full legacy conversion.

## Anchors

- `src/ts/model/modelProfileResolver.ts`
- `src/ts/model/modelProfileResolver.test.ts`
- `src/ts/model/modelProfileUiState.ts`
- `src/ts/model/modelProfileUiState.test.ts`
- `src/ts/model/modelRoles.ts`
- `src/ts/process/request/providerCapability.ts`
- `src/ts/process/request/tests/providerCapability.test.ts`

## Exit Criteria

- Explicit profile bindings to missing profiles produce broken/incomplete state
  rather than legacy fallback.
- Profile-bound runtime defaults do not read legacy flat parameters.
- Compatibility profiles still resolve through the existing compatibility path.
- First-class provider profiles can be classified as Ready or Incomplete from
  profile-local fields.
- Focused resolver/status tests pass.

## Validation

```bash
pnpm exec vitest run src/ts/model/modelProfileResolver.test.ts src/ts/model/modelProfileUiState.test.ts src/ts/process/request/tests/providerCapability.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```

## Risks

- Existing tests currently lock in legacy fallback for missing durable
  profiles; those tests must be updated deliberately.
- Prompt assembly may still use `db.aiModel` assumptions. Record exact follow-up
  needs for Phase 5 if this phase exposes mismatches.

