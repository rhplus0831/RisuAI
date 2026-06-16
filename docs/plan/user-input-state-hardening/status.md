# User Input State Hardening Status

Date: 2026-06-17

This workstream is active and not yet implemented. The plan consolidates the
input persistence inventory under `../../user-input-layer-audit/` and
stale-state risk review under `../../user-stale-state-audit/`.

## Snapshot

- Plan state: active, phase planning complete, implementation not started.
- Code changes: none from this workstream yet.
- Verification state: no runtime validation yet; plan-file formatting and link
  checks should be recorded in `latest-verification.md` after the first run.
- Highest issue density:
  - Character editor: 52 issue rows, mostly dirty projection and unguarded
    upload callbacks.
  - Chat/messages: composer, file-post, reroll, partial edit, dynamic trigger,
    suggestion, and generation finalization paths.
  - Lorebooks/scripts/modules/plugins: broad rollback and replacement
    collection paths.
  - Presets/personas/loadouts/prompts: dirty projection plus broad collection
    rollback.
  - Sidebar/chat lists: selection, ordering, create/delete/import rollback, and
    character open/select races.
- Healthier baseline:
  - Shared server command transport is revision-gated.
  - Settings bridge scalar writes generally use attempted-value rollback.
  - Raw asset helpers mostly return ids/data; call sites own stale callback
    guards.

## Phase Router

- [Phase 0](phases/phase-0-contract-and-baseline.md): open. Lock exact helper
  contracts, source-row corrections, and first regression fixtures.
- [Phase 1](phases/phase-1-shared-primitives-and-rollback.md): pending. Shared
  operation guards and narrow rollback helpers.
- [Phase 2](phases/phase-2-dirty-draft-projection.md): pending. Dirty draft
  projection merge behavior.
- [Phase 3](phases/phase-3-upload-import-fetch-callbacks.md): pending. Upload,
  file, import, decode, and remote-fetch callback tokens.
- [Phase 4](phases/phase-4-chat-messages-generation.md): pending. Chat,
  message, reroll, trigger, suggestion, and generation target freshness.
- [Phase 5](phases/phase-5-collection-domains.md): pending. Presets,
  personas, loadouts, lorebooks, scripts, modules, plugins, sidebars, and list
  ordering.
- [Phase 6](phases/phase-6-resync-memory-navigation.md): pending. Full resync,
  backups/imports, memory jobs, and navigation/selection refresh.
- [Phase 7](phases/phase-7-verification.md): pending. Closeout regression,
  browser smoke, and TypeScript proof.

## Implementation Notes

- Treat `Issue` rows in `../../user-input-layer-audit/` as source-row drift
  unless the stale-state audit also marks the path risky. Phase 0 should
  normalize those anchors before implementation work starts.
- Prefer shared helpers for operation tokens, attempted rollback, and dirty
  projection merge. Use local component tokens only when the lifetime is truly
  local.
- Complete each phase with focused tests or record the exact residual gap here
  before moving on.
- Run Prettier before committing any implementation patch.
