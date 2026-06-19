# Phase 0: Contract & Baseline

Status: complete. Contract and baseline only; no runtime behavior changes landed
in this phase.

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

Use these corrections before treating persistence-audit `Issue` rows as edit
instructions. The stale-state audit remains the prioritization layer when a
corrected source row is still risky.

- Chat playground inline editor anchor is stale; actual default/playground edit
  path persists through `edit()`.
- Sidebar `.txt` chat import is offered but has no server-backed import branch.
- Persona picker row selector names changed; current picker rows use generation
  picker attributes.
- Several preset, prompt item, loadout, lorebook, module, settings, and memory
  rows conflate old controls with current command paths.
- Character module buttons mix Hypa modal opening with module-apply persistence.
- Phase docs that mention `src/ts/process/rerollNavigation.ts` should be read
  as `src/ts/process/rerollNavigation.svelte.ts`.
- Preset and prompt-item rows should be re-resolved against the current
  server-backed command helpers before editing, because several old direct
  control anchors now flow through bridge or command wrappers.
- Memory rows should distinguish display-only job/progress refreshes from
  persisted memory command state before assigning stale overwrite priority.

## Helper Contract Decisions

Phase 1 should introduce small shared primitives in
`src/ts/server/staleStateGuards.ts`, with focused coverage in
`src/ts/server/staleStateGuards.test.ts`. The helper file should stay pure and
browser-safe; domain bridges and components remain responsible for passing
explicit target ids, source revisions, and attempted field sets.

| Helper name | Owner | Contract |
| --- | --- | --- |
| `createLatestOperationGuard` | `src/ts/server/staleStateGuards.ts` | Issues monotonic per-target operation tokens and checks whether a callback is still latest for the same target. |
| `isLatestOperation` | `src/ts/server/staleStateGuards.ts` | Narrow read helper for callbacks that only need to test an existing token. |
| `applyAttemptedFieldRollback` | `src/ts/server/staleStateGuards.ts` | Restores previous scalar/object fields only when live values still equal the attempted values. |
| `applyAttemptedKeyedListRollback` | `src/ts/server/staleStateGuards.ts` | Reverts keyed collection entries by id/key instead of restoring a whole collection snapshot. |
| `mergeProjectionIntoDirtyDraft` | `src/ts/server/staleStateGuards.ts` | Applies projection values to clean draft fields while preserving fields marked dirty after the projection request began. |
| `createDestructiveRefreshToken` | `src/ts/server/staleStateGuards.ts` | Marks import/restore/full-resync flows that are intentionally allowed to replace broad state. |

Initial Phase 1 adopters should be `src/ts/server/settingsBridge.svelte.ts`,
`src/ts/server/characterBridge.svelte.ts`, and `src/ts/chatCommands.ts`.
Component-local operation guards remain acceptable for UI-only lifetimes in
chat screen components, upload controls, and picker popovers, but they should
use the same target-token vocabulary in tests.

## Target Shape

- A small shared operation guard helper can create/check latest-run tokens by
  target key.
- A shared attempted rollback helper can compare live attempted values before
  restoring previous values.
- A shared dirty draft merge helper can merge projection rows into clean draft
  fields while leaving dirty fields untouched.
- A destructive refresh marker or helper makes full state replacement explicit
  in import/restore paths.

## First Regression Fixtures

These are the first P0 fixtures later phases should implement or extend:

| P0 pattern | Fixture choice | Likely owner |
| --- | --- | --- |
| Dirty projection | Character editor draft keeps a locally edited scalar or nested field when delayed projection refresh arrives for the same character. | `src/ts/server/characterBridge.svelte.ts`, `src/ts/server/staleStateGuards.test.ts` or a focused character bridge test |
| Composer/file callback | Composer file-post callback does not attach uploaded/imported file data after active chat changes or the composer draft advances. | `src/lib/ChatScreens/DefaultChatScreen.svelte` focused test or browser smoke |
| Reroll active-chat guard | Delayed reroll navigation result is dropped when the active chat no longer matches the captured chat/message target. | `src/ts/process/rerollNavigation.svelte.ts` focused test |
| Character asset upload | Character avatar/background upload result does not patch a newly selected character or newer character draft. | `src/ts/server/characterBridge.svelte.ts` or character editor focused test |
| Generation finalization freshness | Durable generation finalization persists only when the original chat/message tail remains current enough for the job. | `src/ts/process/request/serverChat.ts` and `server/fastify/src/routes/generationChat.ts` focused tests |

If a fixture cannot be added in its owning phase, record the exact reason in
`../status.md` before moving on.

## Exit Criteria

- Complete. The helper names and owning files are selected.
- Complete. The stale source-row corrections are recorded in this phase.
- Complete. At least one focused fixture is identified for each P0 pattern:
  dirty projection, composer/file callback, reroll active-chat guard,
  character asset upload, and generation finalization freshness.
- Complete. `status.md` is updated with the Phase 0 contract decisions.

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
