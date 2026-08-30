# Normal Model Consumer Cutover

Status: in progress; effective model-identity checkpoint through `e663269de`.

Parent: [Phase 2](../../phase-2-model-configuration-ownership.md)

Depends on: deterministic flat migration at `47146eb75`.

## Objective

Make durable profiles and role bindings the only normal model-selection and
runtime-option inputs across authoring, reload, generation, and auxiliary
lanes, while keeping explicitly classified static and legacy entrypoints.

## Scope

- Settings/model authoring, model presets, loadouts, and reload hydration.
- Chat generation, memory, translation, scripting, tools, agents, and other
  auxiliary model-role consumers.
- Normal resolver fallback from a migrated role binding to `aiModel`,
  `subModel`, `modelRoles`, separate parameters, and fallback arrays.
- Current import/export and explicit legacy conversion remain compatibility
  boundaries; the inline-only Vertex hold remains Phase 5 work.

## Behavior Contract

- Provider, request model/options, fallback order, inheritance, static-model
  bypasses, and generated requests stay equivalent.
- Normal authoring writes canonical profile/binding records and cannot
  reintroduce flat runtime ownership.
- Missing or malformed durable state fails or reports incomplete according to
  the Phase 0 matrix; ordinary resolution does not mint or repair records.
- No command revision, receipt, event, lineage, backup, or restore semantics
  change unless the owning command already declares that mutation.

## Validation

Resolver/provider-request differential tests, model profile/binding/preset/
loadout fixtures, generation and every auxiliary role lane, browser authoring
and reload proof, explicit conversion/import/export fixtures, both typechecks,
compatibility/architecture gates, formatting, and `git diff --check`.

## Done When

- Every normal model consumer reaches configuration through a durable profile
  and binding after migration/reopen.
- Flat fields can influence behavior only through named static, import,
  export, explicit conversion, rollback, or Phase 5 repair boundaries.
- The remaining Phase 2 legacy-reader removal is isolated and the model-owner
  cursor is ready to release to Workstream 3.

Stop if a consumer needs an inline secret copied, a fallback reordered, or a
classified static/legacy boundary removed to complete the cutover.

## Progress Record

- Legacy-shaped selected model presets now reset durable role bindings only on
  an effective request clone, so their model/provider/role selections and
  inline credentials remain usable without changing persisted canonical state.
- Any preset-owned `modelProfiles`, `modelProfileOrder`, `modelRoleProfiles`, or
  `modelRuntimeDefaults` field disables that seam. Parameter-only rows do not
  masquerade as legacy model selection.
- Profile-local runtime tokenizer selection and custom-API provider tokenizer
  selection outrank global runtime defaults.
- Browser prompt assembly resolves `chatMain` once for NovelAI markers, image
  capability, continue markers, and system coalescing; conflicting flat fields
  no longer reshape the selected durable model at `29775b825`.
- Send-context budgeting and `ChatTokenizer` capture one selected profile for
  model overhead, name handling, maximum context, tokenizer family, provider
  credential, and cache identity. Fastify uses the same tokenizer precedence
  helper at `c0b8776b3`.
- Local prompt assembly reserves and finalizes output tokens from that same
  selected profile's `runtimeOptions.maxResponse`, with legacy flat fallback
  only when the resolved profile has no value, at `0b134b24d`.
- The custom sidebar model control opens the canonical global model-preset
  picker and no longer creates an ordinary server-backed `aiModel` draft at
  `f986cf1ff`.
- OpenAI request shaping and multimodal token accounting read image-input
  capability from the resolved profile at `c7ab6beaf`; only explicitly
  context-free callers retain the aggregate `aiModel` fallback.
- Fastify `/generate/completion` applies the same durable profile runtime
  projection as normal chat at `07576969c`, then applies only its explicit
  stream, max-token, temperature, and character-name request overrides.
- Ordinary browser request adapters pass `resolvedProfile.runtimeOptions` into
  the shared parameter builder at `d8275c5e9`; conflicting flat sampling values
  no longer override durable profiles, while explicit separate-parameter
  settings retain their classified precedence.
- Anthropic adaptive thinking, DeepSeek thinking and tool-round reasoning, and
  the legacy plugin fallback read resolved runtime options at `3cff93cd6`;
  context-free callers retain the classified flat fallback.
- Prompt-visible `chatMain`/`chatAux` CBS values and metadata use role-aware
  resolved contexts in browser and Fastify hosts at `fd0764744`.
- V3 plugin send-loop protection inspects the effective main profile at
  `c24cdd16d`, so stale flat selections cannot bypass the guard.
- Default generation labels derive from the effective selected/wire/provider
  profile at `e663269de`; explicit provider-returned overrides and legacy-only
  selection formatting retain their compatibility behavior.
- The seam is named in the compatibility baseline and closed-world probe. Chat
  generation, memory summarization, browser prompt assembly and send-context,
  split presets, tokenizer, static ownership, prompt-budget, and sidebar
  authoring owners pass; ordinary flat runtime/authoring consumers remain to be
  cut over before this slice can close.
