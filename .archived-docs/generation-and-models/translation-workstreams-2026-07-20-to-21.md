# Translation Workstreams, July 20–21, 2026

> Archived completion and decision record. These sections describe the named
> commits and their validation state on July 20–21, 2026; consult current source
> for the live translation contract.

This record groups five related workstreams while retaining their chronology
and separate settled decisions.

## Per-Chat Translation Settings

Status: completed on the `fastify` branch on 2026-07-20 in commit `709452d6a`.

### Settled Decisions

- Automatic translation covers newly appended messages and automatic display
  of stored translations. Opening a chat must never request translations for
  pre-existing history. Tail eligibility uses a strict previous-message-ID
  prefix match within the same chat and is one-shot: eligibility is consumed
  before the request starts.
- The global `autoTranslate` database key was removed without compatibility
  handling, and onboarding for `chatLang === 1` no longer pre-enables it.
  `autoTranslateCachedOnly` and `useAutoTranslateInput` remain global.
- The controls live in a per-chat sidebar panel, mounted in both applicable
  locations in `Toggles.svelte`, and are visible only when a translator is
  configured.
- Bilingual display initially placed the original line first and a muted
  translation beneath it. Unpaired lines from the longer side remain as-is,
  and code fences remain whole. Translated lines use
  `x-risu-bilingual-translation`; the sanitizer intentionally preserves
  `x-risu-*` classes.
- Bergamot translation was removed completely, including its code, tests,
  worker assets, and Vite configuration, because the user explicitly did not
  want that translator retained.

### Durable Contract And Validation

- The browser-side `allowClientTranslation` branch in `ChatBody.svelte` is only
  for `idx < 0` previews and greetings. Persisted messages use the server raw
  path through `message.translation` and `translateMessageCommand`; bilingual
  display is server-raw-path only.
- Manually hiding a message translation creates per-component session
  suppression so automatic display does not immediately undo the user's
  choice.
- `autoTranslateBotOnly` gates both automatic display and automatic requests
  for user-role messages. Manual translation remains available for those
  messages.
- New sparse chat fields must be allowed and validated on both sides. The
  precedent recorded here was `selectedDraftHookId` through
  `CHAT_PATCH_ALLOWED_KEYS` in `src/ts/chatCommands.ts` and
  `ALLOWED_CHAT_PATCH_KEYS` in `server/fastify/src/commands/chats.ts`.
- The recorded validation run was green apart from five pre-existing
  `Chat.customHtml.test.ts` branch/hydration failures documented by the Saved
  Toggles workstream.

## Send Text As-Is For LLM Translation

Status: completed on the `fastify` branch on 2026-07-20 in commit `7a2c148e9`.

### Rationale And Settled Decisions

The normal LLM translator split input around protected image, raw, video,
audio, and blank lines. That could turn one translation into many LLM calls,
increasing latency and cost. The chosen mode inserts the original text directly
into `{{slot::content}}` and makes one call.

- The option applies to every Ax. Model translation surface: the server raw
  path and the client `runTranslator`, `translateLLM`, and `translateHTML`
  paths.
- Pass-through is fully verbatim. It bypasses the `<risu-style>` to
  `<style-data>` placeholder swap and `edittrans` display regexes, and stores
  the response byte-for-byte without trimming. The translator-preset prompt
  still wraps the input.
- `translatorSendTextAsIs` is a global boolean with default `false`. Its
  Language-settings checkbox is shown only for a configured LLM translator and
  is labeled **Send Text As-Is**.

### Durable Contract And Validation

- The mode is part of both the server `translatorSettingsHash` and the client
  `getTranslateProfileCacheSignature`, which feeds the LLM cache key and the
  `translateHTML` memo key. Normal and pass-through modes must never share
  cache entries.
- Existing server databases may not hydrate a newly added scalar setting. The
  implementation therefore uses strict `=== true` reads, a settings-item
  `getValue` fallback, and registration in server `BOOLEAN_SETTING_KEYS`,
  server `SETTINGS_GROUP_KEYS`, and client `settingsGroups.ts`.
