# Reference: Provider-Capability Table (closeout decision #5)

Date: 2026-05-30

Spec + scope for unifying the two provider-routing resolvers onto one shared
capability table. Backs [`../phases/phase-5-closeout.md`](../phases/phase-5-closeout.md#closeout-decisions-2026-05-30)
decision #5 (the provider-resolver unification batch), the prerequisite for the
`useServerPromptAssembly` default flip (#1).

Line anchors drift; symbol names are the stable handle. Paths are from the repo
root.

## Invariant

A single pure function `resolveProviderCapability(input)` is the only source of
truth for the routing **decision**: "given a resolved model (`format` + config),
which server provider dispatches it, or is it unsupported (and which category)."
Both consumers call it:

- Browser completion classifier — `resolveServerCompletionRoute`
  (`src/ts/process/request/serverCompletion.ts`), itself delegated to by the
  prompt-assembly classifier `resolveServerPromptAssembly`
  (`serverPromptAssembly.ts:249`).
- Server `/chat` dispatcher — `dispatchChatProvider` (`server/fastify/src/prompt/chatDispatch.ts`).

They cannot drift on the routing decision because they share it.

## Boundary — what unifies, what does not

- **Unifies (capability layer):** the `format → provider` map plus the
  per-provider config-shape refinement. On the browser this was
  `formatToServerProvider` + `selectOpenAIVariant` / `isVanilla*` /
  `resolveOllamaProvider`; on the server it was `resolveProvider` +
  `unsupportedChatProviderReason`. The shared table is a faithful extraction of
  the **completion** path's logic (so the browser behavior is byte-identical),
  which the server then adopts.
- **Stays per-side (derivation layer):** `db → modelInfo`. The browser uses
  `getModelInfo` (`model/modellist.ts`, full `LLMModels` registry); the server
  uses `resolveModelInfo` (`chatDispatch.ts`, string-prefix). Decision #5 does
  **not** require replicating the registry on the server — the docs already treat
  this as an acknowledged seam ("`/chat` can still hard-fail a provider shape the
  completion resolver supports").
- **Stays per-side (reason prose):** the table returns a structured verdict with
  a reason **code**. The completion path maps every code → its generic
  `unsupportedServerGenerationReason`; `chatDispatch` maps codes → its specific
  per-format messages. The decision is single-sourced; the user-facing strings are
  presentation and stay where they were (no churn to either suite's reason
  assertions).

## The three divergences and their resolution

1. **`reverse_proxy` + `reverseProxyOobaMode` (capability — the documented one).**
   Completion accepts it (`selectOpenAIVariant` ignores ooba → `openai`); the
   server rejected it (`unsupportedChatProviderReason`). **Resolve: ACCEPT on
   both.** The server openai adapter already honors `oobaSystemHoist`
   (`generation/openai.ts:72,105` → `applyOobaSystemHoist`) and
   `chatDispatch.resolveOpenAIVariant` already sets it (`:557`) — the rejection
   was a stale guard. The shared table does not gate on ooba mode; reverse_proxy
   with a URL + key routes `openai`, and the dispatch arm sets `oobaSystemHoist`.
   This is the one net behavior change: `/chat` now dispatches the ooba reverse
   proxy instead of hard-failing.
2. **Unknown `OpenAICompatible` model id (derivation — kept asymmetric).** The
   browser `getModelInfo` → `OpenAICompatible` with no reason; the server
   `resolveModelInfo` → `OpenAICompatible` + `unsupportedReason` (it has no
   endpoint to dispatch an unknown id; the browser would 404 at the provider).
   **Keep server-stricter.** This guard lives in `resolveModelInfo`, runs before
   the table, and is documented here. The parity matrix covers only resolvable
   models.
3. **Horde client-template requirement (capability — eliminated).** The completion
   path flattens the Horde prompt **client-side** (`buildProviderOptions` →
   `applyChatTemplate(targ.formated)`), so it needs `db.instructChatTemplate` and
   refuses without it (`isVanillaHorde`). The `/chat` path flattened
   **server-side** (`chatDispatch.applyChatTemplate(db,…)`) with a generic
   `role: content` default. **Resolve: require the template on both** — the table
   carries the full `isVanillaHorde` gate (non-empty `instructChatTemplate`, plus
   `JinjaTemplate` when jinja), so the server adopts the same precondition. The
   only thing dropped is the server's untemplated default-flattening dispatch,
   which no test exercised and which produced a non-instruct prompt. Horde now
   classifies identically on both paths (in the parity matrix).

(`ollama-cloud` looked like a fourth divergence but is consistent: both remap the
cloud format to `openai`/`openai-responses`/`anthropic` by `db.ollamaRequestFormat`
— the browser at the capability layer, the server at the derivation layer — and
native ollama → `ollama` on both. The table receives the already-remapped format
from each side and agrees.)

## Verdict + input

```ts
type ProviderCapabilityVerdict =
  | { routable: true; provider: string }
  | { routable: false; reason: ProviderUnsupportedReason }
```

`ProviderUnsupportedReason` is a stable code (`novelai` | `novellist` | `ooba` |
`plugin` | `webllm` | `format-not-server-routable` | `config-incomplete`). Each
consumer maps it to prose.

`ProviderCapabilityInput` is normalized and **reads no globals** (no
`getDatabase()` / `isFastifyServer` inside the table): `format`, `aiModel`,
`endpoint?`, `keyIdentifier?`, `internalID?`, and a `config` carrying only the
fields the gates read — `forceReplaceUrl`, `proxyKey`, `oaiCompApiKeys`,
`customModels`, `googleProjectId`, `vertexRegion`, `vertexClientEmail`,
`vertexPrivateKey`, `claudeAPIKey`, `instructChatTemplate`, `jinjaTemplate`,
`ollamaApiKey`, `ollamaRequestFormat`, `ollamaURL`.

## Owner / timing / state

Pure classification — no I/O, no mutation, no persistence, no active-writer or
projection interaction. Runs at browser send-time (completion route + the
delegated prompt-assembly route) and at server `/chat` dispatch-time.

## Errors / rollback

- `routable: false` → browser: the existing `{ type: 'fail', noRetry: true }`
  terminal (no local fallback in Fastify mode); server: `dispatchChatProvider`
  throws the mapped reason → `/chat` `error` frame then `done`. The failure
  **shape** is unchanged.
- Rollback: revert the three edited files + delete the shared module, its tests,
  the matrix fixture, and the audit fixtures. No persisted state, no data
  migration.

## Proof

Because there is exactly one classifier (`resolveProviderCapability`), parity is
structural; the tests prove the table's decisions and that each consumer wires it
faithfully (incl. the ooba flip on **both** sides):

- Pure table matrix — `src/ts/process/request/tests/providerCapability.test.ts`
  (root suite, no globals): the full resolvable provider set, every unsupported
  category, the config-incomplete gates, and `reverse_proxy` (routable, no ooba
  gate).
- Browser delegation — `serverCompletion.test.ts`: the existing provider suite
  plus an explicit `reverse_proxy` + `reverseProxyOobaMode` → `server`/`openai`
  case (decision-#5 parity).
- Server delegation — `server/fastify/__tests__/providerCapabilityRoute.test.ts`
  (`api:test`): `resolveChatProviderRoute(db)` over representative dbs — the ooba
  flip (now `routable`/`openai`), preserved per-format unsupported messages, the
  server-only unknown-id guard, and the `ollama-cloud` API-key gate. The flipped
  case is also removed from `generation.chat.test.ts`'s unsupported list.
- `client-thinning:audit` invariant: both files import + call
  `resolveProviderCapability`; `chatDispatch` no longer forks the capability
  decision (`resolveProvider` / `unsupportedChatProviderReason` capability logic
  is gone). Failing + bypass fixtures per the audit-rule convention.
- Regression: `pnpm test`, `pnpm api:test`, `pnpm client-thinning:audit` green.
  `api:test` is the server dispatchable-set safety net — only the intended ooba
  case changes.

## Risk

Adopting the completion path's per-provider gates on the server makes the server
classify a structurally-incomplete config `unsupported` at classify-time instead
of throwing inside the dispatch arm. Those gates were written to mirror the
server's dispatch requirements (per their in-code comments), so this is
behavior-preserving except the intended ooba change; `api:test` confirms (only
`generation.chat.test.ts`'s ooba case is updated).
