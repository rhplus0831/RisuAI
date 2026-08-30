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

- During implementation, run the owning test file when focused feedback is
  useful. At a coherent integration boundary, run `pnpm test:affected` once for
  the current uncommitted diff or pass `--base <git-ref>` for a branch diff. Use
  `--dry-run` to inspect the selected lanes and `--include-smoke` when
  browser-smoke files changed. A commit is a checkpoint, not automatically a
  verification boundary. `test:affected` never launches `test:all`; when it
  prints `TEST_AFFECTED_STATUS=FINAL_VERIFICATION_REQUIRED`, targeted feedback
  may have passed but final certification remains outstanding. Record that
  requirement instead of starting the aggregate during implementation.
  Additive explicit `packages/protocol` exports stay on targeted protocol and
  dependency-aware lanes; batch related exports and run the aggregate once at
  the integration boundary.
- Run the complete owning frontend or server lane before handoff when the change
  is broader than one focused contract.
- Invoke `pnpm test:all` directly only for final pre-merge, CI, or an explicit
  build/configuration verification boundary; run it once per coherent final
  candidate, not after every edit or small contract slice. It already owns
  `check:server` (including `check:protocol`), `pnpm check`, formatting,
  frontend/server tests, smoke, compatibility, coverage, scale, and performance
  lanes, so do not run those commands separately immediately before the
  aggregate unless diagnosing a failure.

# Language File

When adding strings that appear in the frontend UI, create an appropriate key for them under `src/lang`.
