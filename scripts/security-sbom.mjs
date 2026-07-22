import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const outputDirectory = path.join(process.cwd(), '.security-artifacts')
await mkdir(outputDirectory, { recursive: true })

const npmExecutable = process.env.npm_execpath
const command = npmExecutable ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
const args = npmExecutable
  ? [npmExecutable, 'sbom', '--sbom-format=cyclonedx', '--omit=dev']
  : ['sbom', '--sbom-format=cyclonedx', '--omit=dev']
const result = spawnSync(command, args, {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 25 * 1024 * 1024,
})

if (result.status !== 0) {
  console.error('SBOM generation failed.')
  console.error(String(result.stderr || '').trim())
  process.exit(result.status || 1)
}

const sbom = JSON.parse(result.stdout)
const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(path.join(process.cwd(), 'package-lock.json'), 'utf8'))
const components = sbom.components || (sbom.components = [])
const dependencies = sbom.dependencies || (sbom.dependencies = [])
const componentByNameVersion = new Map(
  components.map((component) => [component.name + '@' + component.version, component]),
)

function packagePurl(name, version) {
  const encodedName = name.startsWith('@')
    ? encodeURIComponent(name.split('/')[0]) + '/' + name.split('/').slice(1).join('/')
    : name
  return 'pkg:npm/' + encodedName + '@' + version
}

function lockedPackage(name) {
  return lock.packages?.['node_modules/' + name]
}

const directProductionRefs = []
for (const name of Object.keys(packageJson.dependencies || {}).sort()) {
  const entry = lockedPackage(name)
  if (!entry?.version) {
    throw new Error('Production SBOM cannot resolve the locked direct dependency: ' + name)
  }

  const key = name + '@' + entry.version
  let component = componentByNameVersion.get(key)
  if (!component) {
    component = {
      'bom-ref': key,
      type: 'library',
      name,
      version: entry.version,
      scope: 'required',
      purl: packagePurl(name, entry.version),
    }
    components.push(component)
    componentByNameVersion.set(key, component)
  }

  directProductionRefs.push(component['bom-ref'])

  if (!dependencies.some((dependency) => dependency.ref === component['bom-ref'])) {
    const childNames = [
      ...Object.keys(entry.dependencies || {}),
      ...Object.keys(entry.optionalDependencies || {}),
    ]
    const dependsOn = childNames
      .map((childName) => {
        const childEntry = lockedPackage(childName)
        return childEntry ? componentByNameVersion.get(childName + '@' + childEntry.version)?.['bom-ref'] : ''
      })
      .filter(Boolean)
      .sort()
    dependencies.push({ ref: component['bom-ref'], dependsOn })
  }
}

const rootRef = sbom.metadata?.component?.['bom-ref']
const rootDependency = dependencies.find((dependency) => dependency.ref === rootRef)
if (!rootDependency) {
  dependencies.push({ ref: rootRef, dependsOn: directProductionRefs })
} else {
  rootDependency.dependsOn = [...new Set([...(rootDependency.dependsOn || []), ...directProductionRefs])].sort()
}

for (const name of Object.keys(packageJson.dependencies || {})) {
  const entry = lockedPackage(name)
  const component = componentByNameVersion.get(name + '@' + entry.version)
  if (!component || component.version !== entry.version) {
    throw new Error('Production SBOM direct dependency mismatch: ' + name)
  }
}

components.sort((left, right) => String(left['bom-ref']).localeCompare(String(right['bom-ref'])))
dependencies.sort((left, right) => String(left.ref).localeCompare(String(right.ref)))
await writeFile(path.join(outputDirectory, 'sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`)
console.log(`SBOM generated with ${(sbom.components || []).length} production components.`)
