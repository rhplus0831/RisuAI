# User Input State Hardening

Date: 2026-06-17

## Goal

Eliminate stale async overwrites across persisted user input. A user edit,
selection, uploaded asset, imported file, generated message, or resynced
projection must not replace newer local state unless the operation is still
current for the same target and the user has intentionally requested a
destructive replacement.

End state:

- Async callbacks carry an operation token and target identity across every
  `await` before mutating UI state or issuing dependent commands.
- Optimistic rollback restores only the fields/entities attempted by the failed
  operation and only when live state still equals the attempted value.
- Server projection and SSE reconciliation merge into dirty drafts without
  reseeding fields changed after the request began.
- Broad collection replacements are either narrowed to keyed patches or guarded
  by collection revisions and attempted-value checks.
- Composer, reroll, partial edit, trigger, and generation finalization paths
  verify the active chat, target message, and source revision before writing.
- Upload, file import, image decode, remote fetch, and backup/import refresh
  callbacks do not apply to a changed selection, changed entity, or newer
  draft.
- Full restore/import flows clearly distinguish intentional destructive
  replacement from normal command/projection refresh.

## Boundary Sources

- `../../user-input-layer-audit/` is the persistence inventory and source-anchor
  map.
- `../../user-stale-state-audit/` is the risk and prioritization layer.
- `status.md` owns the current phase router.
- Phase files own implementation handoff details for each pattern/domain.
- The codebase remains the source of truth when line numbers or docs drift.

## Target Contract

Every persisted async user-input path should fit one of these contracts.

### Operation Guard

An async operation records:

- `operationId`: monotonic token or cancellable run id for the local component
  or store.
- `target`: stable entity identity such as `chatId`, `messageId`,
  `characterId`, `presetId`, `pluginId`, or setting key group.
- `sourceRevision`: server revision, entity revision, or local draft version at
  operation start when available.
- `attempt`: the exact fields or collection entries the operation intends to
  change.

Before applying a result, the path verifies that the operation is still the
latest operation for the target, the target still exists and is selected when
selection matters, and live state has not moved away from the attempted values
in a way that would make rollback or finalization stale.

### Dirty Draft Merge

Draft-backed UI owns a per-target dirty map. Projection may update clean fields,
but it must not replace locally dirty fields until the matching command
succeeds, the user discards the draft, or a destructive refresh is confirmed.

This applies first to character drafts, prompt/preset items, translator
presets, persona fields, global regex/settings drafts, lorebook entries,
scripts/triggers, module edit drafts, and plugin argument/storage editors.

### Narrow Rollback

Rollback is allowed only for the attempted field set. The rollback must compare
the current live value with the failed attempted value before restoring the
previous value. Whole-chat, whole-character, whole-collection, or whole-plugin
snapshot rollback is not acceptable for ordinary command failure once a later
user edit can exist.

### Fresh Generation Result

Generation output must persist only if the original chat/message target remains
fresh enough for the requested operation. Continue, reroll, regenerate, partial
edit, dynamic trigger, suggestion-send, and durable generation finalization
must verify the target chat, target message or tail slice, and relevant source
revision after hydration and before persistence.

### Intentional Destructive Refresh

Backup restore, local restore, full import, and bootstrap refresh can replace
large state only when the flow is intentionally destructive or fenced by a
revision/edit check. A normal delayed refresh must not erase newer local dirty
state.

## Invariants

- Server command `baseRevision` checks are necessary but not sufficient.
  Client-side rollback, projection, and async callbacks still need guards.
- Guard helpers should be shared where possible; component-local tokens are
  acceptable when the lifetime is component-only and tests cover it.
- Entity id beats index. Captured indexes must be re-resolved to ids before
  applying async results.
- File/upload helpers should prefer returning data to callers. Callers own
  deciding whether the result is still current.
- Destructive actions must be explicit in code and tests. Do not hide full
  state replacement behind a helper used by ordinary command refresh.
- UI text added for prompts, confirmations, or errors must go through
  `src/lang`.
- Any new server route must update `server/fastify/src/routeManifest.ts`.

## Phase Overview

- [0. Contract & Baseline](phases/phase-0-contract-and-baseline.md): lock
  terminology, helper shape, source-row corrections, and risk priorities.
- [1. Shared Primitives & Rollback](phases/phase-1-shared-primitives-and-rollback.md):
  add reusable operation guards and convert common broad rollback helpers.
- [2. Dirty Draft Projection](phases/phase-2-dirty-draft-projection.md):
  prevent projection/reseed from overwriting dirty drafts.
- [3. Upload, Import & Fetch Callbacks](phases/phase-3-upload-import-fetch-callbacks.md):
  guard long file, upload, decode, import, and remote-fetch callbacks.
- [4. Chat, Messages & Generation](phases/phase-4-chat-messages-generation.md):
  harden composer, auto-translate, reroll, partial edits, dynamic triggers,
  suggestions, and generation finalization.
- [5. Collection Domains](phases/phase-5-collection-domains.md): narrow
  rollback and stale projection in presets, personas, loadouts, lorebooks,
  scripts, modules, plugins, sidebars, and list ordering.
- [6. Resync, Memory & Navigation](phases/phase-6-resync-memory-navigation.md):
  fence full refreshes, memory job updates, route hydration, and selection
  changes.
- [7. Verification](phases/phase-7-verification.md): close the workstream with
  focused regression, browser smoke, and TypeScript proof.

## Risk Priorities

| Priority | Pattern | Primary audit evidence |
| --- | --- | --- |
| P0 | Dirty projection reseeds local drafts | `character-editor.md`, prompt/preset rows, translator rows, global regex/settings rows |
| P0 | Chat/message/generation stale target writes | composer, file-post, reroll, partial edit, trigger, suggestion, durable generation rows |
| P0 | Upload/import callbacks without target tokens | character assets, composer file actions, media settings, module assets, prompt icons, custom backgrounds/themes |
| P1 | Broad optimistic rollback | chat/message helpers, sidebar lists, presets/personas/loadouts, lore/scripts/modules/plugins |
| P1 | Full resync or restore over newer local edits | Realm import, backups, local restore, import helpers |
| P1 | Selection and navigation races | chat select, character open/select, picker rows, route hydration |
| P2 | Display-only stale async results | token counters, provider option fetches, dashboards, memory progress/list rows |

## Not In This Plan

- No database migration unless a phase proves an entity-level revision or field
  version cannot be represented with existing data.
- No redesign of the command protocol beyond what stale-state safety requires.
- No UI redesign beyond confirmations, disabled states, or error surfacing
  needed for destructive refresh and guarded async results.
- No attempt to make intentionally destructive restore/import non-destructive.
  This plan only makes destructive intent explicit and fenced.
- No removal of legacy/browser-local code paths unless they are directly in the
  active Fastify path being hardened.
