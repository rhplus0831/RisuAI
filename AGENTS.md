# Environment Notes

- Use `pnpm`.

# Dev Server

- Use `pnpm dev:agent` when you need a full-stack development server.
- For an agent-controlled API server that does not restart on every source edit, run `pnpm api:dev:flag` instead of `pnpm api:dev`. It restarts only when `.risu-api-restart` is created or touched (`touch .risu-api-restart`), then deletes that flag after the restart request is consumed.
- The frontend is available at `http://localhost:6418`; Fastify runs on port `6419` and is proxied through `/api` on the frontend server.
- `pnpm dev:agent` bypasses password authentication and RisuRealm terms confirmation for agent-run browser sessions.
- `pnpm dev:agent` runs against a disposable `data-agent/` sandbox and cannot
  mutate the human database. Its default `clone` mode takes an online SQLite
  snapshot and links or copies `assets/` and `save/`, while intentionally
  omitting auth files, backups, traces, and Web Push keys. Set
  `RISU_AGENT_DATA_MODE=keep` to reuse the sandbox or
  `RISU_AGENT_DATA_MODE=fresh` to start empty.
- Stop the dev server when you are done using it.

# Dev Trace Logs

- `pnpm dev:agent` writes API request traces to `data-agent/trace/agent.jsonl`; `pnpm dev:human` writes them to `data/trace/human.jsonl`. Each mode keeps the newest 5,000 trace entries and trims older entries.
- When tracing is enabled, each response has an `X-Request-UID` header. Use `rg "<uid>" data-agent/trace/*.jsonl` (or `data/trace/*.jsonl` for human mode) to find the matching JSONL entry.
- Trace entries inline small text bodies; larger captured text bodies are stored as `.gz` sidecars under `trace/bodies/<mode>/` inside the same data directory when the compressed sidecar is at most 10 MiB.

# Search Hygiene

- The root `.ignore` file excludes tracked static/vendor payloads from broad
  file and text searches.
- For initial file-name searches, prefer `rg --files | rg "<name>"` or
  `fd <name>` so `.ignore` is honored. Use `--no-ignore` or a targeted path
  only when intentionally inspecting ignored payloads.
- Avoid broad `rg --files -g "*<name>*"` searches because explicit include globs
  can re-include ignored payloads.

# Project Structure Grounding

Start by reading `STRUCTURE.md` to understand the project structure.

# Collaboration Guideline

- Before committing, run Prettier to ensure the formatting is consistent.
- When writing commit titles, use conventional prefixes such as `feat:`, `fix:`, and `refactor:`.
- Describe what you did in the commit message.

# Test Workflow

- When a background affected-test watcher is expected, call
  `pnpm test:watch:await` before starting `pnpm check` or
  `pnpm test:affected`. A zero exit means its passing Svelte-check and affected
  test results are live, match the exact current worktree fingerprint, and may
  be used instead of rerunning those two commands. A one exit is a fresh watched
  failure; inspect `.test-watch/latest.log` and fix it rather than rerunning
  merely to reproduce it. A two exit is still pending or timed out; keep waiting
  or inspect `pnpm test:watch:status`, but do not duplicate the active test run.
  A three exit means the supervisor is unavailable or incompatible, so restart
  `pnpm test:watch:agent` in the task terminal or use the normal command.
  Never trust `.test-watch/status.json` or `.test-watch/supervisor.json` without
  a validating watcher command.
- A watched result substitutes for `pnpm check` and only the affected-test scope
  recorded in its status. Continue to follow any reported smoke/compatibility
  notes and the broader owning-lane or handoff rules below. Start the watcher in
  the task's integrated terminal with `pnpm test:watch:agent`; add
  `--include-smoke` only when automatic browser-smoke reruns are desired, and
  stop it when the task is done. When the watcher uses a non-default `--base`,
  pass the same base to the await or status command; pass `--include-smoke` to
  either command when that coverage is required. `pnpm test:watch:status` is
  the non-blocking diagnostic view; `pnpm test:watch:await` is the handoff gate.
- During implementation, prefer `pnpm test:affected` for the current uncommitted
  diff or pass `--base <git-ref>` for a branch diff. Use `--dry-run` to inspect
  the selected lanes and `--include-smoke` when browser-smoke files changed.
- When the owning test file is known, running that file directly is the fastest
  feedback loop. Run the complete owning frontend or server lane before handoff
  when the change is broader than one focused contract.
- Reserve `pnpm test:all` for build/configuration changes and final pre-merge or
  CI verification; do not run it after every edit.

# Language File

When adding strings that appear in the frontend UI, create an appropriate key for them under `src/lang`.
