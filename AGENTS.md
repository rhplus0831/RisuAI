# Environment Notes

- Use `pnpm`.

# Dev Server

- Use `pnpm dev:agent` when you need a full-stack development server.
- The frontend is available at `http://localhost:6418`; Fastify runs on port `6419` and is proxied through `/api` on the frontend server.
- `pnpm dev:agent` bypasses password authentication and Terms of Service confirmation for agent-run browser sessions.
- Stop the dev server when you are done using it.

# Dev Trace Logs

- `pnpm dev:agent` writes API request traces to `data/trace/agent.jsonl`; `pnpm dev:human` writes them to `data/trace/human.jsonl`. Each mode keeps the newest 5,000 trace entries and trims older entries.
- When tracing is enabled, each response has an `X-Request-UID` header. Use `rg "<uid>" data/trace/*.jsonl` to find the matching JSONL entry.
- Trace entries inline small text bodies; larger captured text bodies are stored as `.gz` sidecars under `data/trace/bodies/<mode>/` when the compressed sidecar is at most 10 MiB.

## Available Tools

- `rg`
- `fd`
- `jq`
- `yq`

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

# Language File

When adding strings that appear in the frontend UI, create an appropriate key for them under `src/lang`.

# Plain Risuai Code

There is the original app code from before it was changed to Fastify in `/home/codex/Risuai`. Use it when needed.
