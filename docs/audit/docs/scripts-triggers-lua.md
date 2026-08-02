# Regex scripts, V1/V2 triggers, and Lua scripting (`ST`)

Fastify side: `server/fastify/src/prompt/scripts.ts`, `triggers.ts`,
`triggerDataEffects.ts`, `luaRuntime.ts`. Original side:
`src/ts/process/scripts.ts`, `src/ts/process/triggers.ts`,
`src/ts/process/scriptings.ts` (all `@71c476e9c`). See
[README.md](README.md) for baseline and format.

## Open findings

### ST-3 — Lua character and local-lore setters are request-local [high]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/luaRuntime.ts:1440`, `:1483`,
  `server/fastify/src/prompt/assemble.ts:342`
- **Original:** `src/ts/process/scriptings.ts:629`, `:674`, `:715`, `:762`
  `@71c476e9c`
- **Difference:** `setName`, `setCharacterFirstMessage`,
  `setBackgroundEmbedding`, and `upsertLocalLoreBook` mutate only the
  request-local snapshot; the mutation payload exposes message/chat-variable/
  limited chat-metadata changes, not character fields or local lore. The
  original wrote these into `DBState` durably.
- **Scenario:** Lua `onInput` calls `setName(id, "Renamed")`: the next
  Fastify request reloads the old name; the original retains `Renamed`.

### ST-4 — `@@inject` history mutations are not persisted [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/scripts.ts:209`,
  `server/fastify/src/prompt/assemble.ts:1622`,
  `server/fastify/src/routes/generationChat.ts:1292`
- **Original:** `src/ts/process/scripts.ts:207` `@71c476e9c`
- **Difference:** Fastify writes the pre-strip text into the request-local
  `currentChat.message[chatID]`, but a plain history regex does not create an
  assembly message mutation, and persistence only writes the transcript when
  `submitTranscriptChanged` is set. The original mutated the stored chat
  message directly.
- **Scenario:** Stored row `hello {{char}} SECRET` with an `editprocess`
  script matching `SECRET` and output `@@inject`: both omit `SECRET` from the
  provider prompt, but only the original's stored row becomes the expanded
  pre-strip text after refresh.

### ST-5 — V2 `∉` advanced condition is missing [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/triggers.ts:1165`
- **Original:** `src/ts/process/triggers.ts:1668` `@71c476e9c`
- **Difference:** `∈`, `∋`, `∌` are implemented; `∉` has no branch, so the
  condition never passes. The original evaluated it as "source not included
  in the JSON-array target" (invalid target JSON counts as passing).
- **Scenario:** `v2IfAdvanced` comparing `"z"` to `["a"]` with `∉` gating a
  `v2SetVar`: original sets the variable; Fastify skips the body.

### ST-6 — `v2ExtractRegex` is allowlisted but unimplemented [medium]

- **Verification:** agent-reported
- **Classification:** BUG (it is in the safe subset yet falls through as a
  no-op, so the allowlist and dispatcher disagree)
- **Fastify:** `server/fastify/src/prompt/triggers.ts:186`,
  `server/fastify/src/prompt/triggerDataEffects.ts:719`
- **Original:** `src/ts/process/triggers.ts:1932` `@71c476e9c`
- **Difference:** The original executed the regex, expanded `$n`/`$&`/`$$`,
  and set the output variable without needing low-level access.
- **Scenario:** Extract `42` from `ID=42` via `ID=(\d+)` into `id`, then add
  a system prompt from `id`: original adds `42`; Fastify adds `null`.

### ST-7 — Lua `getPersonaDescription` always returns an empty string [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/luaRuntime.ts:1464`
- **Original:** `src/ts/process/scriptings.ts:689` `@71c476e9c`
- **Difference:** Hard-coded `''` versus the active persona prompt expanded
  against the current character.
- **Scenario:** Persona prompt `I am {{user}}`; Lua stores
  `getPersonaDescription(id)` into a chat variable used by the prompt:
  original supplies the expanded persona, Fastify an empty string.

### ST-8 — Several non-interactive Lua APIs are stubs [medium]

- **Verification:** agent-reported
- **Classification:** UNCLEAR — distinct from the documented exclusion of
  interactive Lua dialogs; no doc covers these.
- **Fastify:** `server/fastify/src/prompt/luaRuntime.ts:943`, `:1543`, `:1572`
- **Original:** `src/ts/process/scriptings.ts:284`, `:363`, `:477`, `:796`
  `@71c476e9c`
- **Difference:** `loadLoreBooks`, `similarity`, `generateImage`,
  character/persona image getters, and multimodal `LLM` return empty results
  or errors; the original implemented each.
