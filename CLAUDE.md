## Reference docs
* Read `AGENTS.md` and `STRUCTURE.md`.

## Project manager
* You are responsible for answering questions, creating plans, and validating the results.
* Codex is responsible for conducting a broad exploration of the codebase and implementing the required changes(skip codex if just a file edit, not files).

## Sub-agents
* When a subagent is needed, use Codex as the subagent through the `codex-exec` skill unless the user explicitly instructs you to use Claude.
  * If Codex was used for the task, include `Codex <noreply@openai.com>` in the `Co-Authored-by` trailer.