- The recorded test baseline still contained the same five pre-existing
  `Chat.customHtml.test.ts` failures. A pre-existing Prettier failure in
  `ChatGenerationSettingsControls.svelte`, originating in `56f7a8aab`, was
  explicitly tracked separately.

## Bilingual Pair Grouping And Emphasis

Status: the main implementation completed on the `fastify` branch on
2026-07-21 in commit `0ea8beac0`. Visual-only pair collapse followed in commit
`295aaa3d6`, and empty-pair pruning followed in commit `07e236461`, both dated
2026-07-21.

### Rationale And Settled Decisions

The readability design intentionally combines three mechanisms:

1. Pair proximity uses approximately `0.2em` within a pair and `1.3em` between
   pairs.
2. The de-emphasized side uses container-level
   `filter: saturate(0.4) opacity(0.7)`, `font-size: 0.875em`, and a two-pixel
   left-border gloss indent. A filter was chosen instead of element-specific
   colors so themes and inline Markdown colors mute consistently.
3. The emphasized side leads in DOM order, so visual, selection, copy, and
   screen-reader order agree. CSS `order` or `column-reverse` was rejected
   because it would make copy order surprising.

Additional settled details:

- `bilingualEmphasis?: 'original' | 'translation'` is sparse and per-chat,
  defaults to `original` when absent, and is selectable only while bilingual
  display is enabled. It is per-chat because it is configured beside the
  per-chat bilingual toggle.
- `x-risu-bilingual-pair` wraps a pair. `x-risu-bilingual-muted` identifies the
  de-emphasized side, while `x-risu-bilingual-translation` always identifies
  the translated side. A muted translation carries both role classes. Muted
  `pre` content restores its effective size with `1.142857em`.
- Every non-blank original unit gets a wrapper, including untranslated tails,
  so adjacent-pair spacing remains consistent. Blank lines stay outside pairs;
  each leftover translated unit gets its own pair.

### Follow-Up Corrections

- A pair with no text and only visual elements, such as
  `x-risu-image-container`, `img`, or `hr`, must not render two copies. The
  visual-only collapse keeps exactly one copy, prefers the original because a
  translation may corrupt asset URLs, and removes the muted class from the
  retained side. Interleave position accounting still consumes the translated
  unit. Pairs containing any text retain both sides even when they also contain
  images.
- Interleaving occurs on raw lines before display regexes, CBS, and Markdown.
  Those later stages can consume a line and leave an empty styled wrapper.
  Post-parse `pruneEmptyBilingualPairs(html)` therefore runs between
  `trimMarkdown` and `addMetadataToElement` on both HTML-rendering branches. It
  removes empty sides and then fully empty pairs. Empty `textContent` alone is
  not sufficient evidence for removal because visual-only DOM content may
  still be meaningful. A fast path skips `DOMParser` when there is no pair
  marker.

### Durable Contract And Validation

- Pairing remains line-granular. Several quote and narration sentences on one
  source line form one large unit and one multi-line gloss; screenshot drift in
  that case is expected.
- `setCurrentChatTranslationSettingWithOutcome` became field-generic through
  `ChatTranslationSettingValueByField`, rather than boolean-only.
- The recorded no-key live-check recipe used Google translation after selecting
  a target language. The per-chat controls expose
  `data-risu-chat-translation-setting` selectors. `CheckInput` checkboxes are
  screen-reader-only; Playwright `.check({ force: true })` can still fail as
  outside the viewport, while invoking the element's click works. The
  per-message control uses `.button-icon-translate`.

## Server Auto-Translation And Deferred Push

Status: completed on the `fastify` branch on 2026-07-21 in commit `f649d59f9`.
The recorded verification had 2,656 server tests passing, with Svelte and
server typechecks clean.

### Rationale And Settled Decisions

When generation finishes without an open client on that generation stream, the
server translates the eligible raw message. If notifications are enabled, push
waits for translation to settle or for the configured cap. This closes the
away-client gap: on a fresh load, `newlyAppendedMessageIds` is empty, so the
browser could not discover and automatically translate messages generated
while it was absent.

