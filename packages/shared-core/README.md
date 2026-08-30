# `@risuai/shared-core`

Browser/Node-neutral value algorithms shared by the RisuAI client and Fastify
server.

Runtime modules may use only ECMAScript value operations and reviewed modules
inside this package. They must not import protocol schemas, browser stores,
Svelte/DOM APIs, Fastify, Node built-ins, filesystem/process globals,
credentials, persistence, or aggregate application state. Serialized contracts
belong in `@risuai/protocol`; runtime-specific policy remains with its runtime.
