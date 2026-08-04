# DL2 Pass 2 report — codex

## Checks

- Durable Lua character/lore writes (`492f99e9e`) — FINDING DL2-P2-1 — Lua setters are write-gated (`server/fastify/src/prompt/luaRuntime.ts:1493-1503`) and the normal persistence path re-reads character/lore state inside a synchronous targeted transaction (`server/fastify/src/routes/generationChat.ts:1449-1468`; `server/fastify/src/commands/mutations.ts:216-251`). However, an input-trigger-only local-lore write is dropped before that path sees it (`server/fastify/src/prompt/assemble.ts:1078-1098`).
- Persisted `@@inject` rewrites + stable-card re-expansion (`b193042e0`) — FINDING DL2-P2-2, DL2-P2-3 — Existing-row injects are identity-addressed and compare the live row with `before` (`server/fastify/src/routes/generationChat.ts:1492-1513`). Assembly chat-variable writes do not perform the equivalent fresh-value check (`server/fastify/src/routes/generationChat.ts:1403-1410,1469-1477`), and the absent-initial-row inject fallback replaces the whole live transcript without a snapshot comparison (`server/fastify/src/prompt/assemble.ts:1815-1829`; `server/fastify/src/routes/generationChat.ts:1479-1491`).
- Script message-index preservation (`5f4109fee`) and IGP sequencing (`400183698`) — SAFE — Edit-input/output and history expansion consistently receive the assembly row index (`server/fastify/src/prompt/assemble.ts:1146-1174,2579-2595`; `server/fastify/src/prompt/history.ts:295-335`). Server terminal reconciliation resolves a stable character/chat/message identity before IGP (`src/ts/process/serverBackedSendChat.ts:860-888`); after the IGP await, the client rechecks text/generation identity and sends matching durable preconditions (`src/ts/process/postGeneration/igp.ts:48-86`), which the server rechecks inside its transaction (`server/fastify/src/routes/commands.ts:6804-6827`).
- Lorebook prompt-injection restore (`a4c00c5cb`) and history slots in input hooks (`559b61a4b`) — SAFE — Lorebook injection operates only on local prompt strings/slot arrays (`server/fastify/src/prompt/lorebook.ts:1338-1359,1396-1433`). History slots collect from a copied context and render local strings (`src/ts/translator/historySlots.ts:86-125,170-196`); after hydration/model awaits, composer writes are guarded by both the latched active target and operation token (`src/lib/ChatScreens/DefaultChatScreen.svelte:1168-1196,1243-1259,1293-1307`).

## Findings

### DL2-P2-1 — Input-trigger local-lore upserts disappear

- Severity: high / Confidence: certain
- Evidence: `upsertLocalLoreBook` replaces the array on its supplied chat object: `chat.localLore = (chat.localLore ?? []).filter(...)` (`server/fastify/src/prompt/luaRuntime.ts:1842-1846`). The input trigger receives a shallow chat copy, `chat: { ...state.currentChat, message: priorMessages }`, but `state.currentChat = result.chat` runs only when `firstChangedMessageIndex(...) !== undefined` (`server/fastify/src/prompt/assemble.ts:1078-1098`). Consequently `buildLocalLoreMutation` later reads the unchanged `state.currentChat.localLore` and emits nothing (`server/fastify/src/prompt/assemble.ts:1315-1318`).
- Loss scenario: A user's successful input trigger calls `upsertLocalLoreBook` but does not alter any message. The host function updates only the trigger's shallow chat copy; the assembler declines to adopt that copy, produces no local-lore mutation, and the requested new/replacement lore content is silently absent after the send and reload.
- Fix direction: After every successful input trigger, merge the result's durable non-transcript fields (at least `localLore`) into assembly state independently of the transcript-change test. Preserve the existing conditional adoption only for `message`, then let the existing before/after freshness path persist the lore delta.

### DL2-P2-2 — Assembly variable persistence overwrites a newer value

- Severity: medium / Confidence: certain
- Evidence: The assembler retains per-key `before` and `after` values (`server/fastify/src/prompt/assemble.ts:1281-1291`), including stable-card writes replayed for final render (`server/fastify/src/prompt/assemble.ts:892-920`). `persistAssemblyMutations` discards `before`, builds only an after-value patch (`server/fastify/src/routes/generationChat.ts:1403-1410`), reads the current revision only after asynchronous assembly (`server/fastify/src/routes/generationChat.ts:1439-1456`), and unconditionally executes `Object.assign(chat.scriptstate, patch)` on the freshly loaded chat (`server/fastify/src/routes/generationChat.ts:1469-1477`). A suitable per-key validator exists at `server/fastify/src/routes/generationChat.ts:2712-2725` but is used only during generation finalization (`server/fastify/src/routes/generationChat.ts:2852-2856`).
- Loss scenario: A stable card derives `$score = 1` from an assembly snapshot where `$score = 0`. While tokenization/Lua/prompt work is awaiting, another accepted same-writer command stores `$score = 9`. Assembly persistence then reads the new global revision, so revision validation succeeds, but blindly writes the stale derived `1`; the accepted `9` is durably lost.
- Fix direction: Inside the assembly transaction, validate every live chat-variable value against the mutation's `before` value before applying `after` (reuse `validateGenerationChatVarMutationsFresh`). On mismatch, reject/reassemble rather than overwriting.

### DL2-P2-3 — Inject fallback can replace away concurrent messages

- Severity: medium / Confidence: certain
- Evidence: When an injected row was not in `initialMessages`, the assembler sets `historyInjectRequiresTranscriptReplacement` and snapshots the entire working transcript (`server/fastify/src/prompt/assemble.ts:1815-1829,1357-1368`). Any `replace_by_id` mutation makes the append optimization return false (`server/fastify/src/routes/generationChat.ts:1356-1375`), after which persistence calls `replaceActiveChatMessages(...)` without comparing the live transcript to the assembly baseline (`server/fastify/src/routes/generationChat.ts:1479-1491`). As with variable writes, the route obtains `baseRevision` immediately before persistence rather than carrying the assembly-start revision (`server/fastify/src/routes/generationChat.ts:1439-1452`).
- Loss scenario: A successful start/input script creates a message after assembly begins, and a history `@@inject` rewrites that new row, selecting the full-transcript fallback. Before assembly persists, another accepted same-writer operation appends or edits a message in the same chat. The fallback accepts the now-current revision and replaces the message table with its older snapshot, durably deleting the concurrent message/edit.
- Fix direction: Express the fallback as identity-addressed append/update operations with per-row preconditions. If a full replacement remains necessary, carry and compare an assembly-start transcript fingerprint/revision inside the transaction and reject/reassemble when live rows differ.

## Free-hunt findings

No additional findings inside the Pass 2 surface.

## Not examined

- No enumerated Pass 2 item was omitted. Dynamic execution and regression tests were not performed because the brief prohibits test-suite and dev-server runs; verdicts are based on static end-to-end tracing.
- Passes 1 and 3-5, the charter's explicit out-of-scope list, and generation correctness unrelated to durable-state writes were intentionally not examined.

Co-Authored-By: Codex <noreply@openai.com>