- Disconnection means no open client on the particular generation stream, not
  absence from the global SSE connection. Inline generation checks response
  socket writability, durable generation checks open `job.clients`, and the
  finalization-retry sweep always treats the client as disconnected.
- `autoTranslateNotificationDeferCapSeconds` defaults to 180. Zero means wait
  for settlement, still bounded by the provider timeout. Its UI is under the
  Notification toggle in Display's other settings.
- The race where a tab is attached at completion but freezes before sending a
  translation request was deliberately left untreated unless it is observed
  in practice.
- Eligible disconnected messages are translated even when push notifications
  are disabled; notification delivery and durable translation completion are
  separate concerns.

### Durable Contract

- `MessageTranslationJobRegistry.register` supersedes a concurrent prior job
  instead of throwing `MessageTranslationAlreadyRunningError`. The prior job
  reaches a late failure because its write is skipped by `isCurrent()`; clients
  had never special-cased the former early error.
- Durable `JobClient.open` also requires `writable !== false` and
  `destroyed !== true`.
- Translation failure releases push immediately. Settlement and cap share an
  exactly-once latch.
- The defer-cap setting follows the existing-database scalar-hydration fallback
  pattern recorded in the UI archive's Chat Screen Width workstream.

## Multi-Step LLM Translation Pipeline

Status: completed on the `fastify` branch on 2026-07-21 in commit `2a47e85f7`.

Translator presets may hold up to five ordered steps with prompt,
`maxResponse`, enabled state, model override, and `outputKey`. The shared pure
`src/ts/translator/pipeline.ts` module drives both client `translateLLM` and
server `rawMessageTranslation.ts`.

### Rationale And Settled Decisions

- The pipeline is a linear list, not a DAG. The Agent Preset engine was not
  reused because its phases, destinations, and mutation layer belong to chat
  generation.
- `{{slot::prev}}` is the previous step output and equals the source for step
  one. `{{slot::out::KEY}}` resolves a prior step by `outputKey`; unknown and
  forward references resolve to empty. `{{slot::content}}` always means the
  original source.
- A non-ChatML prompt containing an embedded input slot becomes one system
  message. This intentionally replaces the earlier system-plus-user fallback.
- Any step failure calls `alertError` and returns the original text. Only the
  final output is cached.
- Per-step model selection uses `profileIdOverride` on
  `requestDataArgument`. Argument-level `fallbackProfileId` is overwritten on
  each `requestChatData` fallback attempt and therefore cannot carry the
  override. A valid override skips the role fallback chain; a missing profile
  silently falls back to translate-role resolution.
- Legacy `preset.prompt`, `preset.maxResponse`, `db.translatorPrompt`, and
  `db.translatorMaxResponse` mirror the first step.
- Non-trivial presets use the `.risutl` v2 container. A trivial single-step
  preset continues to encode as v1.

### Cache And Shared-Module Constraints

Cache correctness requires `translatorPipelineSignature` at the client
settings signature, HTML memo key, LLM cache key, and server
`translatorSettingsHash`. Any new translation-affecting step field must be
added to the signature in `pipeline.ts`, which feeds all four consumers.

The server imports `src/ts/translator/presets.ts`. That shared file therefore
uses dynamic `await import('../util')` for `encrypt`/`decryptBuffer` and relative
imports rather than aliases. Static or alias imports there break the server
typecheck.

### Baseline-Test Follow-Up

The recorded validation diagnosed failures introduced earlier by writer
takeover commit `99ace5424`:

- A mock of `activeWriterSession` lacked the new `isWriterAccessLost` export,
  causing all six `durableMutationTerminalRejection.test.ts` cases to fail.
- A test simulating a stale-writer 423 latched process-global
  `writerAccessLost`, causing 45 later `chatCommands.test.ts` cases to silently
  stop sending server commands.

Commit `6bc1f3bdf` fixed both on 2026-07-21 by adding the mock export and calling
`resetWriterAccessLostForTests()` from the chat-command test setup. Future tests
that simulate 423 must reset this latch; production deliberately has no reset.
The only remaining known baseline failure at that time was the older
`Chat.customHtml.test.ts` group recorded by Saved Toggles.
