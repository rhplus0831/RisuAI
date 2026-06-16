# Settings And Provider Fields Stale State Audit

Audit method: validation-agent review of every row in `docs/user-input-layer-audit/settings-and-provider-fields.md`, plus manager synthesis against the shared stale-state patterns in `overview.md`.

Verdicts use `Pass`, `Risk`, `Issue`, and `N/A` as defined in `docs/user-stale-state-audit/overview.md`.

| Source item | Verdict | Async boundary | Guard / rollback | Finding |
| --- | --- | --- | --- | --- |
| `SettingRenderer.svelte:33` generic renderer | Pass | none | delegates to wrappers | Renderer has no async write; concrete wrappers own persistence. |
| `SettingText.svelte:38` | Pass | setting command | scalar attempted rollback | Text wrapper writes through `setSettingValue`; scalar rows avoid broad stale rollback. |
| `SettingTextarea.svelte:38` | Pass | setting command | scalar attempted rollback | Same guarded scalar path as `SettingText`. |
| `SettingButton.svelte:14` | N/A | handler-specific | none in wrapper | Button only invokes the row handler; persistence belongs to each concrete handler. |
| `setSettingValue` | Risk | setting command | rollback is safer for scalar replacement than in-place objects | Scalar use is guarded; object/array callers that mutate in place can still be clobbered by stale rollback. |
| Advanced text rows | Pass | setting command | scalar attempted rollback | Bound advanced keys are scalar settings. |
| Chat format textarea | Pass | setting command | scalar attempted rollback | `JinjaTemplate` is a scalar write. |
| Display text/textarea rows | Pass | setting command | scalar or single-root attempted rollback | Text, CSS, and quote rows do not expose a stale async overwrite path beyond guarded setting writes. |
| Language key/url/token rows | Pass | setting command | scalar attempted rollback | Translator cache buttons are not persisted local DB writes. |
| `BotSettings.svelte:98-183` provider drafts | Pass | debounce and command | settings bridge or prompt-preset rollback guards attempted values | Drafts are server-backed or prompt-preset field drafts. |
| `BotSettings.svelte:665-1006` provider fields | Risk | debounce and plugin/provider commands | setting fields are guarded; plugin provider rollback can be broad | Normal text fields pass, but plugin provider selection in this area can restore stale plugin/provider state on failure. |
| `echoMessageDraft.value` | Pass | debounce and command | settings bridge attempted rollback | Server-backed scalar draft. |
| `activeLocalStopStringsDraft` | Pass | debounce and command | settings bridge or prompt-preset attempted rollback | Array replacement is routed through guarded draft paths. |
| `biasDraft` | Pass | prompt-preset command | prompt-preset attempted rollback | Bias controls are synchronous draft edits with guarded persistence. |
| `activeAdditionalParamsDraft` | Risk | file import and command | normal fields guarded; import has no request token | Manual add/remove/text fields pass, but delayed import can assign an older parsed params object over newer edits. |
| `moduleIntergrationDraft.value` | Pass | prompt-preset command | prompt-preset attempted rollback | Textarea draft is guarded. |
| Prompt preset icon upload | Issue | file picker and image decode | `UploadNoToken` | Late icon upload can write to a preset after selection or preset fields changed. |
| Main prompt, jailbreak, global note | Risk | tokenization promises and command | persistence guarded; token counters/display can be stale | Text persistence is guarded, but older tokenization can update counters for newer text. |
| Ooba drafts | Pass | debounce and command | settings bridge attempted rollback | Server-backed drafts only. |
| OpenRouter drafts | Pass | provider-list fetch and setting command | fetched options do not persist user state | Older provider-list results affect option display, not persisted input values. |
| Custom models | Pass | debounce and command | settings bridge attempted rollback | Array edits assign through the server-backed draft. |
| Aux model drafts | Pass | debounce and command | settings bridge attempted rollback | Draft keys map to guarded runtime/provider settings. |
| Separate parameter drafts | Pass | debounce and command | settings bridge or prompt override attempted rollback | Drafts use guarded setting/prompt paths. |
| Easy Panel drafts | Pass | debounce and command | settings bridge attempted rollback | All listed fields are server-backed drafts. |
| NanoGPT dashboard actions | Issue | balance/subscription fetch | no API-key/request guard before persistence | Older fetch for a previous key can persist `nanogptSubscriptionState` after the user changed provider state. |
| OtherBotSettings media/TTS/memory drafts | Pass | debounce and command | settings bridge attempted rollback | Base draft fields are guarded. |
| OtherBotSettings provider text fields | Pass | debounce and command | settings bridge attempted rollback | Text fields are draft-backed; upload controls are listed separately. |
| OtherBotSettings media asset buttons | Issue | file picker and upload | `UploadNoToken` | Late image/reference upload writes draft fields without checking the original request/entity is still current. |
| Hypa V3 preset/buttons/text fields | Risk | prompts, confirms, imports, command | setting persistence guarded; delayed array rebuilds are not fully tokened | Rename/delete/import can rebuild preset arrays from stale state after user edits. |
| Playground embedding drafts | Pass | debounce and command | settings bridge attempted rollback | Persistent fields are server-backed drafts. |
| Custom background buttons | Issue | file picker, image upload, cancel/restore | `UploadNoToken`; cancel can restore stale old value | Older upload or cancel path can overwrite a newer custom background choice. |
| Nullable text color input | Pass | setting command | settings bridge attempted rollback | Synchronous setting patch. |
| Custom color scheme editor | Issue | file import | `UploadNoToken` | Delayed color-scheme import can apply a whole old scheme over newer theme edits. |
| Custom text theme editor | Pass | setting command | settings bridge attempted rollback | Synchronous setting patch. |
| Hotkey editor | Pass | setting command | settings bridge attempted rollback | Clone-and-patch path avoids broad rollback. |
| Custom sidebar config | Pass | debounce and command | settings bridge attempted rollback | Draft array edits are server-backed. |
| Custom sidebar controls | Pass | debounce and delegated setting writes | settings bridge attempted rollback | Model draft and delegated rows use guarded setting paths. |
| Welcome/onboarding setting handlers | Risk | delayed setup callback | no cancellation/version guard | One-shot delayed setup can apply after choices or navigation changed. |

