# Ooba OAI-compat (LLMFormat.Ooba) — Phase 6-15 Design Memo

Date: 2026-05-22
Status: open question, needs a call

## The question

Should Phase 6-15 route `LLMFormat.Ooba` through the existing
`openai-legacy-instruct` server dispatcher (HANDOVER.md's
suggestion), or does that change behavior for existing users?

## Why this isn't actually straightforward

HANDOVER.md called this slice "no new dispatcher" because Ooba's
modern endpoint at `db.textgenWebUIBlockingURL/v1/completions`
accepts the same wire shape as OpenAI's legacy `/v1/completions`:

- Request: `{model, prompt, max_tokens, temperature, top_p, stop,
  presence_penalty, frequency_penalty, ...}`
- Response: `{choices: [{text}]}`

The wire shape is the same — but the **prompt formatting** is not.

The local Ooba code at `src/ts/process/request/request.ts:845`
calls `applyChatTemplate(formated)`. That helper
(`src/ts/process/templates/chatTemplate.ts:27`) is a Jinja
renderer (`@huggingface/jinja`) driven by
`db.instructChatTemplate`. Eight built-in templates ship:

| Template | Shape |
| --- | --- |
| `llama3` | `<\|start_header_id\|>{role}<\|end_header_id\|>\n\n{content}<\|eot_id\|>` |
| `llama2` | `[INST] {content} [/INST]` with `<<SYS>>` blocks |
| `chatml` / `gpt2` | `<\|im_start\|>{role}\n{content}<\|im_end\|>\n` |
| `gemma` | `<start_of_turn>{role}\n{content}<end_of_turn>\n`, no system rows |
| `vicuna` | `USER: ...\nASSISTANT: ...</s>\n` |
| `alpaca` | `### Instruction:\n{content}\n\n### Response:\n` |
| `mistral` | `[INST] ... [/INST]` with role alternation, no system rows |

Plus a `jinja` mode that takes `db.JinjaTemplate` as a custom
Jinja string.

The existing `flattenForLegacyInstruct`
(`server/fastify/src/generation/openaiLegacyInstruct.ts:46`)
produces a 9th, distinct format:

```
\n## User\n<content>\n## Response\n
```

So routing `LLMFormat.Ooba` through the existing dispatcher
**silently changes the prompt format for every Ooba user**. The
wire works; the prompt doesn't match the chat template the model
weights expect. Output quality degrades and the model may emit
the `## User` / `## Response` markers verbatim because they
aren't in its training distribution.

This is a behavior break dressed up as a routing change. It
can't go in unflagged.

## The options

### A — Don't ship Ooba server-routed; keep it on local dispatch

Cheapest. Local Ooba already works; the only reason to move it
server-side is the broader Phase 6 goal of pulling all dispatch
off the client. Leave `LLMFormat.Ooba` on
`formatToServerProvider() → null` and revisit later.

- **Cost:** ~0 LOC.
- **Benefit:** none — Phase 6 stays incomplete for Ooba.
- **Risk:** none.

### B — Pre-flatten on the client; send a `prompt` string

Add a new server-side request mode — extend
`openai-legacy-instruct` with a `prompt` field that takes a
pre-flattened string, or introduce a sibling `openai-prompt`
provider. The client renders the prompt via `applyChatTemplate`
and ships the string.

- **Cost:** ~80 LOC. New `options.openai-legacy-instruct.prompt`
  opt-in path; client-side branch in `requestServerCompletion`
  that calls `applyChatTemplate(formated,
  {type: db.instructChatTemplate, custom: db.JinjaTemplate})`;
  the server stops accepting `messages` when this mode is on.
- **Benefit:** Keeps the existing Jinja templating intact. No
  new server-side dep.
- **Catch:** The server boundary becomes inconsistent — every
  other provider takes `messages: ChatMessage[]`; Ooba alone
  takes a rendered string. That couples the client and server
  contracts in a way that's hard to undo without versioning.
  Future tools/multimodal work that uses `messages` won't apply
  to Ooba. Phase 7 (prompt assembly) eventually pulls the
  template work server-side anyway, at which point this branch
  becomes a deprecated stopgap.

### C — Port `applyChatTemplate` to the server

