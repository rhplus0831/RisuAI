# Chat And Messages Stale State Audit

Audit method: validation-agent review of every row in `docs/user-input-layer-audit/chat-and-messages.md`, with manager normalization of verdicts and terminology.

Verdicts use `Pass`, `Risk`, `Issue`, and `N/A` as defined in `docs/user-stale-state-audit/overview.md`.

| Source item | Verdict | Async boundary | Guard / rollback | Finding |
| --- | --- | --- | --- | --- |
| Main composer textarea | Issue | append command, generation, paste upload | chat identity is checked before send; composer value is not versioned | Delayed clear/restore and paste upload can overwrite newer typed composer or file state. |
| Send button | Issue | same send path as composer | same | Button enters the same stale composer clear/restore path. |
| Stop/cancel generation | Pass | abort, SSE, cancel DELETE | active controller and abort signal | Stop targets active work and does not clear newer local draft state. |
| Empty char message button | Risk | replace-messages command | scoped chat rollback is broad | Failed older replace can restore a stale chat row over newer edits/messages. |
| Auto-translate staging textarea | Issue | translate promise/debounce | partial source check only | Older translation result can write into newer composer or translated textarea state. |
| Continue response menu item | Issue | hydrate and generation | chat identity guard before send | Continue can still clear composer after async prep, losing a newer draft. |
| Auto-translate input toggle | Pass | settings command | attempted-value rollback | Settings bridge avoids reverting newer toggle state. |
| File-post menu action | Issue | picker/upload/file processing | no composer operation token | Older upload/result can append stale asset/text tokens into a newer composer. |
| Auto-suggestions toggle | Pass | settings command | attempted-value rollback | Settings bridge is attempt-aware. |
| Reroll menu item | Issue | hydration, truncate, generate | `doingChat` gate; no post-hydrate active-chat guard | Older reroll action can act on a newly selected chat; rollback is broad. |
| Greeting reroll/unreroll callback | Risk | chat PATCH | chat metadata rollback is broad | Older failure can restore stale `fmIndex` or chat metadata. |
| CreatorQuote remove | Pass | character PATCH | attempted-key row rollback | Character rollback avoids clobbering newer unrelated row changes. |
| Message/comment delete buttons | Risk | confirm, delete/truncate command | scoped chat rollback is broad | Older failure can restore deleted/truncated messages over newer transcript work. |
| Message edit/save button | Risk | message PATCH | scoped chat rollback is broad | No attempted-value guard on rollback. |
| Playground inline message editor | Risk | message PATCH | scoped chat rollback is broad | Actual path is `edit()` and shares the same rollback risk. |
| Playground role swap | Risk | message PATCH or replace | scoped chat rollback is broad | Failed older command can restore a stale chat row. |
| Partial edit textarea/save | Issue | modal lifetime and PATCH | no current message/range guard | Save computes from captured message data; newer edits can be overwritten. |
| Partial delete confirmation | Issue | modal lifetime and PATCH | no current message/range guard | Same captured-message overwrite path as partial save. |
| Bookmark toggle | Risk | prompt and chat PATCH/replace | scoped rollback is broad | Prompt delay can use stale content; failure rollback can clobber newer bookmark metadata. |
| Bookmark modal edit/remove | Risk | prompt and chat PATCH | full chat snapshot rollback | Failed older metadata command can overwrite newer chat metadata. |
| Branch/fork button | Risk | fork command | broad snapshot rollback | Failed fork can restore stale chat list/selection. |
| Message disable/enable buttons | Risk | message PATCH or replace | scoped chat rollback is broad | Older failure can revert newer message state. |
| Reroll previous/next/menu controls | Issue | hydration and tail replace | no active-chat guard after hydration | Delayed reroll can apply to a different active chat; rollback is broad. |
| Reroll candidate select | Issue | tail replace command | scoped chat rollback is broad | Candidate action can apply after a chat switch. |
| New reroll button | Issue | truncate and generation | no active-chat guard after hydration | Same reroll temporal issue. |
| Dynamic rendered chat buttons | Issue | trigger/Lua async | no active chat/character check before applying result | Older trigger result can replace the later active chat state. |
| Suggestion reroll/send controls | Risk | submodel request, translation, chat PATCH | request/chat guards on generation; chat rollback remains broad | Suggestion request/translation is mostly guarded, but suggestion persistence can roll back newer chat metadata; send inherits composer risks. |

