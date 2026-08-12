# Prompt Assembly And Scripting

Last audited: 2026-08-09.

This guide owns server prompt construction, CBS and history variables,
lorebook and memory injection, prompt-template precedence, generation
surfaces, final budgeting, post-generation effects, Lua, and V2 triggers. Start
from the [architecture index](README.md) for cross-cutting ownership.

## Related Guides

- [Providers And Models](providers-and-models.md) owns model/profile resolution,
  provider adapters, runtime options, capability routing, and request history.
- [Translation And Input Hooks](translation-and-input-hooks.md) owns translator
  history slots, draft/BTW input hooks, and generated-message translation.
- [Agents And Presets](agents-and-presets.md) owns Agent Preset planning and the
  before-main/after-main auxiliary model phases.
- [Backend Map](backend.md) owns Fastify composition, route registration, and
  worker lifecycle rather than the behaviors described here.

## Generation Surfaces

`/api/v1/generate/chat` is the normal server-assembled surface. The browser
sends raw chat inputs; Fastify resolves effective settings and profiles,
assembles the prompt, runs provider policy, streams chat frames, derives the
final message, and persists it. The browser bridge is
`src/ts/process/serverBackedSendChat.ts`; route and provider owners are
`server/fastify/src/routes/generationChat.ts` and
`server/fastify/src/prompt/chatDispatch.ts`.

Durable send, continue, and regenerate are the application path.
`server/fastify/src/generationJobs.ts` keeps process-local jobs, emits
`job_accepted`, buffers replayable frames, supports reattach and cancellation,
and exposes active jobs through bootstrap. SQLite-backed finalization retries
protect idempotency and reject stale chat/message/script-state targets. Inline
non-durable SSE remains for tests and tool-style callers.