Move the Jinja templating server-side: pull in
`@huggingface/jinja`, the 8 built-in template strings, the
`templateEffect` map (`no_system_messages`,
`alter_user_assistant_roles`), the `risu_char` / `risu_user`
substitution variables, and the `db.instructChatTemplate` /
`db.JinjaTemplate` plumbing through `options.ooba`.

- **Cost:** ~250 LOC dispatcher + helper + tests. New server
  dep on `@huggingface/jinja` (~30 KB minified, no native
  bindings).
- **Benefit:** Symmetry with the rest of Phase 6 — server keeps
  owning prompt assembly, messages stay normalized. This is a
  partial down-payment on Phase 7 (prompt assembly) work.
- **Catch:** Plumbing the user/character names through
  `options.ooba` is awkward — the server doesn't own SPA
  character state today, so we'd pass `risuChar` / `risuUser` as
  ad-hoc options fields just for Ooba, then unwind that when
  Phase 7 generalizes character context. The custom-template
  surface (`db.JinjaTemplate`) also needs sandboxing thought —
  arbitrary user-provided Jinja that runs on the server is a
  small attack surface to think about, even if just for the
  user's own server.

### D — Ship A now, do C as part of Phase 7

Defer the decision. Keep Ooba on local dispatch through Phase 6;
plan for the Jinja work to land naturally when Phase 7 ("prompt
assembly") moves chat template rendering server-side anyway.
Phase 7's job is to extract `applyChatTemplate` and friends to a
server-owned prompt builder, so doing it earlier duplicates
work.

- **Cost:** 0 LOC in Phase 6; the work happens in Phase 7 as
  planned.
- **Benefit:** Avoids premature server-side Jinja work and the
  awkward `risuChar`/`risuUser` plumbing detour.
- **Catch:** Phase 6's "all providers server-routed" status
  stays incomplete for one provider until Phase 7 ships. The
  HANDOVER list shows the gap explicitly, which is fine.

## What I'd pick

**D, with the gap documented in `next-steps.md` and
`phase-6-server-generation.md`.** Reasoning:

- Local Ooba works today; cost of A is zero.
- Option C is going to happen in Phase 7 regardless. Pulling it
  forward to Phase 6 means doing the Jinja port twice (once
  partial here, then properly when Phase 7 generalizes) or
  shipping B as a stopgap and deprecating the prompt-string
  contract when Phase 7 lands. Both are worse than waiting.
- The `risuChar` / `risuUser` plumbing detour in C is the
  clearest signal that the work is in the wrong phase — Phase 7
  is where character context becomes a first-class server
  concept.

Option B is interesting if Phase 7 is many months out and we
really need all providers server-routed before then — but the
rendered-string contract introduces an asymmetry that survives
long after Phase 7, even if we deprecate it.

If you'd rather not wait for Phase 7, the next-best is C: do
the Jinja port server-side now, accept the `@huggingface/jinja`
server dep, and treat it as Phase 7 work pulled forward. That's
a clean answer; it's just bigger than what HANDOVER described.

## Triggers to revisit

- Phase 7 slips significantly past Phase 6 closeout **and** the
  "all providers server-routed" goal becomes load-bearing for
  another slice (e.g., a future client-thinning step).
- A user reports Ooba quality drops because the local
  `applyChatTemplate` diverges from the model's expected
  template — that's a sign the Jinja-port discussion needs to
  happen sooner.
- A new Phase 6 dispatcher (e.g., NovelAI's `stringlize` work)
  ends up needing the same client-side flattening pattern,
  pushing the design toward option B as a general rule rather
  than an Ooba-only carveout.

## What this slice would have looked like (for reference)

If the local code and the existing Legacy Instruct flatten had
matched, Slice 6-15 would have been roughly:

```diff
@@ formatToServerProvider @@
+    case LLMFormat.Ooba:
+      return 'openai-legacy-instruct'

@@ isVanillaLegacyInstruct @@
   // Add an Ooba branch that requires db.textgenWebUIBlockingURL.

@@ buildProviderOptions['openai-legacy-instruct'] @@
+  if (targ.modelInfo?.format === LLMFormat.Ooba) {
+    legacy.baseUrl = db.textgenWebUIBlockingURL
+    delete legacy.apiKey  // Ooba doesn't require one; reverse proxies
+                          // handle their own auth.
+  }
```

~60 LOC + adapter tests. The reason that diff doesn't land here
is the prompt-format mismatch above, not the wire-level work.
