# Phase 7 Prompt Assembly - 7-12d-i

Date: 2026-05-24

7-12d-i added the typed mutation handoff that 7-12d-ii will serialize as
`message_patch`.

## Landed

- `AssembleResult.mutations` now reports:
  - user-message append operations for `mode: send`;
  - replace-all message operations for run-var expansion, history
    normalization, and start-trigger edits;
  - chat variable deltas from the initial `scriptstate` to the final
    persisted `scriptstate`;
  - placed `additonalSysPrompt` rows for `start`, `historyend`, and
    `promptend`.
- `assemblePrompt` runs the server equivalent of the local
  `runCurrentChatFunction` path over the working chat, so `{{setvar}}`
  / `{{addvar}}` in message text can flip `varChanged`.
- The `/api/v1/generate/chat` route persists `varChanged` database
  state for `send`, `continue`, and `regenerate` modes only. Preview
  modes remain read-only.
- Focused tests cover the mutation payload, abort payload preservation,
  send-mode persistence, and preview-mode non-persistence.

## Next

7-12d-ii should emit the mutation payload as `message_patch`, type the
server and browser event mirrors, teach `requestServerChat` to collect
the patches, and add the SPA applier before local provider dispatch.

## Verification

- `pnpm check` clean.
- `pnpm api:test` 886 tests.
- `pnpm test` 618 tests plus 4 skipped.
- `pnpm build` passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and bundle-size warnings.
