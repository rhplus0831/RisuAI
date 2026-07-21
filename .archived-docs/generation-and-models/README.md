# Generation And Models Archive

Historical generation lifecycle, model configuration, prompt ownership,
translation, and auxiliary-agent workstreams.

| Record                                                                          | Scope                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`durable-generation/`](durable-generation/README.md)                           | Client-independent in-process generation jobs, persistence, reattach, and cancel.                |
| [`chat-scoped-generation-settings/`](chat-scoped-generation-settings/README.md) | Chat-owned persona, preset, jailbreak, and sidebar generation settings.                          |
| [`agent-presets/`](agent-presets/README.md)                                     | Agent Preset schema, authoring UI, execution, diagnostics, and legacy Context Agent removal.     |
| [`agent-presets/product-qa.md`](agent-presets/product-qa.md)                    | Original Agent Preset product-alignment Q&A retained beside the completed plan.                  |
| [`model-config-profiles/`](model-config-profiles/README.md)                     | Model-profile persistence, resolution, provider dispatch, and the earlier split-bot-preset plan. |
| [`model-profile-authoring-ui/`](model-profile-authoring-ui/README.md)           | Full profile authoring UI and its detailed decision log.                                         |
| [`prompt-template-ownership/`](prompt-template-ownership/README.md)             | Prompt-preset ownership, projection, compatibility, and cleanup.                                 |
| [`chat-generation-debug-logging.md`](chat-generation-debug-logging.md)          | Explored scope for chat-generation observability and debug logging.                              |
| [`translation-workstreams-2026-07-20-to-21.md`](translation-workstreams-2026-07-20-to-21.md) | Per-chat translation, pass-through LLM input, bilingual rendering, disconnected completion, and multi-step pipeline decisions. |

Product Q&A and decision logs stay separate from implementation plans because
they preserve the reasoning inputs rather than duplicate phase/status content.
