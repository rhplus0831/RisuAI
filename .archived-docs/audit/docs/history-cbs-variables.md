# History formatting, CBS parser, variables, and prompt assets (`HC`)

Fastify side: `server/fastify/src/prompt/history.ts`, `cbsAdapter.ts`,
`variables.ts`, `promptScope.ts`, `assetLookup.ts`. Original side:
`src/ts/parser/parser.svelte.ts` (risuChatParser), `src/ts/cbs.ts`,
`src/ts/parser/chatVar.svelte.ts`, and the history formatting in
`src/ts/process/index.svelte.ts` (all `@71c476e9c`). See
[README.md](README.md) for baseline and format.

## Open findings

### HC-1 — Character/template default variables are invisible to prompt CBS [high]

- **Verification:** code-verified (found independently by two agents; the
  same root cause produces [LM-4](lorebook-memory.md))
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/promptScope.ts:43`,
  `server/fastify/src/prompt/variables.ts:91`
- **Original:** `src/ts/parser/chatVar.svelte.ts:5` `@71c476e9c`
- **Difference:** The server chat-var backend reads only
  `chat.scriptstate['$' + key]` and returns the string `null` when absent.
  The original fell back, in order, to `character.defaultVariables` and
  `db.templateDefaultVariables`. The trigger engine has a separate
  implementation that does honor defaults, so prompts and triggers can see
  different values for the same variable.
- **Scenario:** Default variable `mood=happy`, empty scriptstate,
  `{{getvar::mood}}` in any prompt card/lore entry/description: original
  sends `happy`; Fastify sends `null`. With default `count=2`,
  `{{addvar::count::1}}` starts from 2 originally but writes `NaN` on
  Fastify.

### HC-2 — `sendName` history diverges from the group-speaker branch [medium]

- **Verification:** agent-reported
- **Classification:** BUG (tests cover the default wrapper but not role
  attribution or a custom wrapper)
- **Fastify:** `server/fastify/src/prompt/history.ts:145`, `:320`, `:331`
- **Original:** `src/ts/process/index.svelte.ts:917`,
  `src/ts/storage/database.svelte.ts:550` `@71c476e9c`
- **Difference:** With prompt-template `sendName` enabled, the original
  entered the group-speaker branch: it used `db.groupTemplate` when present
  and overwrote every row's role with `db.groupOtherBotRole` (default
  `user`). Fastify always uses a hard-coded wrapper and preserves stored
  `user`/`assistant` roles.
- **Scenario:** `sendName` on, baseline-default `groupOtherBotRole: "user"`,
  an assistant reply in history: original sends it wrapped with role `user`;
  Fastify sends it as `assistant`. A custom `groupTemplate` is honored only
  by the original.

### HC-3 — History loses the original second CBS evaluation pass [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/history.ts:288`,
  `server/fastify/src/prompt/scripts.ts:650`
- **Original:** `src/ts/process/index.svelte.ts:837`,
  `src/ts/process/scripts.ts:99`, `:133` `@71c476e9c`
- **Difference:** The original ran CBS over the message, then
  `processScriptFull` parsed the resulting text again before regex scripts.
  Fastify performs the first expansion and calls `processScriptAsync`, which
  has no equivalent whole-text second parser pass, so one level of CBS
  indirection stays unresolved.
- **Scenario:** `$outer="{{getvar::inner}}"`, `$inner="{{user}}"`, message
  containing `{{getvar::outer}}`: after the first pass both reach
  `{{user}}`; the original's second pass resolves it to the username, Fastify
  sends literal `{{user}}`.

### HC-4 — CBS cannot see active modules or module lore [medium]

- **Verification:** agent-reported
- **Classification:** UNCLEAR — the adapter comment calls the empty lists
  intentional, but no structure document or focused test establishes this as
  a supported incompatibility.
- **Fastify:** `server/fastify/src/prompt/cbsAdapter.ts:115`
- **Original:** `src/ts/parser/parser.svelte.ts:989`,
  `src/ts/process/modules.ts:343`, `:371` `@71c476e9c`
- **Difference:** The server CBS adapter hard-wires `getModules()` and
  `getModuleLorebooks()` to empty arrays even though server assembly has
  active-module helpers. The original wired the actual enabled/chat/character
  modules into the parser.
- **Scenario:** Enabled module with namespace `weather`, asset `rain`, and
  module lore: original resolves `{{moduleenabled::weather}}` to `1`, lists
  `rain`, and includes the lore in `{{lorebook}}`; Fastify yields `0`, empty,
  and omits the module lore from `{{lorebook}}`.

### HC-5 — Model metadata CBS always reports a placeholder model [medium]

