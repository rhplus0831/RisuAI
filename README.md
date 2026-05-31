# Risuai

<picture>
  <img alt="text" src="https://raw.githubusercontent.com/kwaroran/Risuai/refs/heads/main/public/logo_typo_small.avif" width="400"/>
</picture>

[![Svelte](https://img.shields.io/badge/svelte-5-red?logo=svelte)](https://svelte.dev/) [![Typescript](https://img.shields.io/badge/typescript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/) [![Vite](https://img.shields.io/badge/vite-8-%23646CFF?logo=vite)](https://vite.dev/) [![Tailwind CSS](https://img.shields.io/badge/tailwindcss-4-%2306B6D4?logo=tailwindcss)](https://tailwindcss.com/)

Risuai, or Risu for short, is a Fastify-served AI chat web application with powerful features such as multiple API support, assets in the chat, regex functions and much more.

# Screenshots

|         Screenshot 1         |         Screenshot 2         |
| :--------------------------: | :--------------------------: |
| ![Screenshot 1][screenshot1] | ![Screenshot 2][screenshot2] |
| ![Screenshot 3][screenshot3] | ![Screenshot 4][screenshot4] |

[screenshot1]: https://github.com/kwaroran/Risuai/assets/116663078/cccb9b33-5dbd-47d7-9c85-61464790aafe
[screenshot2]: https://github.com/kwaroran/Risuai/assets/116663078/30d29f85-1380-4c73-9b82-1a40f2c5d2ea
[screenshot3]: https://github.com/kwaroran/Risuai/assets/116663078/faad0de5-56f3-4176-b38e-61c2d3a8698e
[screenshot4]: https://github.com/kwaroran/Risuai/assets/116663078/ef946882-2311-43e7-81e7-5ca2d484fa90

## Features

- **Multiple API Supports**: Supports OpenAI, Claude, Gemini, DeepInfra, Ooba, OpenRouter... and More!
- **Emotion Images**: Display the image of the current character, according to his/her expressions!
- **Plugins**: Add your features and providers, and simply share.
- **Regex Script**: Modify model's output by regex, to make a custom GUI and others
- **Powerful Translators**: Automatically translate the input/output, so you can roleplay without knowing model's language.
- **Lorebook**: Also known as world infos or memory book, which can make character memorize more.
- **Themes**: Choose it from 3 themes, Classic, WaifuLike, WaifuCut.
- **Powerful Prompting**: Change the prompting order easily, Impersonate inside prompts, Use conditions, variables... and more!
- **Customizable, Friendly UI**: Great Accessibility and mobile friendly
- **TTS**: Use TTS to make the output text into voice.
- **Additional Assets**: Embed your images, audios and videos to bot, and make it display at chat or background!
- **Long-term Memory**: Server-backed Hypa V3 memory for maintaining long-term conversation context.
- And More!

You can get detailed information on https://github.com/kwaroran/Risuai/wiki (Work in Progress)

## Community

- [Discord Server](https://discord.gg/JzP8tB9ZK8)

## Installation

- [Risuai Website](https://risuai.net) (Recommended)
- [Github Releases](https://github.com/kwaroran/Risuai/releases)

### Development prerequisites

- Node.js 24+
- pnpm

### Development

Run the Fastify API server and the Vite client in separate terminals:

```
pnpm api:dev
pnpm dev
```

The Vite dev server proxies `/api/*` requests to the Fastify server at `http://localhost:6002`.

To build the web client with the self-host legal flag and serve it through Fastify:

```
pnpm buildsite
pnpm api:start
```

Run the browser smoke test with:

```
pnpm smoke:fastify-browser
```

### Docker Installation

You can also run Risuai using Docker. The container builds the web client, starts Fastify with `pnpm api:start`, serves the API and static client on port `6002`, and persists data in `/app/data`.

1. Run the Docker container:

   ```
   curl -L https://raw.githubusercontent.com/kwaroran/Risuai/refs/heads/main/docker-compose.yml | docker compose -f - up -d
   ```

2. Access Risuai at `http://localhost:6002` in your web browser.
