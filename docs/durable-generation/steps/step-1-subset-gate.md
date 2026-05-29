# Step 1 (Milestone 1): the `resolveDurableGeneration` subset gate

Date: 2026-05-29
Status: **DRAFT spec** — to implement under the durable-generation workstream
(`../README.md`). Milestone 1 = survive client disconnect only.
**Revised 2026-05-30 (decision #2):** the A2 post-gen path is in-subset, so the two
post-gen exclusions (output trigger, `editoutput`) are **removed** — slice 4 landed,
and Step 3 persists the derived result. The gate is now a thin wrapper over
`resolveServerPromptAssembly` + the `send`-mode check.

| | |
| --- | --- |
| **Workstream / milestone / step** | Durable generation · Milestone 1 (disconnect-only) · Step 1 |
| **Depends on** | client-thinning **slice 1** (`resolveServerPromptAssembly`, landed) |
| **Reference** | `../README.md` ("Supported subset", "Coverage ceiling"); `src/ts/process/request/serverPromptAssembly.ts`; `serverCompletion.ts`; client-thinning `slice-4` (A2) |
| **Goal** | A pure classifier that decides whether a send is **durable-generation-eligible** — i.e. server-assembled (the A2 post-gen path is in-subset per decision #2; Step 3 persists the derived result). No behavior change yet; Step 2 consumes the verdict to route the job path. |

## Why a NEW two-arm verdict (do not copy the 3-arm precedent)

`resolveServerCompletionRoute` and `resolveServerPromptAssembly` are 3-arm
(`local | server | unsupported`) because their `unsupported` arm **must hard-fail**:
a wrong prompt assembly or a browser-side provider fallback silently corrupts or
mis-routes the send. There is **no analogous correctness hole** here. A send that
isn't durable-eligible simply uses today's connection-scoped flow — which is
*correct*, just not disconnect-survivable. Durability is an **enhancement, not a
correctness gate**.

So the verdict is **two-arm**:

```ts
export type DurableGenerationRoute =
  | { type: 'durable' }
  | { type: 'non-durable'; reason: string }
```

`reason` is for diagnostics/tests and a future "why can't this chat survive
disconnect?" hint — it never triggers a hard fail.

## Inputs

Reuse `ServerPromptAssemblyInput` (`serverPromptAssembly.ts:21-28`) verbatim — the
post-gen detection reads the same accessors the assembly gate already uses
(`currentChar.triggerscript`, `currentChar.customscript`, `getModuleTriggers()`,
`getModuleRegexScripts()`, `db.presetRegex`). No new input fields.

## Decision order

```
resolveDurableGeneration(input):
  1. mode must be 'send' (milestone-1 first cut).
       else → non-durable('durable generation currently supports send mode only')
       // continue / regenerate are follow-ups (README open question).
  2. const assembly = resolveServerPromptAssembly(input)
     if assembly.type !== 'server'
       → non-durable(assembly.type === 'unsupported' ? assembly.reason : 'not server-assembled')
     // This single delegation inherits ALL of: !isFastifyServer, flag off,
     // non-text send, group char, non-server-routable provider, and the
     // asset / image-gen / pluginV2 / interactive-Lua content classes.
     // assembly === 'server' excludes pluginV2 hooks and interactive Lua dialogs;
     // non-interactive Lua is IN-subset (the server Lua VM landed, slice 3b).
  3. → durable
     // Decision #2 (2026-05-30): output triggers and editoutput are NO LONGER
     // excluded. Slice 4 (A2) landed, so Step 3 runs runServerPostGeneration at
     // completion and persists the derived final text + scriptstate delta
     // server-side. There is no remaining post-gen surface this gate must screen.
```

Grounding: `assembly === 'server'` already encodes the content gating
(`resolveServerPromptAssembly`). The gate adds only the `send`-mode restriction;
output-trigger / `editoutput` detection is no longer needed here because the durable
job derives and persists those at completion (Step 3).

## Composition: the subset grows as other slices land

This gate adds exactly **one** restriction (mode = `send`) on top of the assembly
subset; all content gating is inherited from `resolveServerPromptAssembly`, so durable
coverage widens automatically as the assembly subset widens. Status of each class:

| Class | Owner | Status |
| --- | --- | --- |
| asset / multimodal / image-gen | assembly gate | landed (slices 3a / 3c) — in-subset for vision models |
| Lua content (non-interactive) | assembly gate | landed (slice 3b + server Lua VM) — in-subset |
| pluginV2 content; interactive-Lua dialogs | assembly gate | **never** (permanent unsupported) |
| output trigger / `editoutput` post-gen | (was this gate) | **removed 2026-05-30 (decision #2)** — slice 4 landed; Step 3 persists the derived result |
| mode ≠ `send` | this gate | open — durable-gen follow-up (continue / regenerate) |

The two post-gen exclusions are **gone (decision #2)**: slice 4 landed the server
`'output'` trigger + `editoutput` pass, so the durable job derives and persists those
at completion (Step 3) rather than excluding them.

## Wiring (Step 1 is behavior-neutral)

Ship the **pure function + its test suite only**. Do **not** wire it into `sendChat`
yet — there is no durable job path to route to until Step 2, and an unwired pure
classifier keeps Step 1 a zero-behavior-change addition (same shape as how slice 1
could be reasoned about in isolation). Step 2 imports it to choose between the
durable job path and the current flow.

## Prove (negative-test list)

Unit tests on the pure function (mirror `serverPromptAssembly.test.ts`):

- mode `continue` / `regenerate` / `preview` / `preview_prompt` → `non-durable`.
- `!isFastifyServer` → `non-durable`.
- `useServerPromptAssembly` off → `non-durable`.
- each inherited assembly exclusion (asset, image-gen, Lua trigger, pluginV2 hook,
  group char, non-routable provider, non-text send) → `non-durable`.
- char with an `'output'` `triggerscript` (e.g. `v2SetVar`) → `durable` (decision #2:
  in-subset; Step 3 runs the post-gen pass and persists the derived state).
- a **module** with an `'output'` trigger → `durable`.
- `char.customscript` / `db.presetRegex` / module regex with `type: 'editoutput'`
  → `durable`.
- **Positive (durable):** clean text `send`, single non-group char, server-routable
  provider, flag on — with or without an output trigger / `editoutput`.
- **Discriminating positive/negative:** a char with non-interactive Lua (server VM)
  → `durable`; a char with an *interactive* Lua dialog (`alertInput`) → `non-durable`
  (inherited from the assembly gate, not this gate).

## Scope guard

- Build the classifier + tests only. **No job path** (Step 2), **no transport**
  (WS-vs-SSE is a Step 2 decision), **no `sendChat` wiring**.
- Do not touch the assembly classifier's arms (content gating lives there).
- `send` mode only.

## When this step is done

- [ ] `resolveDurableGeneration` exists as a pure function returning
      `durable | non-durable(reason)`, delegating to `resolveServerPromptAssembly`
      plus the `send`-mode restriction (no separate post-gen exclusion — decision #2).
- [ ] The negative + discriminating tests above are green (incl. output-trigger /
      `editoutput` sends now resolving `durable`).
- [ ] It is **unwired** (no behavior change); Step 2 will consume it.
