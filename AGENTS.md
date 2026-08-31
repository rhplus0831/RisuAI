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

- The user and CI own periodic full-suite execution and result review. At
  handoff, report the focused `pnpm test -- <file>` command that ran, or state
  that no tests were run. Do not start broader verification on the user's
  behalf.

# Language File

When adding strings that appear in the frontend UI, create an appropriate key for them under `src/lang`.
