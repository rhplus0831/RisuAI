# Environment Notes

- Use `pnpm`.

# Agent Dev Server

- Use `pnpm dev:agent` when an agent needs a full-stack development server.
- The frontend is available at `http://localhost:6418`; Fastify runs on port `6419` and is proxied through `/api` on the frontend server.
- `pnpm dev:agent` bypasses password authentication and Terms of Service confirmation for agent-run browser sessions.
- Stop the dev server when you are done using it so ports `6418` and `6419` are released for the next agent.

## Available Tools

- `rg`
- `fd`
- `jq`
- `yq`

# Project Structure Grounding

Start by reading `STRUCTURE.md` to understand the project structure.

# Collaboration Guideline

When writing commit titles, use conventional prefixes such as `feat:`, `fix:`, and `refactor:`.

# In Progress

The Fastify variation has not been released yet, so there are currently no real users using it. This means:

- We do not need to worry about DB migrations.
- The `data` folder is only a copied backup brought over from the original Risuai project, and it is acceptable if that data is lost.

# TypeScript Check Workflow

The server tsconfig (`server/fastify/tsconfig.json`) uses `strict: true` and references a client-lib project (`tsconfig.client-lib.json`, `strict: false`) via TypeScript project references. To type-check the server:

```bash
pnpm exec tsc -p tsconfig.client-lib.json              # build client .d.ts (re-run after client src/ changes)
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit  # check server (strict, zero errors)
```

# Language File

When adding strings that appear in the frontend UI, create an appropriate key for them under `src/lang`.
