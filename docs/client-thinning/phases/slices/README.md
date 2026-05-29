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
slice 1   text-send → server ; {asset, imagegen, lua/plugin} → unsupported
slice 3a  + asset    → server   (port AssetLookup; flip the asset detector)
slice 3c  + imagegen → server   (port newGenData instruction; flip that detector)
slice 3b  + lua/plugin → server  (stand up server script VM; flip that detector) — or stay unsupported by decision
```

C-A1 (slice 2) and A2 (slice 4) are the post-generation persistence/derivation
half and sit alongside this line: slice 2 moves an already-computed delta into
the route; slice 4 adds a server path for a delta that has none.

## Sequencing

```
slice 1 (foundation) ──┬─→ slice 3a (asset)        ─┐
                       ├─→ slice 3c (image-gen)     ─┤
                       └─→ slice 3b (lua/plugin) ───┴─→ slice 4 (A2)
slice 2 (C-A1) ── independent of slice 1; smallest; can land first ──→
```

- **Slice 1 is the gate** for every A1 content slice (3a/3b/3c) — they "flip a
  detector" that only exists once the classifier does.
- **Slice 2 (C-A1)** has no parity blocker and does not depend on slice 1 — the
  plan recommends it right after the foundation as the smallest real batch.
- **3a and 3c** are independent of each other. **3b** is the largest (it needs a
  server scripting VM) and is the natural predecessor of **slice 4**, whose
  durable derivations reuse the same trigger/script machinery.

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
pnpm client-thinning:audit                                  # 20-rule audit; fix/triage red before runtime work
pnpm api:test                                               # server suite (incl. generation.chat.test.ts)
pnpm test                                                   # full client suite (incl. src/ts/process/...)
```

Focused forms and the exact proof-lead files are in
[`../../reference/proof-points.md`](../../reference/proof-points.md). After a
recordable run, replace
[`../../coverage/latest-verification.md`](../../coverage/latest-verification.md)
with only the latest command + result.

## The rule (inherited from the phase doc)

One blocker item per batch. Name the browser branch, the server contract that
replaces it, and the proof the local fallback is gone. Do not mix A1 content
classes, A2, and group-chat removal in one review. Group chat is **legacy**
(client removal, separate task) — do not add a server group model. Update the
status/coverage shards and the parity matrix after the code and proof land.
