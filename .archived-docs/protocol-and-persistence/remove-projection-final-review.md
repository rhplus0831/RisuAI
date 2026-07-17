# Remove Projection Final Review

> Archived branch review. This records the named commits at the review date and
> does not describe the current mutation/resource contract.

Review date: 2026-07-14

Reviewed branch: `remove-projection` at `3fdfbf01adb21c2a315a5859ca5432fe2a2db689`

Merge target: `fastify` at `efd035d444215b4b080080dcb353b9441fbbd6c2`

## Verdict

`remove-projection` is not ready to merge yet. The branch is mechanically clean and can fast-forward onto `fastify`, but two client settings-reconciliation regressions should be fixed first.

## Findings

### P1: Non-optimistic settings writes are falsely acknowledged

`patchSettingsGroup` creates a compact optimistic local effect unless `acknowledgeOptimistic` is explicitly `false`:

- `src/ts/server/commands.ts:1850-1868`

`patchServerBackedSettings` does not require callers to certify that they already applied the attempted value locally, and it calls `patchSettingsGroup` without disabling optimistic acknowledgement:

- `src/ts/server/commands.ts:1916-1952`

At least two production callers send a settings patch without first writing the attempted value into the client database:

- `src/lib/Others/PromptDiffModal.svelte:177-193`
- `src/lib/UI/NanoGPTDashboard.svelte:38-54`

The resulting sequence is deterministic:

1. The caller sends a new value while the local database still contains the old value.
2. The server accepts and persists the patch.
3. The compact settings local effect compares the live old value with the attempted new value and skips the assignment because they differ.
4. `applySettingsPatchLocalEffect` still advances the settings-group revision.
5. Bootstrap treats the command revision as applied, so no authoritative settings read repairs the client.

The relevant skip and revision advance are in `src/ts/server/resourceState.svelte.ts:755-781`. For prompt-diff preferences, reopening the modal reads the stale local preferences. For NanoGPT subscription state, in-session consumers continue reading the stale database value until a later refresh or reload.

Recommended fix:

- Make compact acknowledgement an explicit opt-in for callers that have performed an optimistic local write, or expose and pass `acknowledgeOptimistic: false` for non-optimistic calls.
- Update the two callers above to write locally first or request authoritative reconciliation.
- Add tests proving that non-optimistic accepted settings patches update the local projection or trigger a settings-group read.

### P2: Debounced settings intents lose their projection fence

Ordinary pending settings patches retain the attempted values but do not capture the settings-group projection epoch at the time the optimistic intent is created:

- `src/ts/server/settingsBridge.svelte.ts:299-322`
- `src/ts/setting/utils.ts:253-324`
- `src/ts/server/commands.ts:478-483`

An authoritative settings apply can therefore interleave while an edit is still waiting in a debounce timer:

1. The UI writes setting value B optimistically and stores B in a pending timer.
2. An earlier command, such as `modelPreset.selected`, performs an authoritative full-settings read. Its invalidation behavior is defined in `src/ts/server/resourceInvalidation.ts:493-507`.
3. The authoritative response restores the server's pre-B value A and advances the settings-group projection epoch.
4. The pending timer later dispatches B using the now-current server revision, and the server accepts it.
5. The compact acknowledgement sees live A instead of attempted B, assumes that A is a newer local edit, skips B, and nevertheless advances the applied revision cursor.

The active setting-input draft can reassert its value after a resource apply, but raw settings watchers do not do so, and a destroyed input draft cannot do so. The global pending timer remains active after component destruction.

Recommended fix:

- Capture the relevant settings-group projection epoch when each optimistic intent is created or enqueued.
- Propagate that epoch through `patchServerBackedSettings` and `patchSettingsGroup`.
- Reject the compact local effect and perform authoritative reconciliation if the epoch changed.
- Add coverage for an authoritative settings apply occurring between optimistic edit creation and debounced command dispatch.

## Merge and validation status

- `fastify` is an ancestor of `remove-projection`.
- The branch is 194 commits ahead and 0 commits behind `fastify`.
- The merge can be performed as a fast-forward, with no merge conflicts found in simulation.
- No live tracked references remain to `DBState`, `/api/v1/projection`, or the deleted projection modules and caches.
- The worktree was clean at the end of the review.

The following checks passed:

- `git diff --check fastify...HEAD`
- `pnpm format:check`
- `pnpm check` with 0 errors and 0 warnings
- Client declaration TypeScript build
- Strict Fastify TypeScript check
- Frontend tests: 281 files; 3,185 passed and 3 skipped
- Server tests: 115 files; 2,337 passed and 1 skipped
- Gate tests: 10 files; 130 passed
- Production build
- Fastify browser smoke tests: 5 passed

At review time, the now-retired `pnpm client-thinning:audit` command reported 29 findings and exited nonzero. The same findings and categories were present on the `fastify` baseline, so this branch did not introduce an additional audit regression.

After the P1 and P2 findings are fixed and covered by focused reconciliation tests, the remaining reviewed changes are suitable for fast-forward merge into `fastify`.
