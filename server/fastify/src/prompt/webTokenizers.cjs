'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createRequire, Module } = require('node:module')

// @mlc-ai/web-tokenizers ships a UMD entry in a package marked `type: module`.
// Node's createRequire path works in the server, but ESM-aware test runners can
// still reinterpret that entry as ESM. Compile the same UMD source explicitly
// as CommonJS so its generated `require` and `__filename` references remain
// valid in both environments.
// Vite's browser-conditioned test transform can synthesize an HTTP
// `__filename`; anchor resolution to the repository package instead. The
// server already requires process.cwd() to be the repository root for its
// tokenizer assets.
const packageRequire = createRequire(path.join(process.cwd(), 'package.json'))
const entry = packageRequire.resolve('@mlc-ai/web-tokenizers')
const compiled = new Module(entry, module)
compiled.filename = entry
compiled.paths = Module._nodeModulePaths(path.dirname(entry))
// This is the Node adapter even when a browser-like test environment has
// installed happy-dom globals. Shadow those globals so Emscripten builds its
// internal createRequire() base from the real module filename.
const source = `const document = undefined; const location = undefined;\n${fs.readFileSync(entry, 'utf8')}`
compiled._compile(source, entry)

module.exports = compiled.exports
