# Lorebooks, Scripts, Modules, And Plugins Stale State Audit

Audit method: validation-agent review of every row in `docs/user-input-layer-audit/lorebooks-scripts-modules-plugins.md`, with manager normalization of verdicts and terminology.

Verdicts use `Pass`, `Risk`, `Issue`, and `N/A` as defined in `docs/user-stale-state-audit/overview.md`.

| Source item | Verdict | Async boundary | Guard / rollback | Finding |
| --- | --- | --- | --- | --- |
| Global lorebook select/name field | Risk | select command and rename watcher | scoped rollback, no attempted-value guard | Older rename/select failure can restore stale global lorebook state. |
| Global lorebook create/import/export controls | Risk | create command | create rollback can be broad; source row has stale import/export controls | Create failure can restore stale list/page. |
| Character lore settings fields | Issue | character draft/watch projection | character draft reseeds on projection | Older projection can reset newer local lore settings draft. |
| Character lorebook callbacks | Issue | debounce replacement command | scoped rollback is unconditional | Older failure can restore stale lore collection. |
| Chat local lorebook callbacks | Issue | debounce replacement command | scoped rollback is unconditional | Same stale collection rollback path. |
| Lorebook action buttons | Issue | import/file and replacement/upsert commands | stub guard helps hydration; rollback is broad | Adds/imports/toggles can be reverted over later lore edits. |
| Lorebook entry card | Issue | entry debounce, token delay | token result display-only; entry rollback broad | Older failed entry upsert can overwrite newer entry draft. |
| Global regex list | Issue | settings debounce and projection | no projection dirty guard | Older projection can reset newer regex settings draft. |
| Regex list | Issue | parent debounce/replacement | parent rollback varies and is often broad | Older async parent save can replace newer collection edits. |
| Regex data fields | Issue | same parent save path | same | Same stale script collection path. |
| Trigger version switch/list | Issue | script-definition debounce | scoped rollback is unconditional | Older trigger replacement can restore stale rows. |
| Add trigger v1 button | Issue | script-definition debounce | scoped rollback is unconditional | Same stale trigger collection path. |
| Trigger v1 fields | Issue | script-definition debounce | scoped rollback is unconditional | Older save can overwrite newer nested trigger edits. |
| Import trigger file button | Issue | file import plus debounce | scoped rollback is unconditional | Imported trigger rows can be replaced by older failure. |
| Trigger v2 buttons | Issue | script-definition debounce | scoped rollback is unconditional | Same stale nested trigger/effect path. |
| Deprecated trigger display setting | Issue | settings debounce and projection | no projection dirty guard | Older projection can reset newer setting draft. |
| Module enable button | Risk | enable command | global module snapshot rollback | Older failure can restore stale enabled module state. |
| Module delete button | Risk | delete command | global module/ref snapshot rollback | Older failure can restore stale module list/references. |
| Module import button | Risk | file parse and create command | `.risum` exits; create rollback broad | Older import failure can clobber later module state. |
| Create module submit button | Risk | create command | global module rollback | Later module state can be lost on older create failure. |
| Save module edit button | Risk | update command | global module rollback | Older update failure can restore whole module snapshot. |
| Module basic fields | N/A | none until submit | local module draft only | Async persistence is covered by create/edit submit rows. |
| Module lorebook callbacks/buttons | Issue | debounce replacement/import | scoped rollback is unconditional | Older lorebook command can restore stale module lore rows. |
| Module scripts/triggers | Issue | debounce replacement/import | scoped rollback is unconditional | Older script/trigger save can overwrite newer nested rows. |
| Module asset controls | Issue | asset upload promise | no module/run guard before mutating draft | Upload completion can append to a changed module draft. |
| Chat module picker | Risk | chat/character module command | scoped rollback lacks attempted guard | Older failure can revert newer module assignment. |
| Plugin update button | Issue | update fetch, import/patch command | no plugin-generation guard; full rollback | Update result can patch after delete/reinstall or overwrite newer args/state. |
| Enable plugin button | Risk | enable command and plugin reload | full plugin snapshot rollback | Older failure can revert newer plugin list/provider/storage state. |
| Delete plugin button | Risk | confirm, delete command, reload | full plugin snapshot rollback | Older failure can restore stale plugin state. |
| Plugin argument controls | Issue | immediate update command | full plugin snapshot rollback | Older arg failure can revert newer arg edits. |
| Import plugin button | Issue | file select/parse/confirm and create/update command | full plugin rollback; no list-version guard | Import result can apply to a plugin list that changed while reading/confirming. |
| Plugin provider selector | Risk | provider command/settings projection | plugin/settings rollback can be broad | Older provider save can restore stale provider selection. |
| Plugin custom storage API | Issue | plugin async storage commands | full storage snapshot rollback | Older failed storage op can restore whole storage over newer key writes. |

