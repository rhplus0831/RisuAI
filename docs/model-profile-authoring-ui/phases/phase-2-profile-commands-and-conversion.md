# Phase 2: Profile Commands And Conversion

Status: not started.

Goal: add atomic command support for profile authoring, role binding, runtime
defaults, and legacy-to-profile conversion.

## Scope

- Add row-oriented commands for:
  - create profile
  - update profile
  - duplicate profile
  - delete profile with reassignment
  - update role bindings
  - create profile and bind role
  - update runtime defaults
  - convert legacy settings to profiles
- Prefer a new command helper module such as
  `server/fastify/src/commands/modelProfiles.ts`.
- Add thin route wiring in `server/fastify/src/routes/commands.ts`.
- Add client command wrappers in `src/ts/server/commands.ts`.
- Ensure every command accepts `baseRevision`.
- Ensure multi-key operations write one revision:
  - conversion: `modelProfiles`, `modelRoleProfiles`, `modelRuntimeDefaults`
  - create-and-bind: profile row plus role binding
  - delete-reassign: remove profile plus affected role bindings
- Preserve masked secrets on update and duplicate according to the decision log.
- Implement generated `mp_` id collision handling.

## Conversion Rules

- Prompting and UI live in later phases; this phase only implements command
  semantics.
- Conversion always creates Main Chat and Auxiliary profiles.
- Other roles inherit by default unless existing legacy role behavior differs.
- Legacy global/base generation parameters move into `modelRuntimeDefaults`.
- Legacy role-specific separate parameters become profile `runtimeOptions` only
  where needed to preserve behavior.
- Set `providerId` only when legacy state can be safely mapped to a first-class
  provider.
- Providers outside first-class scope become compatibility profiles.

## Out Of Scope

- Settings UI prompt.
- Profile editor UI.
- Generation blocking.

## Anchors

- `src/ts/server/commands.ts`
- `src/ts/server/commands.test.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/commands/`
- `server/fastify/src/commands/events.ts`
- `server/fastify/__tests__/commands.test.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/projection.ts`

## Exit Criteria

- Profile row operations are atomic and revision-checked.
- Conversion rolls back with no revision bump on stale revision or invalid
  input.
- Delete refuses Main/Aux deletion when no existing replacement is available.
- Duplicate creates a new id, copies config, and excludes secrets by default.
- Client wrappers are covered by tests.

## Validation

```bash
pnpm exec vitest run src/ts/server/commands.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/providerSecrets.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Risks

- `patchServerBackedSettings` splits by group; do not implement multi-key
  conversion/create-bind/delete-reassign through generic grouped patches.
- Generated id ownership must be consistent. Decide whether ids are client
  minted with server collision checks or server minted by centralized helpers.

