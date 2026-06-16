# Phase 0: Contract & Baseline

Status: open. Contract and baseline only; avoid runtime behavior changes except
narrow helper scaffolding if needed to prove the contract.

Goal: lock the stale-state safety contract, normalize stale audit anchors, and
choose the first regression fixtures before changing broad runtime behavior.

## Scope

- Define the shared terms used by later phases: operation token, target
  identity, attempted patch, dirty draft, projection merge, narrow rollback, and
  destructive refresh.
- Decide where shared helper APIs live and which domains need component-local
  guards instead.
- Convert `Issue` rows in `../../user-input-layer-audit/` into a short baseline
  note so implementation agents do not chase stale line numbers or missing
  controls.
- Confirm which existing tests can be extended and which focused tests need to
  be added.
- Pick the first P0 smoke flows for agent browser validation.

## Anchors

- `../../user-input-layer-audit/overview.md`
- `../../user-stale-state-audit/overview.md`
- `src/ts/server/commands.ts`
- `src/ts/server/settingsBridge.svelte.ts`
- `src/ts/server/characterBridge.svelte.ts`
- `src/ts/chatCommands.ts`
- `src/ts/storage/database.svelte.ts`
- `src/ts/process/request/serverChat.ts`

## Baseline Corrections

Phase 0 should record source-row drift from the persistence audit before
implementation:

- Chat playground inline editor anchor is stale; actual default/playground edit
  path persists through `edit()`.
- Sidebar `.txt` chat import is offered but has no server-backed import branch.
- Persona picker row selector names changed; current picker rows use generation
  picker attributes.
- Several preset, prompt item, loadout, lorebook, module, settings, and memory
  rows conflate old controls with current command paths.
- Character module buttons mix Hypa modal opening with module-apply persistence.

## Target Shape

- A small shared operation guard helper can create/check latest-run tokens by
  target key.
- A shared attempted rollback helper can compare live attempted values before
  restoring previous values.
- A shared dirty draft merge helper can merge projection rows into clean draft
  fields while leaving dirty fields untouched.
- A destructive refresh marker or helper makes full state replacement explicit
  in import/restore paths.

## Exit Criteria

- The helper names and owning files are selected.
- The stale source-row corrections are recorded in this phase or linked from
  it.
- At least one focused fixture is identified for each P0 pattern:
  dirty projection, composer/file callback, reroll active-chat guard,
  character asset upload, and generation finalization freshness.
- `status.md` is updated with any contract decisions made during Phase 0.

## Validation

```bash
pnpm exec prettier --check 'docs/plan/user-input-state-hardening/**/*.md'
```

If helper scaffolding lands in this phase, also run the nearest focused tests
and the TypeScript workflow from `../latest-verification.md`.

## Risks

- A helper that is too abstract may hide the target identity checks that tests
  need to prove. Prefer small primitives with explicit target keys.
- Audit source drift can waste implementation time. Normalize it before using
  line numbers as edit instructions.
