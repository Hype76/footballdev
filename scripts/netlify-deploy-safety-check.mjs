import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const safeStagingBranch = 'football-os-staging'
const stagingUrl = 'https://football-os-staging.staging.footballplayer.online'
const liveProjectRef = 'hvapkizujvsahvgspser'
const stagingProjectRef = 'llpufwzvgxyczxcjwupu'
const productionBranch = 'main'

function parseArgs(argv) {
  const result = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      continue
    }

    const key = arg.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      result[key] = 'true'
      continue
    }

    result[key] = next
    index += 1
  }

  return result
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function runGit(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

async function listBuildFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return listBuildFiles(absolutePath)
    }

    if (!entry.isFile()) {
      return []
    }

    if (/\.(html|js|css|json|txt|webmanifest)$/i.test(entry.name)) {
      return [absolutePath]
    }

    return []
  }))

  return files.flat()
}

async function scanDistRefs() {
  const distDir = path.resolve('dist')

  try {
    await stat(distDir)
  } catch {
    return {
      exists: false,
      hasLiveRef: false,
      hasStagingRef: false,
    }
  }

  const files = await listBuildFiles(distDir)
  let hasLiveRef = false
  let hasStagingRef = false

  for (const file of files) {
    const content = await readFile(file, 'utf8')
    hasLiveRef ||= content.includes(liveProjectRef)
    hasStagingRef ||= content.includes(stagingProjectRef)
  }

  return {
    exists: true,
    hasLiveRef,
    hasStagingRef,
  }
}

function hasProductionDeployRisk(command) {
  const normalized = command.toLowerCase()
  return normalized.includes('--prod')
    || normalized.includes(' --prod ')
    || normalized.includes('netlify deploy --trigger')
    || normalized.includes('netlify deploy -p')
    || normalized.includes('deploy:live')
}

function printReport(report) {
  console.log('Netlify deploy safety check')
  console.log('')
  console.log(`Current git branch: ${report.currentBranch || 'unknown'}`)
  console.log(`Target branch: ${report.targetBranch || 'unknown'}`)
  console.log(`Netlify site id: ${report.siteId || 'unknown'}`)
  console.log(`Netlify deploy context: ${report.deployContext || 'unknown'}`)
  console.log(`Intended URL or context: ${report.intendedUrl || 'unknown'}`)
  console.log(`Command under review: ${report.command || 'not provided'}`)
  console.log(`Main involved: ${report.mainInvolved ? 'yes' : 'no'}`)
  console.log(`Can trigger production: ${report.canTriggerProduction ? 'yes' : 'no'}`)
  console.log(`Dist folder present: ${report.dist.exists ? 'yes' : 'no'}`)
  console.log(`Staging Supabase ref present in dist: ${report.dist.hasStagingRef ? 'yes' : 'no'}`)
  console.log(`Live Supabase ref present in dist: ${report.dist.hasLiveRef ? 'yes' : 'no'}`)
  console.log('')

  if (report.failures.length > 0) {
    console.error('Deploy safety result: blocked')
    for (const failure of report.failures) {
      console.error(`- ${failure}`)
    }
    return
  }

  console.log('Deploy safety result: allowed for staging preflight')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const currentBranch = runGit(['branch', '--show-current'])
  const targetBranch = args['target-branch'] || process.env.NETLIFY_TARGET_BRANCH || currentBranch
  const deployContext = args.context || process.env.NETLIFY_DEPLOY_CONTEXT || process.env.CONTEXT || ''
  const intendedUrl = args['intended-url'] || process.env.NETLIFY_INTENDED_URL || stagingUrl
  const command = args.command || process.env.NETLIFY_DEPLOY_COMMAND || ''
  const state = readJsonIfExists(path.resolve('.netlify', 'state.json'))
  const siteId = state?.siteId || ''
  const dist = await scanDistRefs()
  const mainInvolved = [currentBranch, targetBranch, deployContext, intendedUrl, command]
    .some((value) => String(value ?? '').toLowerCase().includes(productionBranch))
  const canTriggerProduction = hasProductionDeployRisk(command) || deployContext === 'production' || targetBranch === productionBranch
  const failures = []

  if (!siteId) {
    failures.push('Netlify site id could not be read from .netlify/state.json.')
  }

  if (targetBranch === productionBranch) {
    failures.push('Target branch is main.')
  }

  if (targetBranch !== safeStagingBranch) {
    failures.push(`Target branch must be ${safeStagingBranch} for staging work.`)
  }

  if (!deployContext) {
    failures.push('Netlify deploy context is not proven. Pass --context branch-deploy for staging.')
  }

  if (deployContext === 'production') {
    failures.push('Deploy context is production.')
  }

  if (deployContext && deployContext !== 'branch-deploy' && deployContext !== `branch:${safeStagingBranch}`) {
    failures.push('Deploy context is not an approved staging context.')
  }

  if (mainInvolved) {
    failures.push('The production branch name main is involved in the deploy evidence.')
  }

  if (canTriggerProduction) {
    failures.push('The command or target can trigger production.')
  }

  if (command && !command.includes(safeStagingBranch)) {
    failures.push('Command under review does not include the safe staging branch.')
  }

  if (command && command.toLowerCase().includes('netlify deploy --trigger')) {
    failures.push('Netlify CLI trigger cannot prove target context safely for staging. Use an explicit branch build workflow instead.')
  }

  if (command && command.toLowerCase().includes('--prod')) {
    failures.push('Never use --prod during staging work.')
  }

  if (!dist.exists) {
    failures.push('dist folder is missing. Run npm run build:staging and npm run verify:build-env before staging deploy review.')
  }

  if (dist.hasLiveRef) {
    failures.push(`Live Supabase ref ${liveProjectRef} appears in dist.`)
  }

  if (!dist.hasStagingRef) {
    failures.push(`Staging Supabase ref ${stagingProjectRef} is not proven in dist.`)
  }

  const report = {
    currentBranch,
    targetBranch,
    siteId,
    deployContext,
    intendedUrl,
    command,
    mainInvolved,
    canTriggerProduction,
    dist,
    failures,
  }

  printReport(report)

  if (failures.length > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