- **Scenario:** A low-level `onInput` calls `loadLoreBooks(id)` and adds the
  first active lore entry to the transcript: original adds its text; Fastify
  receives an empty list, changing the provider prompt.

### ST-9 — Unmatched optional captures differ in move directives [low]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/scripts.ts:169`
- **Original:** `src/ts/process/scripts.ts:219` `@71c476e9c`
- **Difference:** For an in-range but unmatched capture, Fastify preserves
  the literal `$1`; the original coerced JavaScript `undefined` to the text
  `undefined`.
- **Scenario:** Pattern `(a)?b`, data `b`, output `@@move_top <$1>`: original
  prepends `<undefined>`; Fastify prepends `<$1>`.

### ST-10 — Malformed order metadata changes execution order [low]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/scripts.ts:135`
- **Original:** `src/ts/process/scripts.ts:296` `@71c476e9c`
- **Difference:** Fastify ignores an `order` token whose `parseInt` is `NaN`;
  the original stored `NaN` (whose stable-sort comparison acts as equality)
  and set `orderChanged`.
- **Scenario:** Script A `a→b` with `<order nope>` before script B `b→c` with
  `<order 5>`: original keeps A-before-B and returns `c`; Fastify assigns A
  order zero, runs B first, and returns `b`.

## Confirmed intentional divergences (no work items)

- **ST-1 — V2 persistent character/persona/note/lorebook effects stay no-op**
  and **ST-2 — V2/V1 command and privileged effect families stay no-op**
  (accepted divergence; maintainer decision 2026-08-02). Rationale: support
  cost is disproportionate to current ecosystem usage — bot authors have
  moved to Lua for scripted behavior, which is the committed server-side
  scripting surface. The arms remain no-ops at
  `server/fastify/src/prompt/triggerDataEffects.ts:67` /
  `server/fastify/src/prompt/triggers.ts:1464`. Original evidence:
  `src/ts/process/triggers.ts:1382`, `:1425`, `:1853`, `:1865`, `:1966`,
  `:2106`, `:2119`, `:2609` `@71c476e9c` — note the baseline never gated
  `command`/`v2Command` behind `lowLevelAccess`, so declining the port also
  declines re-introducing ungated command execution; the
  alert/LLM/image/similarity arms were `lowLevelAccess`-gated upstream.
  Consequence to communicate: getter-dependent triggers inject the literal
  string `null`, and cards relying on these effects silently lose behavior.
  Follow-up (user-facing unsupported notice, structure-doc entry, and a
  pinning regression) is tracked in the WORK-INDEX Tier 2 item "Surface and
  pin the V2 unsupported-effect no-ops"; the silent fall-through is not yet
  a documented, tested contract until that lands.
- **Global regex scripts execute** (the baseline stored `db.globalscript` but
  never ran it). Added deliberately in commit `9fde68341`; order pinned by
  `server/fastify/__tests__/scripts.test.ts:123`.
- **`@@emo` is a text no-op on the server** (no emotion-state side effect).
  Pinned by `server/fastify/__tests__/scripts.test.ts:250`.
- **Lua globals reset per invocation** (one-use isolated VMs; the original
  reused an engine per mode so script globals persisted). Documented at
  `docs/structure/providers-and-models.md:753`; pinned by
  `server/fastify/__tests__/luaRuntime.test.ts:810`.
- **A failed Lua edit hook falls back to raw provider text** instead of
  continuing into regex derivation (see also
  [orchestration-postgen.md](orchestration-postgen.md)). Pinned by
  `server/fastify/__tests__/generation.chat.test.ts:4676`.
- **Sticky-flag action regexes restart from index zero** — divergence
  documented in `server/fastify/src/prompt/scripts.ts:55`.

## Areas verified clean

Regex order preset → character → active modules; mode filtering, flag
sanitation, default `g`, CBS-enabled `in` patterns, output CBS, `no_end_nl`;
`@@move_top`/`@@move_bottom`/`@@repeat_back`/`@@inject` provider-text
behavior outside the persistence/capture edge cases; per-message index and
chatID propagation (post-`5f4109fee`); start/input/output/request trigger
placement; core V1/V2 set-variable, system-prompt, impersonate, cut-chat,
modify-chat, stop/cancel, send-AI, recursive-run effects; trigger source
selection, recursion accounting, `triggerRunCache` reuse/invalidation; Lua
hook ordering, message/chat-variable APIs, text-only LLM role mapping,
`stopChat`; enabled-module resolution and ordering.
