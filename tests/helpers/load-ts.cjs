/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { readFileSync, existsSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
const { createRequire } = require('node:module')
const ts = require('typescript')

function createLoader(mocks = {}) {
  const cache = new Map()
  function load(file) {
    const filename = resolve(file)
    if (Object.hasOwn(mocks, filename)) return mocks[filename]
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const requireHere = createRequire(filename)
    const requireSource = (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id]
      if (id.startsWith('.')) {
        const base = resolve(dirname(filename), id)
        const target = [`${base}.ts`, `${base}/index.ts`].find(existsSync)
        if (target) return load(target)
      }
      return requireHere(id)
    }
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    new Function('require', 'module', 'exports', code)(requireSource, module, module.exports)
    return module.exports
  }
  return load
}

module.exports = { createLoader }
