'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createRequire, Module } = require('node:module')

// @mlc-ai/web-tokenizers ships a UMD entry in a package marked `type: module`.
// Node's createRequire path works in the server, but ESM-aware test runners can
// still reinterpret that entry as ESM. Compile the same UMD source explicitly
// as CommonJS so its generated `require` and `__filename` references remain
// valid in both environments.
const packageRequire = createRequire(__filename)
const entry = packageRequire.resolve('@mlc-ai/web-tokenizers')
const compiled = new Module(entry, module)
compiled.filename = entry
compiled.paths = Module._nodeModulePaths(path.dirname(entry))
compiled._compile(fs.readFileSync(entry, 'utf8'), entry)

module.exports = compiled.exports
