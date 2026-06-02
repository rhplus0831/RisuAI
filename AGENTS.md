# Environment Notes

- Use `pnpm`.
- If port `6002` is already open while an agent-run API server is expected,
  try refreshing the flag-gated dev server with `touch .risu-api-restart`
  before starting another server. The flag is deleted after the restart request
  is consumed.

## Available Tools

- `rg`
- `fd`
- `jq`
- `yq`

# Project Structure Grounding

Start by reading `STRUCTURE.md` to understand the project structure.

# Collaboration Guideline

When writing commit titles, use conventional prefixes such as `feat:`, `fix:`, and `refactor:`.
