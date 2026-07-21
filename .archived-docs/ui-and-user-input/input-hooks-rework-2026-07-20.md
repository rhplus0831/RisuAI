# Input Hooks Rework

> Archived completion and decision record. This describes the named commits
> and their validation state on July 20–21, 2026, not the current input-hook
> implementation.

Status: the main rework completed on the `fastify` branch on 2026-07-20 in
commit `063906fc3`. Commit `2a801ad60` changed the model role and token-limit
behavior on 2026-07-21.

## Settled Design

The former Input Translation Hook became a global list of Input Hooks:
`db.inputHooks` entries contain `id`, `name`, a `draft` or `btw` type, and a
prompt. The list belongs to the advanced settings group. Its deterministic
seed ID is `default-translate`, built from the retained
`defaultInputTranslatorPrompt` constant; the old `db.inputTranslatorPrompt`
field was removed.

Hook selection is per chat through nullable `chat.selectedDraftHookId`. A
dangling ID means no selected hook.

### Draft Hooks

- Composer send runs the selected hook and puts its output in an editable draft
  area above the composer. The original composer text remains intact while the
  draft is being reviewed; the old rollback subsystem was removed.
- Sending the draft performs preflight, appends the draft plus inlay markers,
  and starts generation as one operation.
- Composer, draft, and BTW state clear immediately after the append succeeds,
  before generation, matching normal composer-send behavior. Clearing
  invalidates the composer-operation snapshot, so only
  `isActiveChatTargetFresh` gates the subsequent generation step.

### BTW Hooks And Prompt Context

- BTW hooks run once from a picker. Their result is ephemeral, is replaced by
  the next run, clears on send, and may be dismissed.
- Hook prompts receive only `{{slot::content}}` and `{{slot::draft}}`. ChatML
  parsing remains, while the misspelled `{{solt}}`, CBS, and history access were
  deliberately omitted.
- The execution role changed from `translate` with an explicit
  `translatorMaxResponse` cap to `otherAx` without an explicit `maxTokens`.
  The selected `otherAx` profile's `runtimeOptions.maxResponse`, falling back to
  `db.maxResponse`, owns the cap.

The per-character `useInputTranslationHook`, its sidebar toggle, and the
associated character-command machinery were removed.

## Implementation And Validation Notes

The runner was recorded at `src/ts/process/inputHooks.ts`, with the picker in
`InputHookPickerDialog.svelte`, authoring UI in `InputHookSettings.svelte`, and
in-memory LRU draft/BTW state in `DefaultChatScreen.composerDrafts.ts`. The
settings page used `createServerBackedSettingDraft`. Chat scrolling locates the
transcript through `[data-default-chat-chats-container]`, not positional child
indexes.

The recorded full lanes were green apart from the five pre-existing
`Chat.customHtml.test.ts` failures documented by Saved Toggles. A process lesson
from validation was that `cmd | tail` reports the tail process's status rather
than reliably preserving the test command's exit code; validation should log
the command separately and capture its real status.

Deliberately deferred extensions were a per-hook model role or response-limit
override, `{{slot::history}}`, and an action to insert BTW output into the draft.
These were candidates, not active backlog commitments.
