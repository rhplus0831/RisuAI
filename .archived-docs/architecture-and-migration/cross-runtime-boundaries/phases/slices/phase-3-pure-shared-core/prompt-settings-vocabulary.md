# Prompt-Settings Vocabulary

Status: complete at `96e0dedfb`.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: module-integration normalization at `d314bbdcf`.

## Objective

Give the fixed prompt-settings key tuple and derived key type one audited,
dependency-free owner without moving prompt validation, commands, UI state, or
persistence policy.

## Source And Destination

- Source: `src/ts/promptSettings.ts`.
- Destination: `@risuai/shared-core/prompt-settings`.
- Consumers: the Fastify prompt command, browser bot settings, browser settings
  groups, and their focused tests.

## Behavior Contract

- Preserve the exact ordered 21-key tuple and its derived union type.
- Keep prompt value validation, selected-preset composition, mutations,
  persistence, revision policy, and UI behavior in their existing owners.
- Reject browser, Svelte, DOM, Fastify, filesystem, database, credential, and
  process-global dependencies from the shared package.

## Validation

Shared vocabulary and ownership tests passed 2 and 1 fixtures; the shared
import-boundary file passed 2. Affected Fastify resource-read, browser command,
settings-group, and bot-settings files passed 21, 166, 8, and 2 tests. Both
typechecks, the 294-edge architecture inventory, formatting, and diff checks
passed.

## Exit Result

All production and test consumers use the shared subpath, the browser-tree
owner is gone, and two production runtime plus one server-test runtime
root-`src` edges were removed without changing prompt ownership.
