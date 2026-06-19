# Character Editor Stale State Audit

Audit method: validation-agent review of every row in `docs/user-input-layer-audit/character-editor.md`, with manager normalization of verdicts and terminology.

Verdicts use `Pass`, `Risk`, `Issue`, and `N/A` as defined in `docs/user-stale-state-audit/overview.md`.

Common character-editor patterns:

- `CharacterProjectionDirtyGap`: failure rollback checks attempted fields, but older successful character-row projection can reseed a newer dirty draft.
- `UploadNoCharacterToken`: picker/upload resumes without checking the original character id, selected index, or request run.
- `ReplacementRollback`: script, trigger, lore, and module replacements often roll back whole collections.

| Source item | Verdict | Async boundary | Guard / rollback | Finding |
| --- | --- | --- | --- | --- |
| Character name | Issue | debounce and character projection | failure rollback is attempted-field guarded | Older successful projection can reseed newer draft text. |
| Description textarea | Issue | debounce and character projection | attempted-field rollback | Same character draft projection gap. |
| First message textarea | Issue | debounce and character projection | attempted-field rollback | Same character draft projection gap. |
| Background HTML textarea | Issue | debounce and character projection | attempted-field rollback | Newer HTML draft can be replaced by older row projection. |
| Virtual script textarea | Issue | debounce and character projection | attempted-field rollback | Newer script text can be replaced by older row projection. |
| Example message textarea | Issue | debounce and character projection | attempted-field rollback | Same character draft projection gap. |
| Creator notes multilingual input | Issue | debounce and character projection | attempted-field rollback | Same character draft projection gap. |
| System prompt textarea | Issue | debounce and character projection | attempted-field rollback | Same character draft projection gap. |
| Replace global note textarea | Issue | debounce and character projection | attempted-field rollback | Same character draft projection gap. |
| Additional text textarea | Issue | debounce and character projection | attempted-field rollback | Same character draft projection gap. |
| Personality textarea | Issue | debounce and character projection | attempted-field rollback | Same character draft projection gap. |
| Scenario textarea | Issue | debounce and character projection | attempted-field rollback | Same character draft projection gap. |
| Default variables textarea | Issue | debounce and character projection | attempted-field rollback | Same character draft projection gap. |
| Translator note textarea | Issue | debounce and character projection | attempted-field rollback | Same character draft projection gap. |
| Creator metadata text input | Issue | debounce and character projection | attempted-field rollback | Nested draft fields can be replaced by stale projection. |
| Character version text input | Issue | debounce and character projection | attempted-field rollback | Nested `additionalData` draft can be replaced by stale projection. |
| Nickname text input | Issue | debounce and character projection | attempted-field rollback | Same character draft projection gap. |
| Depth prompt text input | Issue | debounce and character projection | attempted-field rollback | Nested `depth_prompt` draft can be replaced by stale projection. |
| Existing avatar/CC asset button | Issue | character PATCH projection | scoped failure rollback only | Rotate/clear/select can be overwritten by older character-row reconcile. |
| Remove character CC asset | Issue | debounce and projection | attempted-field rollback | Removal is local first, but stale success projection can restore old `ccAssets`. |
| Select avatar button | Issue | file picker/upload and character PATCH | `UploadNoCharacterToken` | Upload completion writes using captured selection after awaits; newer avatar/selection changes can be overwritten. |
| Emotion name text input | Issue | debounce and projection | attempted-field rollback | Bound array edit can be replaced by older row projection. |
| Remove emotion button | Issue | command projection | scoped failure rollback | Older row projection can restore removed emotion or drop newer emotion edits. |
| Add emotion image button | Issue | multi-file upload | `UploadNoCharacterToken` | Late upload can append to a stale character/emotion list. |
| Emotion instructions textarea | Issue | debounce and projection | attempted-field rollback | Nested `newGenData` can be replaced by stale projection. |
| Image-generation prompt/negative/instructions | Issue | debounce and projection | attempted-field rollback | Nested image-generation fields can be replaced wholesale. |
| Additional asset upload button | Issue | picker/upload loop | `UploadNoCharacterToken` | Late upload mutates live draft after awaits and can append to the wrong or newer draft. |
| Additional asset rename input | Issue | debounce and projection | attempted-field rollback | Asset list edits can be restored by stale projection. |
| Remove additional asset button | Issue | debounce and projection | attempted-field rollback | Asset list edits can be restored by stale projection. |
| Prebuilt exclude button | Issue | debounce and projection | attempted-field rollback | Exclude list can be restored/cleared by older projection. |
| Quick asset add button | Issue | picker/upload | stale prop/current character is not guarded | Builds `nextAdditionalAssets` from old props and can replace a newer list. |
| Regex/script list binding | Issue | debounce/import and script replacement command | `ReplacementRollback` | Older failed or successful replace can wipe newer script draft. |
| Add regex button | Issue | script replacement command | `ReplacementRollback` | Same script collection path. |
| Import regex button | Issue | file read and script replacement | no import run guard; rollback is broad | Imported draft can be based on stale collection state. |
| Trigger editor | Issue | debounce and trigger replacement | `ReplacementRollback` | Trigger draft can be restored to an older snapshot after newer edits. |
| Regex editor rows | Issue | parent debounce/replacement | `ReplacementRollback` | Row edits share the stale script replacement path. |
| Trigger v1 fields | Issue | parent debounce/replacement | `ReplacementRollback` | Nested trigger edits can be overwritten by older replace. |
| Trigger v2 add/remove/import/export controls | Issue | delayed callbacks/import and replacement | `ReplacementRollback`; export itself is read-only | Persistent v2 trigger/effect edits share the stale replacement path. |
| NovelAI custom voice input | Issue | debounce and projection | attempted-field rollback | Nested TTS config can be replaced by older row projection. |
| OpenAI TTS fields | Issue | debounce and projection | attempted-field rollback | Whole nested config is vulnerable to stale projection overwrite. |
| Hugging Face TTS fields | Issue | debounce and projection | attempted-field rollback | Same nested TTS draft path. |
| VITS select model button | Issue | model file upload/register | `UploadNoCharacterToken` | Late model registration writes `vits` after newer TTS/character changes. |
| GPT-SoVITS URL/ref/prompt fields | Issue | debounce and projection | attempted-field rollback | Nested config can be replaced by stale row projection. |
| GPT-SoVITS reference audio button | Issue | file picker/upload | `UploadNoCharacterToken` | Late upload writes `ref_audio_data` into current draft after newer changes. |
| Add bias button | Issue | debounce and projection | attempted-field rollback | Bias array can be restored/replaced by older projection. |
| Bias string input | Issue | debounce and projection | attempted-field rollback | Bias row edit can be restored/replaced by older projection. |
| Remove bias button | Issue | debounce and projection | attempted-field rollback | Bias array can be restored/replaced by older projection. |
| Add alternate greeting button | Issue | debounce and projection | attempted-field rollback | Greeting array can be restored/replaced by older projection. |
| Alternate greeting textarea | Issue | debounce and projection | attempted-field rollback | Greeting text can be restored/replaced by older projection. |
| Alternate greeting reorder/remove buttons | Issue | debounce and projection | attempted-field rollback | Greeting order/removal can be restored by stale projection. |
| Remove character button | Issue | confirmation dialogs and command rollback | captured index; rollback can be broad | After async confirmations, the index/selection may point at a different row or rollback can restore stale list state. |
| Hypa modal button | N/A | modal open only | none needed | This row only opens modal state. |
| Apply module button | Issue | module picker and sequenced commands | broad collection rollback | Failed older module-apply command can overwrite newer lorebook/script/trigger edits. |

