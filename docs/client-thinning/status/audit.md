# Audit

Date: 2026-05-30

Read this when changing `util/client-thinning-audit.ts`, adding invariant rules,
or selecting audit work. This is the canonical audit shard; coverage pointers live
in [`../coverage/audit.md`](../coverage/audit.md).

## Current State: Reproducible; The Four Defeated Rules Are Now AST Invariants

`pnpm client-thinning:audit` runs `util/client-thinning-audit.ts` (ts-morph plus
source-text checks). Fixture **reproducibility is complete**: all 23 checks have
committed fixtures and tests in `util/client-thinning-audit.test.ts` (58 tests).
The harness is honest — it spawns the real audit binary against per-rule mini-repo
fixtures with `CLIENT_THINNING_AUDIT_CHECK_IDS` scoping and asserts non-zero exit
on the failing fixture (and zero on a bypass fixture where applicable). No rule is
mocked or re-implemented.

Reproducible is not automatically robust. Many rules are genuine AST/call-graph
invariants that survive a refactor (notably A4R3 transitive-mint, A4R1
passive-refresh via `findReferencesAsNodes`, A4R4 resolver-normalize, A4R5
parser-parity, A4R-bounded, A4R-saveasset). Some remaining rules still lean on
`String.includes` needles / regex counts; those were **not** empirically defeated
but are candidates for the same treatment if a defeat is found.

## Empirically Defeated Rules — Hardened 2026-05-30

The four rules that had been defeated by running sincere variants against the real
audit binary are now AST invariants with committed adversarial fixtures. Each
adversarial fixture printed "Client-thinning audit passed." against the old
needle rule and now fails against the hardened rule:

- **A4R2 conflict-replay** (`checkAlpha4ConflictRetry`) — now a comparison-anchored
  invariant: a conflict-status comparison is matched even when the `'conflict'`
  literal is aliased to a local const (`collectStringLiteralAliases`); the conflict
  branch is located structurally (`guardedBranchRegions`); and any mutating command
  re-issued in that branch (`runServerCommand` / `patchSettingsGroup` / `fetch`, a
  `dispatch*` helper, or a recursive self-call) is the replay. It no longer depends
  on the `'conflict'` / `'baseRevision'` substrings.
  Fixture: `conflict-replay/failing-aliased-literals`.
- **A4R7 asset-URL-gate** (`checkAlpha4AssetUrlGate`) — the Fastify branch is located
  by guard polarity (`guardedBranchRegions`), so inverting `if (isFastifyServer)`
  into `if (!isFastifyServer) { ... }` no longer latches the browser branch. And
  `validateServerAssetUrlShapes` validates that `serverAssetUrl` /
  `serverAssetIdFromReference` restrict `loc` to anchored asset-id shapes and reject
  the rest with null (no raw `loc` passthrough). Fixtures:
  `asset-url-gate/failing-inverted-fastify-guard`, `asset-url-gate/failing-widened-asset-url`.
- **A4R-fanout composite race** (`checkAlpha4CompositeFanout`) — the `.svelte` path
  parses the `<script>` block(s) AND the markup `={ ... }` event handlers as TS via
  a throwaway in-memory ts-morph project, then runs the same AST scope analysis as
  the `.ts` path. Dispatches in mutually-exclusive branches (if/else, ternary arms)
  are dropped via `areMutuallyExclusive`, so legitimate branch-per-command shapes
  (e.g. `SideChatList.svelte`'s `createStb` and `bindedPersona` handlers) are not
  false positives. Fixtures: `composite-command-fanout/failing-svelte-race`,
  `composite-command-fanout/failing-svelte-markup-race`,
  `composite-command-fanout/svelte-branch-bypass`.
- **EC2 plugin-storage-gates** (`checkPluginStorageGates`) — the hardcoded 6-name
  `guardedMethods` list is gone. The rule derives the device-local storage sink set
  (browser storage globals plus every `localforage.createInstance` instance declared
  in the file) and requires every method / accessor / `SafeIdbFactory` property that
  reaches a sink to assert the compatibility gate, so a NEW device-local method
  cannot slip past a fixed name list. Fixture:
  `plugin-storage-gates/failing-ungated-new-method`.

## A4R-group-chat-removed (added with the group-chat removal batch)

`checkGroupChatRemoved` is the proof for the group-chat legacy removal — group chat
is fully legacy (no server group/member model), so its client UI branches were
removed and three defense layers keep a group character unreachable. The rule is
AST-derived with two halves:

- **negative** — the catalog / chat-list UI surfaces (`GridCatalog.svelte`,
  `ChatList.svelte`) must not reintroduce a `char.type === 'group'` comparison. It
  parses each `<script>` body AND every markup brace group (a generic
  `extractSvelteBraceGroups` that captures attribute handlers, `{#if ...}` logic
  blocks, and plain mustaches — broader than the fanout rule's `={ ... }`-only
  extraction) as TS, then walks for a `.type` member compared to the `'group'`
  literal. Scoped to those two files on purpose: the sidebar accordion
  (`Toggles.svelte` / `util.ts`) legitimately compares an unrelated
  `toggle.type === 'group'`.
- **positive** — the three layers must remain: `setDatabase`'s load-time filter
  (`type !== 'group'`), the `serverPromptAssembly` hard-fail (a `type === 'group'`
  comparison guarding an `unsupported` return), and the `dispatchRequest`
  `isGroupChat: false` hardcode.

Fixtures: `group-chat-removed/failing-ui-branch` (both detection paths — markup
`{#if}` and event handler), `group-chat-removed/keep-layers-removed-bypass` (all
three defense layers dropped), `group-chat-removed/passing`.

## Hardening Work Item — Done For The Four Defeated Rules

The four empirically-defeated rules above are converted and have adversarial
fixtures. Remaining optional follow-up (no known defeat yet):

- The still-shallow string/regex rules can move to AST invariants if a sincere
  defeat is demonstrated against the real binary (the bar for opening this work).
- The fanout rule's Svelte AST path covers `<script>` blocks and `={ ... }`
  attribute handlers; quoted attribute interpolations (`attr="{ ... }"`) are not
  extracted — add if a dispatch site ever lands in one. (The newer
  `A4R-group-chat-removed` rule uses a broader `extractSvelteBraceGroups` that also
  captures `{#if ...}` logic blocks and plain mustaches.)

## Direction

- A new (or newly hardened) audit rule ships its fixture + test in the same batch.
- An adversarial fixture must defeat the OLD rule and fail the NEW one — that is
  the robustness bar, not one-shot tripping.
- Several fixtures intentionally mirror audit tables (`MUTATING_ROUTE_RULES`,
  `ASSET_WALKER_OWNERS`) and must be updated when those surfaces change.
- Keep one `pnpm client-thinning:audit` entry point even if internals split.
- Prefer source-derived rule inputs over hardcoded call-site lists.

## Proof Leads

- `pnpm client-thinning:audit`
- `pnpm exec vitest run util/client-thinning-audit.test.ts`
- `util/client-thinning-audit.ts`, `util/client-thinning-audit.test.ts`
