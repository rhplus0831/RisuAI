---
name: call-codex
description: Delegate a self-contained coding or research task to the OpenAI Codex CLI running non-interactively. Use when the user asks to run something "with codex", "using codex exec", get a second opinion from codex, or hand off a bounded task to codex.
---

# call-codex

Run codex headlessly to delegate a task, then relay the result. One entry point:

**`.claude/skills/call-codex/scripts/codex_run.py`** (stdlib-only Python). It prefers the local **app-server daemon** (`~/.codex/app-server-control/app-server-control.sock`) — the session is recorded as an interactive (`vscode`-source) thread, so the user's remote-connected Codex app sees it live in its thread list and can open/steer it. If the daemon is unreachable, the script **falls back to `codex exec` automatically** (exec sessions are stamped `source: exec` and are invisible to the app). Never probe the socket or call `codex exec` yourself for a fresh task — just run the helper.

Both modes run full-auto (no approval prompts, `danger-full-access` sandbox) by default.

## When to use

- The user explicitly asks to use codex / `codex exec` for a task.
- You want a second implementation or opinion on a self-contained problem.
- A task is well-scoped enough to hand off (a focused edit, a question about the repo, a review).

## Running a task

```bash
python3 .claude/skills/call-codex/scripts/codex_run.py run \
  --cwd /home/codex/risuai-fastify --effort xhigh \
  --name "Short label shown in the Codex app" \
  -o <SCRATCHPAD>/codex-out.txt --meta <SCRATCHPAD>/codex-meta.json \
  "PROMPT"
```

**Prompt input:** positional argument, `--file PATH`, or stdin (`-` or omitted). Passing both PROMPT and `--file` is an error. For long prompts prefer `--file` over shell quoting.

**Output contract:**

- Final agent message → **stdout** and `-o FILE`. Progress (commands run, files edited, interim messages) → **stderr**.
- Stable metadata lines on stderr: `mode: appserver` + `thread id: <UUID>`, or `mode: exec (fallback)` + `session id: <UUID>`. `--meta FILE` writes the same as JSON: `{mode, fallback, fallback_reason, thread_id, session_id, exit_code}` — read it after the run to learn which mode ran and the ID for follow-ups.

**Flags:** `--effort none|low|medium|high|xhigh` (default = codex config; NO `minimal` — the current model rejects it; default to `xhigh` — use a lower effort only if the task is trivial or xhigh is clearly overkill), `--model`, `--sandbox read-only|workspace-write|danger-full-access` (default `danger-full-access`; see sandbox note below), `--timeout SECS` (default 3600; interrupts/kills on expiry), `--name` (thread name in the Codex app — always pass it; appserver-only, ignored in fallback), `--sock PATH`.

**Exit codes:** 0 completed, 2 turn failed/interrupted, 3 neither mode usable / bad usage / protocol error, 124 timeout.

**Fallback rules (enforced by the script):**

- Falls back only when the daemon is unreachable *before* any prompt is submitted. Once a turn has started, a failure is reported as a failure — the script never re-runs the prompt in exec mode (codex may already have side effects).
- `--thread-id` follow-ups never fall back: thread state lives on the daemon, and an exec run would silently start cold. The script exits 3 instead.

## Follow-up turns (stateful sub-agent)

Appserver thread (`thread_id` in meta/stderr):

```bash
python3 .claude/skills/call-codex/scripts/codex_run.py run \
  --thread-id <UUID> --cwd /home/codex/risuai-fastify "Follow-up instruction..."
```

Exec-mode session (`session_id` in meta/stderr) — resume manually; `resume` is a subcommand, exec-level flags go BEFORE it:

```bash
codex exec --yolo --cd /home/codex/risuai-fastify -o <SCRATCHPAD>/codex-out.txt \
  resume <SESSION_ID> "Follow-up instruction..." < /dev/null
```

Prefer an explicit `<SESSION_ID>` over `resume --last` when several codex sessions may interleave.

**Debug/list:** `codex_run.py list [--source-kinds exec] [--limit N]` shows threads as the app sees them (default listing = interactive sources only; daemon required).

## Built-in review

`codex exec review --yolo --cd <DIR>` runs a code review against the repo. Review runs are fine to leave in exec mode directly — they're throwaway and don't need app visibility.

## Long-running tasks

Run via the Bash tool's `run_in_background`, then read the `-o` output file (and `--meta`) when it completes. Pass the prompt as an argument or `--file` — in background mode stdin stays open as a pipe, so the omitted-prompt stdin form blocks forever. The old `codex exec` open-stdin footgun is handled inside the script (the child's stdin is closed), so no `< /dev/null` is needed for `run`.

## Sandbox note

`--sandbox read-only` is broken on this host (bwrap loopback failure: `bwrap: loopback: Failed RTM_NEWADDR`) in both modes. For tasks that must not write, keep the default sandbox, state "do NOT edit any file" in the prompt, and snapshot `git diff | sha256sum` before/after to prove the tree is untouched.

## Guidance

- Give codex a self-contained prompt on turn 1 — it starts cold with no memory of THIS conversation. Include file paths and context. On follow-ups it remembers only its OWN prior turns.
- Full-auto gives codex unrestricted access; use the sandbox-note recipe above for read-only intent.
- After it finishes, summarize what codex did/said — don't just dump raw output. If codex edited files, review the diff before treating it as done.
