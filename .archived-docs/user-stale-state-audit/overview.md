# User Input Stale State Overview Audit

Audit method: manager synthesis of validation-agent review over `docs/user-input-layer-audit/overview.md`, with local spot checks of command transport, projection reconciliation, settings rollback, and character draft rollback.

Verdicts:

- `Pass`: stale async overwrite protection appears adequate for this row.
- `Risk`: plausible stale overwrite path, usually on failure, rollback, or destructive resync paths.
- `Issue`: normal delayed async completion can overwrite newer user/local state.
- `N/A`: row has no relevant persisted local async state boundary.

## Pattern Keys

| Key | Meaning |
| --- | --- |
| `Cmd` | Command uses `baseRevision` and active-writer headers; server rejects stale revisions. |
| `AttemptRollback` | Rollback only restores when the live value still equals the failed attempted value. |
| `BroadRollback` | Rollback restores a whole snapshot or collection and can clobber newer edits. |
| `ProjectionDirtyGap` | Successful projection/reseed can replace a local draft that changed after the request began. |
| `UploadNoToken` | File/upload/import callback resumes without a request id, entity id, or dirty-state guard. |
| `FullResync` | Import/restore/full bootstrap applies a whole projection and can replace newer local state. |

## Common Write Paths

| Source item | Verdict | Async boundary | Guard / rollback | Finding |
| --- | --- | --- | --- | --- |
| `runServerCommand`, `requestCommandJson` | Pass | command fetch | `Cmd`; caller rollback varies | Transport is revision-gated and reports success events for projection reconciliation. Caller rollback scope is the remaining risk. |
| `patchSettingsGroup` | Pass | command fetch | `Cmd`, `AttemptRollback` via settings bridge callers | Settings command itself is revision-safe; grouped settings callers generally compare before rollback. |
| `applyServerBackedSetting`, `createServerBackedSettingDraft`, `applyServerBackedSettingsPatch` | Pass | debounce and command | pending patches coalesce; rollback compares attempted values | Settings bridge drops pending keys for immediate writes and avoids reverting newer setting values. |
| `createServerBackedCharacterDraft`, `watchServerBackedCharacterProfile` | Risk | debounce and own-command projection | failure rollback compares attempted fields; success projection can reseed drafts | Failure rollback is guarded, but successful character-row projection can replace newer dirty draft values. |
| Chat/message command helpers | Issue | command failure and projection | several helpers use `BroadRollback` | Chat/message helpers include whole-chat or scoped-chat snapshot rollback paths that can restore stale transcripts or metadata over newer edits. |
| `saveAsset`, `uploadServerAssetBytes` | Pass | asset upload | helper returns asset ids; no direct UI state write | Shared upload helpers do not overwrite user state by themselves; call sites must guard late callbacks. |
| Backup/import helpers | Issue | import, restore, full resync | `FullResync`; some routes are intentionally destructive | Restore/import paths can apply whole database/projection state after the user has made newer local changes. |
| Server chat generation request | Issue | durable job, SSE, final persistence | one-job-per-chat helps; target-row freshness is incomplete | Generation finalization can persist against current revision while the target row was edited after assembly. |
| Server memory job helpers | Risk | job events, cancel/list fetches | caller-owned state; progress/list updates need ordering guards | Memory helper functions are narrow, but older progress/list events can replace newer memory UI state. |

## Server Command Families

Server-side command families are generally **Pass** for transaction-level temporal safety because each command receives a `baseRevision` and mutations reject stale revisions. The client-side stale overwrite risks are in optimistic rollback, projection application, and async UI callbacks.

| Source item | Verdict | Async boundary | Guard / rollback | Finding |
| --- | --- | --- | --- | --- |
| Settings | Pass | command fetch | `Cmd` | Server route validates revision and grouped keys. |
| Legacy bot presets | Pass | command fetch | `Cmd` | Server mutation is revision-gated; client broad rollback is audited in preset rows. |
| Model presets | Pass | command fetch | `Cmd` | Server mutation is revision-gated. |
| Prompt presets/settings/items | Pass | command fetch | `Cmd` | Server mutation is revision-gated; client prompt draft projection risk is audited separately. |
| Personas | Pass | command fetch | `Cmd` | Server mutation is revision-gated. |
| Translator presets | Pass | command fetch | `Cmd` | Server mutation is revision-gated. |
| Loadouts | Pass | command fetch | `Cmd` | Server mutation is revision-gated; multi-command client rollback is audited separately. |
| Characters and order | Pass | command fetch | `Cmd` | Server mutation is revision-gated; character draft projection and upload risks are audited separately. |
| Chats/folders/generation settings | Pass | command fetch | `Cmd` | Server mutation is revision-gated; chat rollback risks are client-side. |
| Messages/generation result | Pass | command fetch | `Cmd` | Server mutation is revision-gated; client message rollback and generation freshness risks remain. |
| Lorebooks | Pass | command fetch | `Cmd` | Server mutation is revision-gated; collection rollback risks are client-side. |
| Modules | Pass | command fetch | `Cmd` | Server mutation is revision-gated; module edit/import rollback is client-side. |
| Plugins and plugin storage | Pass | command fetch | `Cmd` | Server mutation is revision-gated; plugin storage rollback can still be broad on the client. |
| Scripts/triggers | Pass | command fetch | `Cmd` | Server mutation is revision-gated; client replacement rollback is broad. |

