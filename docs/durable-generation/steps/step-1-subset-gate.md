# Step 1 (Milestone 1): the `resolveDurableGeneration` subset gate

Date: 2026-05-29
Status: **DRAFT spec** — to implement under the durable-generation workstream
(`../README.md`). Milestone 1 = survive client disconnect only.

| | |
| --- | --- |
| **Workstream / milestone / step** | Durable generation · Milestone 1 (disconnect-only) · Step 1 |
| **Depends on** | client-thinning **slice 1** (`resolveServerPromptAssembly`, landed) |
| **Reference** | `../README.md` ("Supported subset", "Coverage ceiling"); `src/ts/process/request/serverPromptAssembly.ts`; `serverCompletion.ts`; client-thinning `slice-4` (A2) |
| **Goal** | A pure classifier that decides whether a send is **durable-generation-eligible** — server-assembled *and* free of post-generation derivation the server cannot yet persist. No behavior change yet; Step 2 consumes the verdict to route the job path. |

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
     // asset / image-gen / Lua / pluginV2 content classes. In particular,
     // assembly === 'server' GUARANTEES no Lua and no pluginV2 hooks.
  3. no post-gen OUTPUT TRIGGER:
       if (currentChar.triggerscript ?? []).some(t => t.type === 'output')
          || getModuleTriggers().some(t => t.type === 'output')
       → non-durable('an output trigger derives post-gen state the server cannot yet persist (A2 / slice 4)')
  4. no post-gen EDITOUTPUT regex script:
       if [char.customscript, db.presetRegex, getModuleRegexScripts()].flat()
            .some(s => s.type === 'editoutput')
       → non-durable('an editoutput script derives post-gen text the server cannot yet apply (A2 / slice 4)')
  5. → durable
```

Grounding: `triggerscript.type` is the trigger mode (`triggers.ts:47`), matched by
`runTrigger` via `mode !== trigger.type` (`triggers.ts:1366`). `customscript.type`
is the `ScriptMode` (`scripts.ts:29`). Steps 3–4 catch only the **non-Lua / regex**
post-gen surface — the Lua/pluginV2 output hooks are already excluded at step 2.

## Composition: the subset grows as other slices land

This gate adds exactly **two** exclusions (steps 3–4) on top of the assembly subset.
Everything else is inherited, so durable coverage widens automatically as the
assembly subset widens. When each exclusion is removed:

| Exclusion | Owner | Removed when |
| --- | --- | --- |
| asset / multimodal / image-gen | assembly gate | slices 3a / 3c |
| Lua content | assembly gate | slice 3b + server Lua VM |
| pluginV2 content | assembly gate | **never** (permanent unsupported) |
| **output trigger (non-Lua)** | this gate, step 3 | **slice 4** (server post-gen pass) |
| **editoutput regex** | this gate, step 4 | **slice 4** (server post-gen pass) |
| mode ≠ `send` | this gate, step 1 | durable-gen follow-up (continue / regenerate) |

**Do not let steps 3–4 become permanent.** When client-thinning slice 4 lands the
server `'output'` trigger + `editoutput` pass, delete those two exclusions here.

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
- char with an `'output'` `triggerscript` whose effect is **non-Lua** (e.g.
  `v2SetVar`) → `non-durable` (proves step 3 catches what the assembly gate doesn't).
- a **module** with an `'output'` trigger → `non-durable`.
- `char.customscript` / `db.presetRegex` / module regex with `type: 'editoutput'`
  → `non-durable`.
- **Positive (durable):** clean text `send`, single non-group char,
  server-routable provider, flag on, no output trigger, no editoutput.
- **Discriminating positive:** a char with a `'start'` trigger and an `'editprocess'`
  / `'editinput'` regex (assembly-time, server-parity) but no output-trigger/editoutput
  → `durable` (assembly-time scripts must NOT block durability).

## Scope guard

- Build the classifier + tests only. **No job path** (Step 2), **no transport**
  (WS-vs-SSE is a Step 2 decision), **no `sendChat` wiring**.
- Do not touch the assembly classifier's arms (those graduate via slices 3a/3b/3c).
- Do not remove the output-trigger / editoutput exclusions (slice 4's job).
- `send` mode only.

## When this step is done

- [ ] `resolveDurableGeneration` exists as a pure function returning
      `durable | non-durable(reason)`, delegating to `resolveServerPromptAssembly`.
- [ ] The two post-gen exclusions (output trigger, editoutput regex) are grounded
      in `triggerscript.type === 'output'` and `customscript.type === 'editoutput'`.
- [ ] The negative + discriminating-positive tests above are green.
- [ ] It is **unwired** (no behavior change); Step 2 will consume it.
- [ ] A code comment ties steps 3–4 to slice 4 so they're removed when A2 lands.
