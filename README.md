# RisuAI Fastify

[![Svelte](https://img.shields.io/badge/svelte-5-red?logo=svelte)](https://svelte.dev/) [![Typescript](https://img.shields.io/badge/typescript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/) [![Vite](https://img.shields.io/badge/vite-8-%23646CFF?logo=vite)](https://vite.dev/) [![Tailwind CSS](https://img.shields.io/badge/tailwindcss-4-%2306B6D4?logo=tailwindcss)](https://tailwindcss.com/) [![Fastify](https://img.shields.io/badge/fastify-5-black?logo=fastify)](https://fastify.dev/)

A self-hosted, server-backed fork of [RisuAI](https://github.com/kwaroran/RisuAI), re-architected so that a Fastify API server owns durable application data and the browser acts as its client.

> [!IMPORTANT]
> This is an **unofficial fork**. It is not affiliated with, or supported by, the upstream RisuAI project. If you are looking for the original application, use [kwaroran/RisuAI](https://github.com/kwaroran/RisuAI). Please report issues with this fork on [this repository's issue tracker](https://github.com/rhplus0831/risuai-fastify/issues), never to the upstream community.

## Status

This project is under active development for personal use and is **not stable enough for general distribution**. There are no releases, no published Docker image, and no upgrade or data-migration guarantees. Running from source is the only supported path.

## How this fork differs from RisuAI

Upstream RisuAI stores its data inside the browser (or a native app wrapper). This fork moves ownership of all state to a server you host:

- **Server-authoritative data**: a Fastify API server persists everything in SQLite; the browser keeps only a disposable read cache.
- **Password authentication**: the server is designed to be reachable from multiple devices, protected by a password.
- **Single active writer**: one tab/device holds write access at a time, so concurrent sessions cannot silently corrupt state.
- **Server-side generation**: prompt assembly and model requests run on the server, with provider credentials kept server-side and masked in the browser.
- **Server-backed long-term memory**: Hypa V3 memory lives on the server.
- **Server-side Lua scripting**: the Lua scripting surface runs on the server.

Not present in this fork:

- Desktop and mobile (Tauri) builds — this is a web application only.
- Browser-local-only storage mode.
- Google Drive / account sync (the server's database is the single source of truth).
- Plugin API 2.0/2.1 execution. Only Plugin API 3.0 runs in the browser; Lua scripting and modules remain supported extension paths.
- Some text-generation backends: NovelAI, NovelList, WebLLM, plugin-provided providers, and the modern Ooba API (the legacy Ooba API still works). Their models are shown as unsupported.

## Features

Inherited from upstream RisuAI and still applicable:

- **Multiple API Supports**: Supports OpenAI, Claude, Gemini / Vertex AI, AWS Bedrock, OpenRouter, Neuralwatt, Mistral, Cohere, Ollama, DeepInfra, and other OpenAI-compatible endpoints... and More!
- **Emotion Images**: Display the image of the current character, according to his/her expressions!
- **Regex Script**: Modify model's output by regex, to make a custom GUI and others
- **Powerful Translators**: Automatically translate the input/output, so you can roleplay without knowing model's language.
- **Lorebook**: Also known as world infos or memory book, which can make character memorize more.
- **Themes**: Choose it from 3 themes, Classic, WaifuLike, WaifuCut.
- **Powerful Prompting**: Change the prompting order easily, Impersonate inside prompts, Use conditions, variables... and more!
- **Customizable, Friendly UI**: Great Accessibility and mobile friendly
- **TTS**: Use TTS to make the output text into voice.
- **Additional Assets**: Embed your images, audios and videos to bot, and make it display at chat or background!

## Architecture and contributor docs

Start with [`STRUCTURE.md`](STRUCTURE.md) for the current codebase map. It links
to focused backend, data, provider, plugin, asset, client-runtime, UI, and test
guides. Historical reports under `.archived-docs/` record completed work but do
not define current behavior.

## Running from source

### Prerequisites

- Node.js 24+
- pnpm

### Build and serve

Build the web client with the self-host legal flag and serve it through Fastify:

```
pnpm install
pnpm build:site
pnpm api:start
```

The app is then available at `http://localhost:6002`. Data persists in the `data/` directory (override with `RISU_API_DATA_DIR`).

## Development

Run the full stack (Vite dev server plus hot-reloading Fastify API) with one command:

```
pnpm dev:human
```

The app is available at `http://localhost:6002`, with the API on port `6001`.

Alternatively, run the two halves in separate terminals:

```
pnpm api:dev
pnpm dev
```

This serves the Vite dev server at `http://localhost:5174`, proxying `/api/*` requests to the Fastify server at `http://localhost:6002`.

Run the complete quality lane (formatting, typechecks, frontend/server tests, browser smoke test) with:

```
pnpm test:all
```

### Contributing

- Run Prettier (`pnpm format`) before committing.
- Use conventional commit prefixes such as `feat:`, `fix:`, and `refactor:`.

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE), inherited from upstream RisuAI. The original work is copyright Kwaroran and the RisuAI contributors.
