# Phase 6: Verification And Cleanup

## Objective

Remove legacy Context Agent source surfaces, refresh docs, and run closeout
verification.

## Scope

- Delete or fully retire old Context Agent runtime files.
- Remove old settings fields from visible UI and command allowlists where safe.
- Remove old language keys or keep only compatibility comments when still needed
  for old saves.
- Update structure docs.
- Run focused and broad verification.
- Record final compatibility caveats.

## Legacy Cleanup

Remove or retire:

- `server/fastify/src/prompt/contextAgent.ts`
- `src/lib/Setting/Pages/ContextAgentSettings.svelte`
- `src/ts/setting/contextAgentSettingsData.ts`
- Context Agent nav labels and route tests
- Context Agent CBS doc entry in `src/ts/cbs.ts`
- `agentContext*` settings from normal settings groups and command allowlists
  when no longer needed
- Context Agent tests that assert old behavior

If old save files may still contain `agentContext*` fields, the import/default
normalizers may leave them as inert compatibility data. They should not be
visible or executable.

## Documentation Updates

Update:

- `STRUCTURE.md`
- `docs/structure/backend.md`
- `docs/structure/domain-glossary.md`
- `docs/structure/providers-and-models.md`
- `docs/structure/server-projection-and-bridges.md`
- `src/docs/svelte-ui.md`
- any prompt/CBS docs that mention `{{agent}}`

Docs should describe:

- Agent Preset data ownership.
- Chat-scoped selection.
- before-main and after-main ordering.
- hidden diagnostics.
- prepared-input first-release limitation.
- legacy Context Agent removal.

## Verification Matrix

Run focused tests as changed areas require:

- Agent Preset schema/normalizer tests
- resolver/planner tests
- command route tests
- client command wrapper tests
- settings UI tests
- chat generation settings/sidebar tests
- loadout tests
- prompt assembly tests
- generation chat/finalization tests
- SSE/client terminal-frame tests if changed
- Context Agent removal regression tests

Run standard checks:

- relevant `pnpm test` or focused Vitest commands
- client TypeScript check used by this repo
- strict Fastify TypeScript check used by this repo
- `pnpm prettier` or the repo's Prettier command before commit
- `git diff --check`

Browser smoke:

- Start `pnpm dev:agent`.
- Open `http://localhost:6418`.
- Smoke Settings -> Agent Presets.
- Smoke chat Agent Preset selection.
- Smoke a generation using a before-main named output.
- Smoke an after-main modifier when test provider setup allows it.
- Stop the dev server before finishing.

## Closeout Status

When complete, update:

- `../status.md`
- `../latest-verification.md`
- this phase file with final proof notes if useful

Record any compatibility caveats that remain, especially inert `agentContext*`
data retained for old saves.

## Exit Criteria

- Context Agent is no longer visible or executable.
- Agent Preset docs are current.
- Focused tests and required checks pass, or exact gaps are documented.
- Browser smoke passes if UI/generation paths changed.
- Dev server is stopped.
