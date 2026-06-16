# Sidebar And Chat Lists Stale State Audit

Audit method: validation-agent review of every row in `docs/user-input-layer-audit/sidebar-chat-lists.md`, with manager normalization of verdicts and terminology.

Verdicts use `Pass`, `Risk`, `Issue`, and `N/A` as defined in `docs/user-stale-state-audit/overview.md`.

| Source item | Verdict | Async boundary | Guard / rollback | Finding |
| --- | --- | --- | --- | --- |
| Side chat list new-chat button | Risk | create command | full chat-list rollback | Older failed create can wipe newer chat list or selection changes. |
| Folder folded toggle | Risk | folder PATCH | full folder/chat rollback | No attempted-value guard. |
| Folder name input | Risk | folder PATCH | optimistic write plus broad rollback | Earlier failed rename can revert a later folder name. |
| Folder color menu | Risk | folder PATCH | broad rollback | Same folder metadata rollback risk. |
| Delete folder button | Risk | DELETE command | broad rollback | Older failure can restore stale folders/chats over newer changes. |
| Sidebar chat row select | Issue | route/select PATCH | chat-page rollback is unguarded | Older select failure can revert a newer chat selection. |
| Sidebar chat row rename | Risk | chat PATCH | optimistic write plus broad rollback | Earlier failed rename can overwrite newer name/list state. |
| Chat options fork/bind | Risk | fork or chat PATCH | broad rollback | Failure after later list/metadata changes can restore stale state. |
| Delete chat button | Risk | confirm and DELETE | optimistic delete plus broad rollback | Older failure can restore stale chat list/selection. |
| Sortable chat/folder reorder | Risk | reorder commands and delayed Sortable rebuild | broad rollback; timer is not route-tokened | Older failed reorder can undo newer ordering. |
| Sidebar import chat button | Risk | file picker/import sequence | broad rollback | Failed import can restore stale chat/character snapshot; `.txt` is also a stale source-row issue. |
| Create chat folder button | Risk | create command | broad rollback | Older failure can wipe newer folder/list changes. |
| Modal chat row select | Issue | route/select PATCH | chat-page rollback is unguarded | Same stale selection overwrite as sidebar rows. |
| Modal chat rename | Risk | chat PATCH | broad rollback | No attempted-value guard. |
| Modal delete chat | Risk | confirm and DELETE | optimistic delete plus broad rollback | Can revert newer selection/list state. |
| Modal create chat | Risk | create command | optimistic create plus broad rollback | Same create rollback risk. |
| Modal import chat | Risk | file picker/import sequence | broad rollback | Same import rollback risk. |
| Author note textarea | Risk | debounce and chat PATCH | draft/chat-id sync guards normal flow; rollback is broad | Failed older save can roll chat note back over a newer note. |
| Sidebar generation toggles | Risk | queued generation-settings PUT | per-chat queue; rollback is broad | Older failed save can revert later local toggle state. |
| Jailbreak toggle controls | Risk | queued generation-settings PUT | same | Same generation-settings rollback risk. |
| Hypa memory checkboxes | Risk | character PATCH | scoped character rollback is not fully attempted guarded for this path | Toggle twice plus older failure can revert newer value. |
| Generation picker controls | Risk | picker selection and PUT | queued save; rollback is broad | Older failed selection can revert newer generation settings. |
| Persona picker row | Risk | persona select or chat generation-settings PUT | selector source row is stale; rollback is broad | Current selector differs, but temporal risk is the same selection rollback. |
| DevTool variable fields | Risk | scriptstate PATCH | scriptstate rollback is broad | Older failed write can restore stale variable map. |
| DevTool autopilot | Risk | file import and sequential append/generate | no active-chat lock across loop | Chat can change between iterations; later appends may land on the new active chat. |
| Custom sidebar settings | Pass | settings debounce/PATCH | attempted-value rollback | Settings bridge avoids stale rollback overwrite. |
| Character open/select controls | Issue | route apply, shell hydration, select command | no route generation guard; selection rollback is broad | Older route/hydration/select can set selected character after newer navigation. |
| Character drag/drop reorder | Risk | reorder command | broad order rollback | Older failed reorder can undo newer ordering. |
| Drop character on folder | Risk | reorder command | broad order rollback | Same ordering rollback risk. |
| Folder context menu | Issue | prompt, asset upload, reorder command | folder id target helps; upload has no request token | Older image upload can overwrite newer folder image; rename/color share rollback risk. |
| Add character button | Risk | modal/import/create command | broad rollback and selection side effects | Long import/create can select or restore over newer state. |
| Grid trash character | Risk | confirm and character PATCH | trash/order rollback is broad | Older failure can revert newer trash/order state. |
| Grid restore character | Risk | character PATCH | broad rollback | No attempted guard. |
| Grid permanent delete | Risk | confirm and DELETE | broad rollback | Can restore stale character list/order. |
| Mobile add character button | Risk | same add/import path | broad rollback and selection side effects | Same stale create/import risk as desktop add character. |

