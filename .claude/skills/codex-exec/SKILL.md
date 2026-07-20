---
name: codex-exec
description: Delegate a self-contained coding or research task to the OpenAI Codex CLI running non-interactively (`codex exec`). Use when the user asks to run something "with codex", "using codex exec", get a second opinion from codex, or hand off a bounded task to codex.
---

# codex-exec

Run codex headlessly to delegate a task, then relay the result. Two modes:

1. **App-server mode (preferred)** — run the turn through the local app-server daemon via `scripts/appserver_run.py`. The session is recorded as an interactive (`vscode`-source) thread, so the user's remote-connected Codex app sees it live in its thread list and can open/steer it. Plain `codex exec` sessions are stamped `source: exec` and are **invisible** to the app (its thread list only shows interactive sources).
2. **`codex exec` fallback** — when the daemon socket `~/.codex/app-server-control/app-server-control.sock` doesn't exist, or app visibility explicitly doesn't matter.

Both modes run full-auto by default (no approval prompts, `danger-full-access` sandbox).

## When to use

- The user explicitly asks to use codex / `codex exec` for a task.
- You want a second implementation or opinion on a self-contained problem.
- A task is well-scoped enough to hand off (a focused edit, a question about the repo, a review).

## App-server mode (default)

Helper: `.claude/skills/codex-exec/scripts/appserver_run.py` (stdlib-only Python; speaks the app-server WebSocket protocol over the daemon's unix control socket).

**One-shot:**

```bash
python3 .claude/skills/codex-exec/scripts/appserver_run.py run \
  --cwd /home/codex/risuai-fastify --effort xhigh \
  --name "Short label shown in the Codex app" \
  -o <SCRATCHPAD>/codex-out.txt \
  "PROMPT"
```

- Progress streams to **stderr** (commands codex runs, files edited, interim messages); the final agent message goes to **stdout** and to `-o FILE`.
- `thread id: <UUID>` is printed to stderr right after start — capture it for follow-ups.
- Always pass `--name` so the user can recognize the thread in their app.

**Follow-up turn (stateful sub-agent):**

```bash
python3 .claude/skills/codex-exec/scripts/appserver_run.py run \
  --thread-id <UUID> --cwd /home/codex/risuai-fastify "Follow-up instruction..."
```

**Flags:** `--effort none|low|medium|high|xhigh` (default = codex config; NO `minimal` — the current model rejects it; default to `xhigh` — use a lower effort only if the task is trivial or xhigh is clearly overkill), `--model`, `--sandbox read-only|workspace-write|danger-full-access` (default `danger-full-access`; use `read-only` for pure questions/reviews), `--timeout SECS` (default 3600; interrupts the turn on expiry), `--sock PATH`.

**Debug/list:** `appserver_run.py list [--source-kinds exec] [--limit N]` shows threads as the app sees them (default listing = interactive sources only).

**Exit codes:** 0 completed, 2 turn failed/interrupted, 3 protocol/daemon error, 124 timeout. On 3 (daemon not running), fall back to `codex exec`.

Bonus of this mode: the user can open the thread in their Codex app mid-run, watch it stream, and send their own follow-ups later.

## `codex exec` fallback

```bash
codex exec --yolo -c model_reasoning_effort="xhigh" "PROMPT" --cd /home/codex/risuai-fastify \
  -o <SCRATCHPAD>/codex-out.txt
```

Key flags:

- `--yolo` — full auto: alias for `--dangerously-bypass-approvals-and-sandbox`. Always pass this — without it, codex hits approval prompts or sandbox denials it can't resolve non-interactively and the run stalls/fails.
- `--cd <DIR>` — working root. Default to the project dir.
- `-m, --model <MODEL>` — pick the model (omit for codex's configured default).
- `-c model_reasoning_effort="<minimal|low|medium|high|xhigh>"` — reasoning effort (config override; values are not validated at startup — a typo is silently accepted). The startup banner echoes the effective value. Default to `xhigh`; drop to a lower effort only for trivial/throwaway tasks (e.g. `codex exec review`).
- `-o, --output-last-message <FILE>` — write codex's final message to a file (read it cleanly, no ANSI noise).
- `--json` — emit JSONL events; parse when you need structured output or the session id.

**Resume** (`resume` is a subcommand — exec-level flags go BEFORE it):

```bash
# turn 1: capture "session id: <UUID>" from output
codex exec --yolo "Kick-off task..." --cd /home/codex/risuai-fastify 2>&1 | tee /dev/stderr | grep "session id:"
# turn 2+:
codex exec --yolo --cd /home/codex/risuai-fastify -o <SCRATCHPAD>/codex-out.txt \
  resume <SESSION_ID> "Follow-up instruction..."
```

Prefer an explicit `<SESSION_ID>` over `resume --last` when several codex sessions may interleave. `codex exec resume --last --all` ignores the cwd filter.

## Built-in review

`codex exec review` runs a code review against the repo (add `--yolo`/`--cd` as above). Review runs are fine to leave in exec mode — they're throwaway.

## Long-running tasks

Run via the Bash tool's `run_in_background`, then read the `-o` output file when it completes.

- **App-server mode:** safe in background as long as the prompt is passed as an argument (the script only reads stdin when the prompt is omitted or `-`). Adding `< /dev/null` is still harmless insurance.
- **`codex exec` mode — stdin MUST be closed.** With `run_in_background`, stdin stays open as a pipe; `codex exec` (observed on 0.144.3) prints "Reading additional input from stdin..." and blocks forever before creating a session. Always append `< /dev/null`, and wrap in `timeout` as a backstop:

```bash
timeout 900 codex exec --yolo "PROMPT" --cd <DIR> -o <SCRATCHPAD>/codex-out.txt < /dev/null
```

Avoid piping stdout through `tail`/`grep` on background runs — it hides interim progress until the pipeline exits.

## Guidance

- Give codex a self-contained prompt on turn 1 — it starts cold with no memory of THIS conversation. Include file paths and context. On follow-ups it remembers only its OWN prior turns.
- Full-auto gives codex unrestricted access. Use `--sandbox read-only` (or `-s read-only`) for pure questions/reviews.
- After it finishes, summarize what codex did/said — don't just dump raw output. If codex edited files, review the diff before treating it as done.
