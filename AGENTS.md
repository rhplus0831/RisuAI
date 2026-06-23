# Environment Notes

- Use `pnpm`.

# Agent Dev Server

- Use `pnpm dev:agent` when an agent needs a full-stack development server.
- The frontend is available at `http://localhost:6418`; Fastify runs on port `6419` and is proxied through `/api` on the frontend server.
- `pnpm dev:agent` bypasses password authentication and Terms of Service confirmation for agent-run browser sessions.
- Stop the dev server when you are done using it so ports `6418` and `6419` are released for the next agent.

# Dev Trace Logs

- `pnpm dev:agent` writes API request traces to `data/trace/agent.jsonl`; `pnpm dev:human` writes them to `data/trace/human.jsonl`.
- When tracing is enabled, each response has an `X-Request-UID` header. Use `rg "<uid>" data/trace/*.jsonl` to find the matching JSONL entry.
- Trace entries inline small text bodies; larger captured text bodies are stored as `.gz` sidecars under `data/trace/bodies/<mode>/` when the compressed sidecar is at most 10 MiB.

## Available Tools

- `rg`
- `fd`
- `jq`
- `yq`

# Project Structure Grounding

Start by reading `STRUCTURE.md` to understand the project structure.

# Collaboration Guideline

- Before committing, run Prettier to ensure the formatting is consistent.
- When writing commit titles, use conventional prefixes such as `feat:`, `fix:`, and `refactor:`.

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

# Agent TypeScript Navigation

- Use `pnpm ts:agent --help` for the tsserver-backed debugging wrapper.
- Locations are `file:line:character` with 1-based line and character numbers.
- Prefer `pnpm ts:agent references ...`, `definition ...`, `hover ...`, `diagnostics ...`, and `rename-preview ...` before broad grep-based edits.
- For strict server checks, pass `--project server/fastify/tsconfig.json` to project-wide commands such as `diagnostics`, `workspace-symbols`, and `project-files`.
- Set `RISU_TS_AGENT_TSSERVER_LOG=1` to write a verbose tsserver log under `data/trace/tsserver-agent.log` while debugging the wrapper itself.

# Language File

When adding strings that appear in the frontend UI, create an appropriate key for them under `src/lang`.

# Using Sub-Agents

- If the user gives specific instructions on how to use sub-agents, follow those instructions.
- If the user only refers to the default rules, follow the default rules.
- If the user does not mention sub-agents, or if you do not have access to sub-agent tools, ignore these rules.

## Default Rules

- You act as a manager responsible for coordinating the different sub-agents.
- Use `STRUCTURE.md` and a brief investigation with `rg` to roughly identify which areas need deeper inspection.
- Call an explorer agent (`explorer-type`) to examine the identified areas in detail.
- Based on the exploration results, provide the findings discovered by the explorer agent to an implementation agent (`worker-type`).

  - When doing this, summon the sub-agent with a fresh context.
- Once the task is complete, call a verification agent (`worker-type`) to validate the result.

  - If verification fails, call the implementation agent again to fix the bug.
- After all work is complete, report the result.
