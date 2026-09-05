# Sidebar Snapshot Scope Inventory

Source before Phase 2a: `b3873f52d`. This is a caller/mutation-scope inventory;
implementation disposition and verification belong in [status.md](../status.md).
The live `currentChatStateSnapshot` callers are confined to the four owners below;
its implementation in `src/ts/chatCommands.ts` clones every resident character.

| Owner / action | Actually affected state | Required rollback ownership |
| --- | --- | --- |
| `src/lib/SideBars/SideChatList.svelte`: fold, color, folder rename, chat rename | One supplied metadata field on one identified owner | Stable character/chat/folder IDs, previous and attempted supplied fields; existing projection and pending-attempt fences |
| `src/lib/Others/ChatList.svelte`: rename | One chat name | Same narrow metadata contract; the compact list must not keep a broad capture after the sidebar changes |
| Both chat lists: create | New chat and selected-chat pointer | Existing chat IDs, previous selected ID, new attempted row; only a same-ID collision needs that previous row |
| Sidebar: create folder | New folder | Folder identity/order and attempted row; no transcript |
| Both lists: delete chat | Removed chat and selection/order | The removed row plus original position/selection, with newer surviving rows untouched |
| Sidebar: delete folder | Removed folder and its chats' folder assignments | Folder metadata/position and only affected assignment fields; no transcript |
| Sidebar: organize, move between folders, move folder, drag chat/folder order | IDs/order, folder assignments, selection | Complete affected order/assignments by ID; no chat bodies or unrelated character records |
| Sidebar: fork; `src/lib/ChatScreens/Chat.svelte`: message branch | New cloned chat, optional new folder, source folder assignment, selection | Separately owned new transcript is required; rollback needs the new IDs/rows, previous selection and supplied source metadata, not unrelated histories |
| Sidebar: reset after export | All chats of the selected character and selection | All removed target rows are required for rollback, with authoritative refresh/newer-edit guards; unrelated characters remain excluded |
| `src/ts/characters.ts`: import | New incoming chats/folders and selection; accepted-prefix/suffix settlement | Existing target identities/selection and attempted imported rows; preserve accepted prefix and only undo failed suffix |

The existing structural rollback implementations already apply attempted-value,
keyed-list, selection, and character-projection fences. Their broad input is
usually immediately reduced to a smaller rollback record. Narrowing capture
must reuse these semantics and distinguish required removed/new transcript
ownership from unnecessary snapshots of surviving/unrelated rows. A sparse or
partial snapshot must have a truthful type; it must not pretend to be an entire
`character`/`Chat` merely to satisfy old helper signatures.

The old full-state shape also remains an input to compatibility message helper
APIs and tests. Audit live callers separately from exported compatibility
signatures; replacing a sidebar caller does not require deleting every legacy
helper, nor does retaining an unused compatibility helper justify a live broad
sidebar capture.