- **Verification:** code-verified
- **Classification:** BUG — the adapter comment asserts prompt expansion does
  not read model metadata, but the registered `metadata` callback does.
- **Fastify:** `server/fastify/src/prompt/cbsAdapter.ts:61`, `:121`
- **Original:** `src/ts/parser/parser.svelte.ts:1008`, `src/ts/cbs.ts:1895`
  `@71c476e9c`
- **Difference:** The original injected the real `getModelInfo` lookup;
  Fastify injects a fixed model (`Placeholder Model` / `placeholder`, zero
  format/provider/tokenizer).
- **Scenario:** Any selected model with `{{metadata::modelname}}` in the
  prompt: original sends the real name; Fastify sends `Placeholder Model`.

### HC-6 — Multiple `<Thoughts>` blocks are stripped differently [low]

- **Verification:** cross-confirmed (two agents independently)
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/history.ts:145`, `:203`
- **Original:** `src/ts/process/index.svelte.ts:938` `@71c476e9c`
- **Difference:** Fastify strips `<Thoughts>` blocks with a non-greedy
  `(.+?)`; the original used greedy `(.+)`, consuming from the first opening
  tag through the final closing tag.
- **Scenario:** Stored message `<Thoughts>a</Thoughts>VISIBLE<Thoughts>b</Thoughts>`:
  original removes everything; Fastify sends `VISIBLE` and records `a` and
  `b` as separate thoughts.

### HC-7 — Browser-local CBS is unresolved or uses server locality [low]

- **Verification:** agent-reported
- **Classification:** UNCLEAR — the unavailable browser globals are
  acknowledged in `cbsAdapter.ts`, but no client-context propagation is
  documented as an intentional exception.
- **Fastify:** `server/fastify/src/prompt/cbsAdapter.ts:16`
- **Original:** `src/ts/cbs.ts:446`, `:517`, `:1366`, `:1890` `@71c476e9c`
- **Difference:** `{{screenwidth}}`/`{{screenheight}}` and
  `{{metadata::browserlanguage}}` need `window`/`navigator`; server-side they
  throw and the directive is preserved literally. Date/time CBS resolves in
  the server timezone/locale instead of the user's.
- **Scenario:** A New York user on a Seoul-hosted server: `{{time}}` emits
  Seoul-local time; `{{screenwidth}}` stays literal.

### HC-8 — Missing prompt-asset bytes are silently discarded [low]

- **Verification:** agent-reported
- **Classification:** UNCLEAR
- **Fastify:** `server/fastify/src/prompt/history.ts:250`,
  `server/fastify/src/prompt/assetLookup.ts:122`,
  `server/fastify/src/routes/generationChat.ts:725`
- **Original:** `src/ts/process/index.svelte.ts:947`,
  `src/ts/globalApi.svelte.ts:208` `@71c476e9c`
- **Difference:** Fastify returns `undefined` for missing asset
  metadata/files, strips the `asset_prompt` marker, and continues without the
  multimodal part. The original rejected prompt construction when referenced
  asset bytes were absent.
- **Scenario:** A character whose `additionalAssets` names `logo` but whose
  blob is missing, with `{{asset_prompt::logo}}`: original generation fails;
  Fastify dispatches with both marker and image absent.

## Confirmed intentional divergences (no work items)

- **`setdefaultvar` initializes truly missing variables** (the original's
  `!getChatVar(key)` check was defeated by the truthy `"null"` sentinel).
  Pinned by `server/fastify/__tests__/promptVariables.test.ts:172`.
- **Preview does not persist assembly-time chat mutations** (the original
  preview path mutated the live chat with no rollback). Pinned by
  `server/fastify/__tests__/generation.chat.test.ts:2676`.
- **The `[Start a new chat]` marker's token cost is counted** (the original
  pushed it without charging the budget). Pinned by
  `server/fastify/__tests__/history.test.ts:1340`.

## Areas verified clean

Non-`sendName` history inclusion/order, disabled and `allBefore` handling,
alternate-greeting selection, example-message parsing, continue placement,
ordinary role mapping; the `5f4109fee` message-index/chatID fix; the baseline
CBS function-name inventory, argument splitting, nested/block conditionals,
slot/position behavior, tempvar lifetime, random/hash-random algorithms;
`history`/`lastmessage`/previous-chat accessors (the numeric `{{history::N}}`
extension is documented); valid vision-capable inlays and `asset_prompt`
references (tag matching, lookup order, icon fallback, dimensions/types,
attachment ordering); send/continue/regenerate chat-variable writes; the core
oldest-first trimming loop. Group chat no-port and the non-vision
image-caption hard gate are documented exclusions.
