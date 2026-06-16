# Presets, Personas, Loadouts, And Prompts Stale State Audit

Audit method: validation-agent review of every row in `docs/user-input-layer-audit/presets-personas-loadouts-prompts.md`, with manager normalization of verdicts and terminology.

Verdicts use `Pass`, `Risk`, `Issue`, and `N/A` as defined in `docs/user-stale-state-audit/overview.md`.

| Source item | Verdict | Async boundary | Guard / rollback | Finding |
| --- | --- | --- | --- | --- |
| Preset row/select button | Risk | command response, projection, active-chat save queue | `baseRevision`; global/chat rollback can be broad | Older failed selection/save can revert newer selection state. |
| Legacy extract/delete/copy controls | Risk | extract command | broad preset snapshot rollback; source row has stale controls | Extract failure can restore old preset collections over newer changes. |
| Preset rename input | Pass | debounce timer and command | stable id lookup, flush on destroy, field attempted rollback | Older rollback skips if the name has already moved on. |
| Remove modern preset | Risk | confirm and delete command | broad preset snapshot rollback | Failed older delete can restore list/selection over newer preset edits. |
| Create preset button | Risk | create command | broad preset snapshot rollback | Failed older create can remove later local preset changes. |
| Import preset button | Risk | file import and command | broad preset snapshot rollback | Imported append can be rolled back over later preset edits. |
| Edit/reorder mode | Risk | reorder command | edit toggle is local; drag rollback is broad | Older reorder failure can restore old ordering/selection. |
| Prompt settings draft keys | Issue | debounce timer and projection | rollback checks attempted values; projection lacks dirty guard | Older server projection can reset a newer unsent prompt-settings draft. |
| Create prompt item button | Issue | create command and projection reconcile | rollback compares whole-template attempt | Command success projection can replace newer edits made before response. |
| Delete prompt item button | Issue | delete command and projection reconcile | attempted whole-template rollback only | Older projection can clear later local template changes. |
| Prompt item drag/reorder | Issue | reorder command and projection reconcile | attempted whole-template rollback only | Older projection can rebase draft to stale server order. |
| Prompt setting inputs | Issue | debounce timer and projection | attempted rollback; no projection dirty guard | Same stale debounced draft overwrite path. |
| Add prompt item button | Issue | create command and projection | attempted whole-template rollback | New item edits can be overwritten by older create projection. |
| Prompt item move/delete buttons | Issue | parent reorder/delete command | attempted whole-template rollback | Later item edits/order can be overwritten by older projection. |
| Prompt item name input | Issue | debounce timer and projection | per-item attempted rollback | Older item projection can reset newer unsent name. |
| Prompt item text/default/format fields | Issue | debounce timer and projection | per-item attempted rollback | Same stale prompt-item draft overwrite path. |
| Prompt item card controls | Issue | debounce timer and projection | per-item attempted rollback | Type, role, range, and check edits have the same projection gap. |
| Persona sortable list | Risk | reorder command/projection | whole-persona rollback checks are coarse | Projection/rollback can still replace a later local reorder. |
| Persona row select | Risk | select command | full persona snapshot rollback | Older failed select can restore prior selected persona/profile. |
| Create/import persona chooser | Risk | import/upload/create command | full persona snapshot rollback | Older create/import failure can revert newer persona edits. |
| Persona icon button | Issue | file select and asset upload | no selected-persona id guard after upload | Upload completion can write to whichever persona is selected then. |
| Persona name input | Issue | debounce timer and projection | pending coalesces by persona; rollback attempted guard | Older projection can overwrite a newer pending field edit. |
| Persona note textarea | Issue | debounce timer and projection | same as persona name | Same stale pending persona edit path. |
| Persona prompt textarea | Issue | debounce timer and projection | same as persona name | Same stale pending persona edit path. |
| Import persona button | Risk | PNG parse, asset upload, create command | full persona snapshot rollback | Later persona state can be lost on older import failure. |
| Delete selected persona button | Risk | confirm and delete command | full persona snapshot rollback | Older delete failure can restore old persona list/profile. |
| Persona picker row | Risk | persona select or active-chat save | full persona/chat-generation rollback | Older failed save can revert newer selection. |
| Translator preset select | Risk | flush pending and select command | pending flushed first; full snapshot rollback | Failure can still restore over later translator state. |
| Create translator preset button | Risk | create command | full snapshot rollback | Failure rollback can clobber later translator edits. |
| Translator rename prompt/input | Issue | debounce timer and projection | attempted-preset rollback guard | Older projection can reset newer unsent rename. |
| Delete translator preset button | Risk | flush pending and delete command | full snapshot rollback | Later translator state can be restored away on failure. |
| Import translator preset button | Risk | file decode and create command | flush pending; full snapshot rollback | Older import failure can clobber later state. |
| Translator max response field | Issue | debounce timer and projection | attempted-preset rollback guard | Older projection can overwrite newer field value. |
| Translator prompt textarea | Issue | debounce timer and projection | attempted-preset rollback guard | Same stale translator draft path. |
| Loadout select row | Issue | multi-command sequence and optional preset hydration | hydration checks id/selection; sequence rollback is broad | Failed older sequence can restore persona/preset/module/settings over newer state. |
| Loadout favorite button | Risk | favorite command | full loadout rollback | Older failure can revert newer loadout edits. |
| Delete loadout button | Risk | delete command | full loadout rollback | Older failure can restore deleted or changed loadouts. |
| Loadout name input | N/A | none until Save | local draft only | No async overwrite path in the field itself. |
| Save current loadout button | Risk | create command | full loadout rollback | Failed older save can remove later loadout changes. |

