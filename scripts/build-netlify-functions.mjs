import { readFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { zipFunctions } from '@netlify/zip-it-and-ship-it'
import toml from 'toml'

// Use Netlify's production bundler directly. The full CLI also installs a local
// image/dev-server stack with an unpatched node-forge dependency.
const root = process.cwd()
const { functions } = toml.parse(await readFile(path.join(root, 'netlify.toml'), 'utf8'))
const destination = path.join(root, '.netlify', 'functions-internal')
const config = {}

function bundlerConfig(value) {
  return {
    nodeBundler: value.node_bundler === 'esbuild' ? 'esbuild_zisi' : value.node_bundler,
    externalNodeModules: value.external_node_modules,
    includedFiles: value.included_files,
    includedFilesBasePath: root,
    ignoredNodeModules: value.ignored_node_modules,
    schedule: value.schedule,
    nodeVersion: '22',
    processDynamicNodeImports: true,
    zipGo: true,
  }
}

config['*'] = bundlerConfig(functions)
for (const [name, value] of Object.entries(functions)) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    config[name] = bundlerConfig({ ...functions, ...value })
  }
}

// A stale archive must never masquerade as a function built from this checkout.
await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })
const built = await zipFunctions(path.resolve(root, functions.directory), destination, {
  basePath: root,
  config,
  manifest: path.join(destination, 'manifest.json'),
})
console.log(`Built ${built.length} Netlify functions with the official bundler.`)
