# Environment Notes

- Use `pnpm`.

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

* We do not need to worry about DB migrations.
* The `data` folder is only a copied backup brought over from the original Risuai project, and it is acceptable if that data is lost.

# TypeScript Check Workflow

The server tsconfig (`server/fastify/tsconfig.json`) uses `strict: true` and references a client-lib project (`tsconfig.client-lib.json`, `strict: false`) via TypeScript project references. To type-check the server:

```bash
pnpm exec tsc -p tsconfig.client-lib.json              # build client .d.ts (re-run after client src/ changes)
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit  # check server (strict, zero errors)
```

# Language File

When adding strings that appear in the frontend UI, create an appropriate key for them under `src/lang`.