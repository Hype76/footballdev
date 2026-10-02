import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const auditRoots = ['brace-expansion', 'image-size', 'js-yaml', 'node-forge', 'undici']

export function sourcePaths(map) {
  if (Array.isArray(map.sections)) {
    if (map.sections.length === 0) throw new Error('Source map has no module inventory')
    return map.sections.flatMap(({ map: child }) => sourcePaths(child))
  }
  if (!Array.isArray(map.sources) || map.sources.length === 0) throw new Error('Source map has no module inventory')
  return map.sources.map((source) => `${map.sourceRoot || ''}/${source}`.replaceAll('\\', '/'))
}

export function packageName(source) {
  const remainder = source.split('/node_modules/').at(-1)
  if (remainder === source) return null
  const parts = remainder.split('/')
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function files(path) {
  return readdirSync(path).flatMap((name) => {
    const item = resolve(path, name)
    return statSync(item).isDirectory() ? files(item) : [item]
  })
}

export function inventory(exportRoot) {
  const root = resolve(exportRoot)
  const maps = files(root).filter((path) => path.endsWith('.map'))
  if (maps.length === 0) throw new Error(`No source maps in ${root}; export with --source-maps`)
  return maps.map((path) => {
    const bytes = readFileSync(path)
    const sources = [...new Set(sourcePaths(JSON.parse(bytes)))].sort()
    const modules = sources.map((source) => {
      const marker = source.lastIndexOf('/node_modules/')
      return marker >= 0 ? source.slice(marker + 1) : source.slice(source.indexOf('/apps/') + 1)
    })
    const packages = [...new Set(sources.map(packageName).filter(Boolean))].sort()
    const bundle = path.slice(0, -4)
    return {
      sourceMap: relative(root, path).replaceAll('\\', '/'),
      sourceMapSha256: createHash('sha256').update(bytes).digest('hex'),
      bundleSha256: existsSync(bundle) ? createHash('sha256').update(readFileSync(bundle)).digest('hex') : null,
      moduleCount: sources.length,
      packages,
      roots: Object.fromEntries(auditRoots.map((name) => [name, { shipped: packages.includes(name), modules: sources.filter((source) => packageName(source) === name).map((source) => source.slice(source.lastIndexOf('/node_modules/') + 1)) }])),
      modules,
    }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [exportRoot, output] = process.argv.slice(2)
  if (!exportRoot || !output) throw new Error('Usage: node apps/scripts/mobile-security-inventory.mjs <export-directory> <output.json>')
  const result = { scope: 'Exported JavaScript module membership only; does not establish native, publisher or handset safety.', artifacts: inventory(exportRoot) }
  writeFileSync(resolve(output), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result.artifacts.map(({ sourceMap, moduleCount, roots }) => ({ sourceMap, moduleCount, roots })), null, 2))
}
