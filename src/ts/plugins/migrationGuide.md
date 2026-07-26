# Plugin 2.0/2.1 to 3.0 migration guide

Last audited: 2026-07-23.

Plugin API 3.0 is the supported target for new plugins. This guide describes
the migration decisions that are specific to the current Fastify-backed fork.
The complete, current API signatures and examples live in
[`apiV3/risuai.d.ts`](apiV3/risuai.d.ts); do not copy an API inventory into this
guide.

## Runtime status

| API                  | Current behavior                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `2.0` or no `//@api` | Import and server persistence are rejected with an unsupported-version error.                                     |
| `2.1`                | Import and server persistence are rejected with an unsupported-version error; there is no compatibility runtime. |
| `3.0`                | Supported. Runs through the iframe/RPC host after an exact-script `v3Runtime` grant. Hot reload is available.     |

The importer reads supported versions from left to right and selects the first
match. Do not publish a declaration such as `//@api 2.0 2.1 3.0`: it selects
`2.0` and the import is rejected. A migrated plugin should declare only:

```javascript
//@api 3.0
```

Migrate maintained plugins to 3.0 before importing them.

## Required metadata

Put metadata comments at the top of the source. `//@name` is required and is the
stable plugin identity.

```javascript
//@name example_plugin
//@display-name Example Plugin
//@api 3.0
//@version 1.0.0
//@arg greeting string
//@link https://example.com/docs Documentation
//@update-url https://example.com/example-plugin.js
```

Relevant rules:

- `//@link` and `//@update-url` must use HTTPS.
- An update URL requires `//@version`; the version declaration must end within
  the first 512 bytes so the bounded update probe can read it.
- Arguments use `int` or `string`. See the declaration header for supported
  argument metadata.
- TypeScript imports are transpiled, but only API 3.0 plugins can use development
  hot reload.

## Migration checklist

### Use the asynchronous API object

API 3.0 exposes `window.risuai` with `window.Risuai` as an alias. Host API
methods cross the RPC boundary and generally return promises. Use `await` and
follow `apiV3/risuai.d.ts` when a wrapper has its own async shape.

```javascript
// 2.1
const character = getChar()
setChar({ ...character, name: 'Updated' })

// 3.0
const character = await risuai.getCharacter()
await risuai.setCharacter({ ...character, name: 'Updated' })
```

Prefer the 3.0 names `getCharacter`, `setCharacter`, `getArgument`, and
`setArgument` over the retained `getChar`, `setChar`, `getArg`, and `setArg`
aliases.

### Keep plugin UI inside the guest frame

The plugin's own `document` is the guest-frame document and supports normal DOM
APIs. Use `showContainer('fullscreen')` and `hideContainer()` to present that
UI. Register stable entry points with `registerSetting` or `registerButton`.

```javascript
await risuai.registerSetting(
  'Example settings',
  async () => {
    document.body.textContent = 'Example plugin settings'
    await risuai.showContainer('fullscreen')
  },
  '⚙️',
  'html',
  'example-settings',
)
```

Only use `await risuai.getRootDocument()` when the plugin truly must interact
with the main RisuAI document. It returns RPC-backed `SafeDocument` and
`SafeElement` wrappers, not native DOM objects. Their methods, event listener
IDs, allowed elements/attributes/styles, and return types are defined in
`apiV3/risuai.d.ts`.

### Move persistence to plugin storage

`risuai.pluginStorage` is JSON storage backed by the server and is the default
for plugin-owned durable data.

```javascript
await risuai.pluginStorage.setItem('settings', { enabled: true })
const settings = await risuai.pluginStorage.getItem('settings')
```

Device-local storage is compatibility state. In Fastify mode it is disabled
unless `pluginCompatibilityMode` is enabled and it is not part of the
authoritative application database or backups.

Broad `getDatabase`/`setDatabase*` compatibility calls expose only supported
subsets. Character, chat, module, settings, and plugin writes are validated and
command-backed; unsupported fields reject instead of being silently shadowed.
Use focused API methods wherever one exists.

### Replace network access

Use `risuai.nativeFetch`. It requires a script-bound `network` grant and routes
through the authenticated public-only plugin proxy. Private, loopback,
link-local, metadata, and RisuAI service targets are rejected, and every
redirect hop is revalidated. `risuFetch` is deprecated.

`saveSecretHeader` is currently a warning-only placeholder and does not persist
a secret. Do not build a plugin that depends on it.

### Register and clean up runtime extensions

API 3.0 can register settings rows, action/chat/hamburger buttons, MCP clients,
TTS preprocessors/postprocessors, script handlers, replacers, and body
interceptors. Await registration and retain returned IDs when the API supplies
one. The host removes owned registrations when the plugin unloads; unregister
explicitly when a feature must disappear earlier, and use `risuai.onUnload` for
plugin-owned resources outside those registries.

Plugin-provided model providers are browser compatibility surfaces. Fastify
chat generation does not execute them. V2 edit/replacer hooks can also make a
request ineligible for server prompt assembly; do not assume that every legacy
generation extension has a server-backed equivalent.

## Security boundary

API 3.0 runs in an opaque-origin guest iframe nested inside a restrictive guard
frame. Main-document access is wrapped, network-capable UI markup is filtered,
and helper fetches use the consent-gated public proxy. These are meaningful
reductions in ambient authority, but the DOM-compatible guest is not a hostile
code network sandbox. Browser APIs such as WebRTC may still provide egress.
Only grant `v3Runtime` to code you fully trust.

Every runtime, network, update, provider, database, DOM, send-chat, and related
capability grant is bound to the plugin name and exact script hash. Updating the
source requires new approval for the changed script.

## Minimal API 3.0 skeleton

```javascript
//@name example_plugin
//@display-name Example Plugin
//@api 3.0
//@version 1.0.0
//@arg greeting string

;(async () => {
  const greeting = (await risuai.getArgument('greeting')) || 'Hello'
  await risuai.pluginStorage.setItem('lastGreeting', greeting)

  await risuai.registerButton(
    {
      name: 'Example action',
      icon: '✨',
      iconType: 'html',
      location: 'action',
      id: 'example-action',
    },
    async () => {
      document.body.textContent = greeting
      await risuai.showContainer('fullscreen')
    },
  )
})()
```

For implementation and security details, use these owners:

- `plugins.svelte.ts`: V3-only metadata parsing, import, and load policy;
- `apiV3/risuai.d.ts`: public API contract;
- `apiV3/factory.ts` and `apiV3/v3.svelte.ts`: guest/RPC lifecycle and host API;
- `pluginPermissions.ts` and `pluginNetworkAccess.ts`: exact-script grants and
  network policy;
- `unsupportedServerWriteGuard.ts`: Fastify-mode write restrictions.