`/api/v1/generate/preview-prompt` performs the same assembly and readiness
checks without provider dispatch. It can return ordinary HTTP errors because
SSE headers are not committed. Chat assembly errors become terminal SSE error
frames. `/api/v1/generate/completion` is the lower-level shaped-message surface;
its provider contract belongs to
[Providers And Models](providers-and-models.md#chat-dispatch-and-tool-transport).

The browser and server manually mirror chat frame types in
`src/ts/process/request/serverChatEvents.ts` and
`server/fastify/src/prompt/sseEvents.ts`. Additive frame changes must update
both. Negotiated inline streams use
`clientCapabilities.compactPromptEvent` and `promptMetadataOnly` for compact
prompt metadata, `firstChangedIndex` for delta-trimmed message patches, and
`omitDuplicateDoneResult` to omit a repeated `done.result`; durable replay
retains a self-contained result. Normal lower-level completion identifies its
secret-free envelope with `kind: "server-intent"`. Chat rendering and
loading-state ownership is in the
[Svelte Chat UI guide](../../src/docs/svelte-chat-ui.md).

## Effective Configuration And Assembly Order

Browser preflight in `src/ts/process/request/serverPromptAssembly.ts` decides
whether Fastify can faithfully own the request. Server generation then calls
`server/fastify/src/prompt/effectiveGenerationConfig.ts` before
`server/fastify/src/prompt/assemble.ts`.

The effective-config order is selected model preset, prompt-preset generation
fields, prompt-preset model overrides, profile-bound runtime fields, then a
final reapplication of prompt-preset model overrides. Chat-scoped persona,
Agent Preset, jailbreak, sidebar-toggle, and Prompt/Agent module integration
are materialized before assembly. This is an effective request overlay; it does
not rewrite global settings.

`assemblePrompt()` runs these stages in order:

| Stage | Contract |
| --- | --- |
| Scope resolution | Resolve database, character, chat, generation settings, prompt owner, active modules, model profile, and Agent Preset readiness. |
| Submit transforms | Prepare regenerate state, run the input trigger, append the new user row, apply `editinput`, snapshot the submit transcript, and apply run-variable CBS. |
| Agent before-main | Execute the planned before-main Agent dependency graph and apply any single `userInput` modifier. See the Agent guide. |
| Static/plain slots | Build main, character, persona, author-note, jailbreak, and configured plain rows. |
| Lorebook preflight | Activate ordinary lore, distribute positions, expand CBS for token accounting, build depth rows, and preflight the template. |
| History and bias | Format the bounded transcript, per-message scripts/CBS, continuation markers, and logit-bias rows. |
| Memory bridge | Select already-produced Hypa V3 summaries, insert memory rows, and enqueue missing follow-up work. |
| Render and budget | Render the owned prompt template, execute remaining request-time script hooks, retokenize, trim removable history, and clamp response budget. |

The stage order is explicit in `server/fastify/src/prompt/assemble.ts` and is
covered broadly by `server/fastify/__tests__/assemble.test.ts`.

## CBS Variables And History

`src/ts/cbs.ts` is the canonical parser/function registry shared by browser and
server. Fastify binds it through `server/fastify/src/prompt/variables.ts` with
the active database, character, chat, message index, prompt slot, variable
engine, and available Agent outputs.

Standard history variables have two distinct shapes:

- Unnumbered `{{history}}` serializes complete message objects and includes the
  greeting.
- Numeric `{{history::N}}` and `{{messages::N}}` return raw text from the newest
  positive-safe-integer count of stored rows, restored to chronological order.
  `::role` adds role prefixes.

These are not translator `{{slot::history::N}}` variables. The latter filter
disabled/comment rows, use a 1-50 bound, and share a separate token budget; see
[Translation And Input Hooks](translation-and-input-hooks.md#translation-history-slots).

Per-message expansion preserves the row being processed. History formatting
passes its stored row index to `expandVariables()`; `editinput` uses the newly
appended user index; `editoutput` uses the target assistant index. Regex pattern
and replacement CBS receive the same `chatID`, so `{{chat_index}}` is current
while `{{lastmessageid}}` still means the transcript tail. Regression coverage
is the exact cases "runs editinput CBS with the appended user row as the current
message" in `server/fastify/__tests__/assemble.test.ts`, "expands per-message
data with its current chat index" in
`server/fastify/__tests__/history.test.ts`, and "expands replacement CBS with
the supplied current-message index" in
`server/fastify/__tests__/scripts.test.ts`.

The canonical CBS fixes apply server-side too: `{{reverse::...}}` treats a
missing value as empty before Unicode-aware reversal, and `setdefaultvar`
considers absent, empty, or the compatibility string `"null"` unset. Run-var
mutations are removed from rendered text and emitted as targeted chat-variable
mutations.

Fresh generation and prompt-preview requests report a bounded browser-context
snapshot. Fastify resolves `{{screenwidth}}` and
`{{metadata::browserlanguage}}` from that last-reported snapshot rather than
reading browser globals. Missing context is non-fatal and emits a structured
warning. `{{screenheight}}` remains deliberately unsupported: it expands to an
empty value, emits the same non-throwing warning contract, and is diagnosed in
trigger configuration/import surfaces.

## Lorebook Activation And Injection

Normal activation excludes entries marked `agentOnly` or
`extensions.risu_agent_only`; those are reserved for named Agent inputs.
`server/fastify/src/prompt/lorebook.ts` activates regular character, chat,
global, and module lore, while `server/fastify/src/prompt/assemble.ts`
distributes the result into prompt slots.

One position parser owns `{{position::...}}` and non-lore `@@inject_at`
append/prepend/replace behavior during both token preflight and final rendering.
Global Note replacement composes `{{original}}` before its location injection,
and stable-card cache reads reuse that result. Depth and reverse-depth rows are
derived from the same activation report.

CBS is evaluated before lorebook token counting unless the prompt is already a
parser fixed point. This keeps activation budgets aligned with the text sent to
the model, including `reverse`, variables, and repaired `setdefaultvar` null
semantics. The contract is implemented by `countLorebookTokens()` in
`server/fastify/src/prompt/lorebook.ts` and the lorebook-preflight stage in
`server/fastify/src/prompt/assemble.ts`.
`server/fastify/__tests__/lorebook.test.ts`, the "Fastify lorebook template
injection" cases in `server/fastify/__tests__/assemble.test.ts`, and stable-card
cases in `server/fastify/__tests__/templates.test.ts` pin the ordering.

`Character.additionalText` remains import/export compatibility data. Fastify
does not implement the old browser embedding-based additional-information
retrieval and does not include this field in the static description.

## Prompt Template Ownership And Roles

A chat-scoped `generationSettings.promptPresetId` wins; otherwise the selected
modern prompt preset owns generation. The top-level `promptTemplate` is only a
compatibility fallback when no modern owner resolves. A resolved modern prompt
preset with no template intentionally disables template rendering instead of
borrowing stale top-level data. Loadout and duplication code must preserve this
owner boundary; see `src/ts/promptPresetModelOverrides.svelte.ts`,
`server/fastify/src/commands/splitPresets.ts`, and
`src/lib/Setting/pickerGenerationSettings.test.ts`.

Persona, description, author-note, and memory template blocks can select their
wire role through `role2`. `src/ts/process/promptTemplateNormalization.ts`
normalizes `assistant`/`char` to `bot`, accepts `user`, `bot`, or `system`, and
defaults invalid or absent roles to `system`. The browser editor lives in
`src/lib/UI/PromptDataItem.svelte`; server rendering parity is in
`server/fastify/src/prompt/templates.ts`.

Providers without full system-role support pass through the role replacement
step in `server/fastify/src/prompt/chatDispatch.ts`. An empty or invalid
`systemRoleReplacement` falls back to `user`; it never produces an empty wire
role.

## Hypa V3 Memory Phase

Only Hypa V3 is maintained. During assembly,
`server/fastify/src/prompt/memory.ts` and
`server/fastify/src/prompt/memoryAdapter.ts` snapshot existing summaries, plan
chunks, select model-compatible rows, and inject nonempty summaries as system
prompt rows. This hot path does not call embedding or summary providers.
`server/fastify/src/prompt/memoryFollowups.ts` enqueues idempotent
summarize/embed jobs for the worker after planning.

Provider-backed work runs through `server/fastify/src/memoryWorker.ts` and its
embed/summarize handlers. Legacy backfill remains in
`server/fastify/src/memoryLegacyImport.ts`; `legacy-hypav3` summaries are
compatible with every selected summary model and outrank an automatic duplicate
for the same chunk. Deletion tombstones prevent startup import from restoring a
removed legacy row.

Memory summaries use the memory-role profile and profile-owned provider
options. Embeddings remain outside chat profiles on the separate
Hypa/Voyage/custom model contract in
`server/fastify/src/memoryEmbeddingModel.ts`. Detailed memory storage/routes
remain backend/data ownership; this section owns only prompt-facing behavior.

## Final Budget And Confirmation Gate

`server/fastify/src/prompt/budgetFinalize.ts` independently retokenizes the
fully rendered `OpenAIChat[]`; it does not trust template preflight totals.
When the prompt exceeds context, it removes rows marked `removable` from the
front, preserves multimodal-only rows, fails if pinned rows alone overflow, and
clamps response tokens to the remaining context. It also reports when a durable
history message was dropped.

For persisted send/continue/regenerate outside enabled character Hypa V3,
history trimming requires a one-time chat-scoped confirmation. The server emits
`hypa_context_truncation_confirmation_required` only when trimming actually
occurred and `chat.hypaContextTruncationAcknowledged` is not true. The browser
confirmation flow in `src/ts/process/serverBackedSendChat.ts` persists that
field through a targeted chat command, verifies current chat ownership, and
retries once. The protocol constant lives in
`src/ts/process/request/hypaContextTruncation.ts`.

## Assembly Gates

Fastify rejects request shapes it cannot represent without silent loss:

| Gate | Reason |
| --- | --- |
| Send tail is not a text user row | Server send assembly owns a newly appended text user message. |
| Unsupported non-text tail | Browser-only content is not silently discarded. |
| Group chat | Removed/no-port behavior. |
| Plugin, WebLLM, or unroutable provider | No supported Fastify provider adapter. |
| Non-vision caption fallback | The browser image-caption path has no server equivalent. |
| Interactive Lua | Fastify cannot drive mid-request browser dialogs. |
| Deprecated Plugin V3 edit/replacer hooks | Browser plugin execution is no-port. |

Supported images, audio, video, assets, and inlays use server asset ids where
possible and only when selected model metadata permits the input. Assembly
loads bytes from the server asset store for adapters that require inline media.

## Post-Generation Order And Effects

For each primary or alternate provider result, finalization runs in this order:

1. Reformat the completion and apply `editoutput` once to the complete text.
2. Optionally trim an incomplete trailing sentence.
3. Execute Agent Preset after-main uses and its final-output composition.
4. Append or update the assistant row, then evaluate run-variable CBS.
5. Run the output trigger and capture message, variable, character, and local
   lorebook mutations.
6. Persist the authoritative result; only then start eligible automatic
   translation.

This order lives in `runServerPostGeneration()` in
`server/fastify/src/prompt/assemble.ts`. Blank-response fallback, banned-script
retry, character Escape Output, ordered provider/profile retry, and buffered
multi-generation derivation happen before a frame is authoritative. Automatic
translation is owned by the
[translation guide](translation-and-input-hooks.md#generated-message-auto-translation).

Interrupted streams take a narrower branch. Cancellation and post-token failure
apply steps 1–2 once to the accumulated partial and persist that exact text, but
do not run Agent Preset after-main, run-variable, output-trigger, translation,
or other completion-only effects. Incremental display remains raw on
server-backed streams.

`dispatchProviderWithPolicies()` in
`server/fastify/src/routes/generationChat.ts` runs the request trigger for every
actual attempt. Failures before the first token can use same-profile retries and
then ordered profile/legacy fallbacks; retry count is clamped to 20. Persisted
`generationInfo.model` retains the legacy provider-prefixed display label, while
`generationInfo.outputTokens` remains the assembler's context-headroom-clamped
budget even when a fallback profile has a different `maxResponse`. The cases
"applies request triggers, retries, blank fallback, banned-script retry, and
Escape Output" and "clamps request retries to the UI maximum of 20 (OR-5)" in
`server/fastify/__tests__/generation.chat.test.ts` pin the policy.

Generation metadata keeps stage 2 for Fastify prompt/memory work. Browser stage
4 remains UI finalization; server persistence deliberately records zero there
rather than issuing a telemetry-only message mutation.

## Lua Runtime

`server/fastify/src/prompt/luaRuntime.ts` runs non-interactive Lua in isolated,
prewarmed, one-use VMs. Each run and the aggregate generation have wall-clock
budgets; sleep, network requests, returned sizes, and instruction work are
bounded. `server/fastify/src/prompt/boundedRegex.ts` screens regex complexity
and owns the optional worker-thread compatibility path. V2 trigger execution
uses `DEFAULT_TRIGGER_WALL_CLOCK_BUDGET_MS` from
`server/fastify/src/prompt/triggers.ts` alongside effect, loop, and recursion
budgets.

Lua participates in submit/input, editinput, request, editoutput, and output
phases through `server/fastify/src/prompt/assemble.ts`,
`server/fastify/src/prompt/triggers.ts`, and the route retry policy. Browser
display/reload calls are safe no-ops. Interactive alert input/select/confirm
calls fail explicitly. Privileged multimodal LLM/image APIs remain unsupported.

Lightweight chat access is deliberately bounded: `getChatMain` returns only
role/data/time JSON for one index, while `getChatData` and `getChatRole` return
one field. Missing indexes return null/empty results. `getRecentChatsMain`
returns the requested bounded tail rather than exposing a mutable database.
Unchanged `setChatVarChanged`/`setStateChanged` writes return nil and do not mark
assembly dirty, so no-op scripts do not force persistence.

## Durable Lua Setters

Lua character and lorebook setters are no longer compatibility no-ops.
`setName`, `setCharacterFirstMessage`, and `setBackgroundEmbedding` mutate the
working character; `upsertLocalLoreBook` replaces or appends a chat-local entry
by display comment and makes it visible within the same Lua run.

`server/fastify/src/prompt/assemble.ts` diffs the working character and local
lore against their initial snapshots. The result carries targeted
`characterFieldMutations` and `localLoreMutation`; both assembly-time and
post-generation persistence in
`server/fastify/src/routes/generationChat.ts` validate freshness before writing
them. No diff means no state write. Coverage lives in
`server/fastify/__tests__/luaRuntime.test.ts` and
`server/fastify/__tests__/assemble.test.ts`.

## V2 Triggers And Unsupported Effects

`server/fastify/src/prompt/triggers.ts` supports deterministic control flow,
variables/local variables, comparisons, loops, safe data helpers, message
reads/writes, additional system prompts, and server Lua effects under effect,
loop, recursion, and wall-clock budgets.

Unsupported V2 effects are preserved for round-trip compatibility and skipped,
not partially executed. `src/ts/process/triggerServerSupport.ts` is the source
of truth; categories include commands, alerts, privileged LLM/image/similarity
work, legacy browser JavaScript, GUI/update/wait operations, and the V2
character/persona/note/lorebook state arms. Generation emits one warning per
distinct unsupported effect type, even when recursion or a loop encounters it
multiple times. The trigger editors mark configured unsupported definitions,
dedicated V2 JSON import reports them without changing the imported rows, and
the browser presents runtime compatibility warnings visibly as well as retaining
them in the generation result.

This boundary is specific to V2 trigger effects. It does not make the durable
Lua setters above unsupported. Keep the two compatibility surfaces distinct in
tests and documentation. Safety regressions are covered by
`server/fastify/__tests__/triggers.test.ts`,
`server/fastify/__tests__/luaRuntime.test.ts`, and
`server/fastify/__tests__/boundedRegex.test.ts`.
