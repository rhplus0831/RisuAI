# Value Change Persistence Audit Roadmap

Date: 2026-06-16

## Context

Recent fixes for Author's Note and module background embedding both addressed the
same class of bug: user input changed a local/draft value, but the value used by
the live projection, command payload, derived cache, or server mutation did not
reflect the edit. The current reported recurrence is non-module character
background embedding, so this audit treats that as one symptom of a broader
write-surface risk.

## Failure Modes To Classify

1. **Draft-only edit**: an input mutates a draft object, but no watcher/flush
   sends a changed patch.
2. **Dispatch-only edit**: code calls a server command helper with a patch but
   never applies the patch to `DBState`, so the current client does not reflect
   the change unless a later projection refresh happens.
3. **Sanitized-away edit**: a valid user-editable field is removed by a client
   sanitizer or rejected by a server validator.
4. **Stale derived cache**: a derived value reuses stale data because the cache
   key does not include edited fields or because an empty value is not written
   back to the store.
5. **Partial persistence**: the server updates JSON but not the corresponding
   SQLite side table, body revision, or projected row used by bootstrap and
   hydration.
6. **Debounce/flush loss**: pending edits are not flushed before selection,
   navigation, unmount, import/export, or send-time use.

## Audit Slices

The audit is split into per-area reports under `docs/[bad|normal]-[name].md`.
Each report should include scope, inspected files, findings, line references,
and suggested tests or fixes.

- Character editor and character profile persistence.
- Module settings and module enablement/prompt side effects.
- Chat and message content editing, including Author's Note.
- Prompt presets, bot settings, loadouts, and provider parameters.
- Global lorebook and regex/script editors.
- Persona and user settings.
- Plugin, custom GUI, and advanced setting editors.
- Display, language, accessibility, and chat-format settings.
- Asset/import/Realm flows.
- Client command wrappers and bridge/watch infrastructure.
- Server command validators, mutations, projection, and body revisions.
- Plugin/Lua/MCP write APIs.

## Management Plan

1. Map each user-input surface to its persistence path:
   UI/draft -> optimistic projection -> command wrapper -> Fastify mutation ->
   projection/bootstrap/hydration.
2. For each surface, classify the behavior against the failure modes above.
3. Record `bad` reports for confirmed or likely recurrence risks and `normal`
   reports where the path applies the edited content correctly.
4. After reports are written, run a verification pass over the docs and the most
   suspicious code paths to confirm coverage and naming.
5. Use the bad reports as the follow-up implementation backlog; prioritize
   issues that affect current user-visible edits before test-only hardening.

## Audit Results

Reports created:

- `docs/normal-character-editor.md`
- `docs/bad-module-settings.md`
- `docs/bad-chat-and-message-content.md`
- `docs/bad-prompt-and-bot-settings.md`
- `docs/bad-lorebook-and-regex.md`
- `docs/bad-persona-and-user-settings.md`
- `docs/bad-plugins-and-advanced-settings.md`
- `docs/bad-display-language-accessibility.md`
- `docs/bad-assets-import-realm.md`
- `docs/bad-client-command-bridges.md`
- `docs/bad-server-command-mutations.md`
- `docs/bad-plugin-script-api-writes.md`

## Prioritized Remediation Roadmap

### P0: User-Visible Optimistic Projection Gaps

- Apply local projection before dispatch for global module create/enable/delete.
- Apply local projection before dispatch for chat and chat-folder title edits.
- Apply local projection before dispatch for global lorebook selection.
- Fix MCP RisuAccess write tools so successful tool writes are visible
  immediately in `DBState`, with rollback on command failure.

### P1: Edits That Can Be Lost Before Command Dispatch

- Flush pending persona edits before server-assembled send/preview, and mirror
  edited text into the selected `personas[]` row.
- Preserve translator preset pending edits when switching/importing/creating
  presets.
- Normalize IDs or route through bridge helpers for module lorebook, regex, and
  trigger add/import paths.
- Persist the custom GUI builder's serialized tree through the server-backed
  settings path.

### P2: Split / Side-Table Persistence Mismatches

- Update loadouts to persist and apply split model/prompt preset selections
  instead of legacy-only `botPresets`.
- Reject or fully persist embedded chat/message/Hypa data when creating
  characters through Fastify commands.
- Fix Realm import metadata and v2 character-card asset export omissions.
- Reject or route unsupported plugin character/chat split-resource writes rather
  than silently leaving client-only or dropped changes.

### Cross-Cutting Guardrails

- Add regression tests around command wrappers that assert user-visible
  mutations either update `DBState` optimistically or intentionally wait for a
  projection refresh.
- Add flush-before-use coverage for send, preview, route switch, import, and
  selection changes.
- Add sanitizer tests that verify valid editable fields survive and split-owned
  fields are either explicitly routed or rejected with a clear error.
