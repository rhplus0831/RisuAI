# History

Date: 2026-05-28

Resolved findings, verification-ladder results, and the pointer to the archived
Phase 9 migration slices. The live work is in
[`open-findings.md`](./open-findings.md).

## Archived migration slices

The original Phase 9 *client-thinning migration* (slices 9-0 through 9-9e, plus
followups and the `9a`/`9b` projection-write passes) is closed and archived
under [`../phases-completed/`](../phases-completed/) as `phase-9-*` documents,
indexed from [`../phases-completed/README.md`](../phases-completed/README.md) and
[`../phases-completed/overview.md`](../phases-completed/overview.md). The locked
design artifact is
[`../phases-completed/phase-9-command-map.md`](../phases-completed/phase-9-command-map.md)
(command contract, identity rules, plugin DB bridge policy).

Those slices remain closed. This workstream exists because "complete against the
known direct-write list" was not the same as "complete against the
server-projection invariant."

## Resolved rework findings (2026-05-28)

### Original blockers

1. **Bootstrap leaked nested provider secrets.** `providerSecrets.ts` now masks
   `botPresets[*].openAIKey`, `botPresets[*].proxyKey`, and
   `characters[*].oaiTTSConfig.apiKey`; `bootstrap.test.ts` asserts masked nested
   output. (commit `60dfc7a1`)
2. **Character-module add/remove could not persist.** The reorder command now
   treats `moduleIds` as the full replacement set of links, validated against
   known modules (`validateCharacterModuleLinks`); add/remove/reorder all work.
   (commit `55f071ff`)
3. **Stale read-only aliases broke trusted projection writes.** Settings,
   prompt-settings, and bot prompt-field draft helpers re-read `DBState.db`
   inside the trusted callback; global lorebook add/folder/import build a mutable
   next-entry array and assign it; `ensureClientLorebookEntryIds` writes only
   when an id is missing. `lorebook.projectionGuard.test.ts` covers it.
   (commit `852d4cfd`) — see memory `phase9-guard-optimistic-write-gap`.
4. **Plugin DB bridge did not match the command map.** Contract revised: in
   server-backed mode, recognized resource families with no bridge command
   (`unsupportedServerBridgeKeys`) are blocked with a warning instead of producing
   a dangling projection write or shadowing the real resource; local mode
   unchanged; truly unknown keys still route to plugin storage. (commit `70b278c5`)

### Additional findings

- **Welcome setup persisted only part of what it mutated.** `WelcomeRisu.svelte`
  snapshots, diffs, and persists every changed key through
  `applyServerBackedSettingsPatch`. (commit `69c97d0a`)
- **`verbosity` was server-allowed but not client command-backed.** Mapped to the
  `runtime` settings group in `SERVER_SETTINGS_GROUP_BY_KEY`. (commit `2196b6e4`)
- **DevTool autopilot directly mutated message history.** The autopilot loop
  applies the optimistic user message inside `withTrustedServerProjectionWrite`
  and lets `sendChat` drive command-backed persistence. (commit `1dc75d57`)
- **Malformed RISUSAVE block uploads returned 500.**
  `decodeRisuSaveImportSnapshot` wraps raw envelope decoders so non-`ValidationError`
  failures become 400. (commit `deb61545`)
- **Asset upload revision/event mismatch.** The assets route is registered with
  the command event sink and emits `asset.created` with the bumped revision; the
  browser advances its cached command revision from the upload response.
  (commit `aa1f45d3`)

## Verification-ladder results (2026-05-28, after the resolved fixes)

- `pnpm check`: passed, 0 errors / 0 warnings.
- `pnpm test`: 779 passed, 4 skipped.
- `pnpm api:test`: 1221 passed.
- `pnpm build`: built (pre-existing chunk-size / ineffective-dynamic-import warnings only).
- `pnpm smoke:fastify-browser`: 1 passed.

Follow-up audit re-run (subset, 2026-05-28):

- `pnpm check`: passed, 0/0.
- Selected vitest projection-guard + command suites: 75 passed.
- Selected `pnpm api:test` command/bootstrap/risuSave/assets suites: 1221 passed.
- Full `pnpm test`, `pnpm build`, and `pnpm smoke:fastify-browser` were **not**
  rerun during the follow-up audit.

## Historical note

`pnpm tauribuild` appears in older Phase 9 closeout docs but is no longer an
available package script after the Fastify-only cleanup. Do not use it as a
current closeout gate unless the script is restored.
