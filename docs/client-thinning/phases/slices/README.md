# Phase 4 Slices

Date: 2026-05-29

Step-by-step expansions of the [`../phase-4-sendchat-thinning.md`](../phase-4-sendchat-thinning.md)
**Work Order**. The phase doc says *what* each batch is and *why*; the
[`../../reference/`](../../reference/README.md) docs give the exact code
coordinates (signatures, file:line anchors, parity matrix). These slices are the
missing middle layer: the **ordered procedure** for carrying out one batch —
what to read, what to change, in what order, and what to prove — so the work is
followable without re-deriving the sequence each time.

Each slice is self-contained and maps 1:1 to a Work Order item (item 3 fans into
three content batches, 3a/3b/3c, because each content class graduates
independently and "one blocker item per batch" forbids mixing them).

## Work order → slice

| WO # | Batch | Slice | Blocker | Reference |
| --- | --- | --- | --- | --- |
| 1 | Prompt-assembly classifier | [`slice-1-a1-foundation-classifier.md`](slice-1-a1-foundation-classifier.md) | A1 (foundation) | [`prompt-assembly-classifier.md`](../../reference/prompt-assembly-classifier.md) |
| 2 | Server-side scriptstate persistence | [`slice-2-c-a1-scriptstate-persistence.md`](slice-2-c-a1-scriptstate-persistence.md) | C-A1 | [`post-generation-and-persistence.md`](../../reference/post-generation-and-persistence.md) |
| 3a | Multimodal / asset inlining | [`slice-3a-content-multimodal-asset.md`](slice-3a-content-multimodal-asset.md) | A1 (content) | [`server-assembler-parity.md`](../../reference/server-assembler-parity.md) + [`local-assembler-content-classes.md`](../../reference/local-assembler-content-classes.md) |
| 3b | Lua / plugin-V2 + input scripts | [`slice-3b-content-lua-plugin-scripts.md`](slice-3b-content-lua-plugin-scripts.md) | A1 (content) | same two assembler docs |
| 3c | Image-gen instruction | [`slice-3c-content-image-gen-instruction.md`](slice-3c-content-image-gen-instruction.md) | A1 (content) | same two assembler docs |
| 4 | Server output-trigger + `editoutput` | [`slice-4-a2-output-trigger-editoutput.md`](slice-4-a2-output-trigger-editoutput.md) | A2 | [`post-generation-and-persistence.md`](../../reference/post-generation-and-persistence.md) |

## The through-line: the graduation model

The slices are not independent islands — they form one mechanism. Slice 1 builds
`resolveServerPromptAssembly` and makes it route **every** content class
(asset/image-gen/Lua/plugin) to `unsupported`, so the only thing left routing to
`server` is the pure-text-send subset. That subset becomes server-mandatory; the
local assembler is dead for it.

Each later A1 content slice then **graduates exactly one class**: it ports the
class to the server assembler, adds a parity fixture, and flips that one detector
in the classifier from `→ unsupported` to `→ server`. Nothing silently falls back
to local at any point — a class is either `server` (ported) or `unsupported`
(hard fail), never `local` (in Fastify mode).

```
slice 1   DONE: text-send → server when flag on; unsupported content hard-fails
slice 2   DONE: assembly-time scriptstate persists in /generate/chat
slice 3a  DONE: image-input multimodal/asset → server; non-vision caption → unsupported
slice 3b  DONE: pluginV2 permanent unsupported; Lua edit/input hooks → server
slice 3c  OPEN: image-gen instruction → server
```

Slice 3b split in two: **pluginV2** is permanent `unsupported` (landed 2026-05-29,
classifier split + the `A4R-pluginv2` audit invariant), and **Lua** is a committed
server port under [`slice-3b-lua/`](slice-3b-lua/README.md). All four Lua
sub-slices have landed; only interactive Lua dialog APIs remain `unsupported`.

C-A1 (slice 2) and A2 (slice 4) are the post-generation persistence/derivation
half and sit alongside this line: slice 2 moves an already-computed delta into
the route; slice 4 adds a server path for a delta that has none.

## Sequencing

```
slice 1 (foundation) ──┬─→ slice 3a (asset)        ─┐
                       ├─→ slice 3c (image-gen)     ─┤
                       └─→ slice 3b (Lua port) ───────┴─→ slice 4 (A2)
slice 2 (C-A1) ── landed ───────────────────────────────────────────→
```

- **Slice 1 is the landed gate** for every A1 content slice (3a/3b/3c).
- **Slice 2 (C-A1)** is landed and remains separate from A2 durable post-gen work.
- **3a and 3b are landed; 3c remains independent.** Slice 4's durable
  derivations reuse the same trigger/script machinery, but run after generation.

## Shared definition of done

Every slice inherits the per-batch proof shape from
[`../../coverage/sendchat-generation.md`](../../coverage/sendchat-generation.md):
prove the exact mode; that the browser branch is removed/server-owned **or** the
send is classified `unsupported` (never a silent local fallback); message-row
effects; command revision + active-writer behavior for any persisted mutation;
SSE frames + terminal behavior; rollback; B1 effects preserved; and that
unsupported providers still hard-fail (A3). Each slice's own "When this slice is
done" section names the batch-specific additions.

## Shared verification (run before and after every slice)

```
pnpm client-thinning:audit                                  # 21-rule audit; fix/triage red before runtime work
pnpm api:test                                               # server suite (incl. generation.chat.test.ts)
pnpm test                                                   # full client suite (incl. src/ts/process/...)
```

Focused forms and the exact proof-lead files are in
[`../../reference/proof-points.md`](../../reference/proof-points.md). After a
recordable run, replace
[`../../coverage/latest-verification.md`](../../coverage/latest-verification.md)
with only the latest command + result.

## The rule (inherited from the phase doc)

Inherit the phase batching rule: one blocker item per batch, no group-chat
removal mixed with thinning, and update the status/coverage/parity shards after
the code and proof land.
