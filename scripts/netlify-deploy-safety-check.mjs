import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const safeStagingBranch = 'football-os-staging'
const approvedStagingBranches = new Set([safeStagingBranch, 'parent-staging'])
const stagingUrl = 'https://football-os-staging.staging.footballplayer.online'
export const liveProjectRef = 'hvapkizujvsahvgspser'
export const legacyStagingProjectRef = 'llpufwzvgxyczxcjwupu'
const productionBranch = 'main'
const approvedModes = ['deploy', 'local-live', 'production-prep']

export function parseArgs(argv) {
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
      hasLegacyStagingRef: false,
    }
  }

  const files = await listBuildFiles(distDir)
  let hasLiveRef = false
  let hasLegacyStagingRef = false

  for (const file of files) {
    const content = await readFile(file, 'utf8')
    hasLiveRef ||= content.includes(liveProjectRef)
    hasLegacyStagingRef ||= content.includes(legacyStagingProjectRef)
  }

  return {
    exists: true,
    hasLiveRef,
    hasLegacyStagingRef,
  }
}

function scanPilotPreservation() {
  const checks = [
    {
      label: 'Pilot canonical plan preserved',
      path: 'src/lib/plans.js',
      pattern: /pilot: 'pilot'[\s\S]*getAdminAssignablePlanOptions[\s\S]*getPublicPlanOptions/,
    },
    {
      label: 'Pilot admin assignment preserved',
      path: 'src/components/platform/ManageClubsSection.jsx',
      pattern: /getAdminAssignablePlanOptions[\s\S]*PLAN_KEYS\.pilot/,
    },
    {
      label: 'Pilot existing-club admin assignment preserved',
      path: 'src/components/platform/PlatformAccountManagementSection.jsx',
      pattern: /getAdminAssignablePlanOptions[\s\S]*Pilot access is always free\./,
    },
    {
      label: 'Pilot new-club flow forces unpaid access',
      path: 'src/pages/PlatformAdminPage.jsx',
      pattern: /fieldName === 'planKey' && value === PLAN_KEYS\.pilot[\s\S]*billingMode: 'unpaid'/,
    },
    {
      label: 'Pilot public pricing exclusion preserved',
      path: 'src/lib/login-pricing.js',
      pattern: /PLAN_KEYS\.individual[\s\S]*PLAN_KEYS\.largeClub/,
      negativePattern: /PLAN_KEYS\.pilot/,
    },
    {
      label: 'Pilot checkout rejection preserved',
      path: 'netlify/functions/lib/_stripe-billing.js',
      pattern: /Pilot: 'pilot'[\s\S]*SELF_SERVICE_CHECKOUT_PLAN_KEYS = new Set\(\[[\s\S]*development_club[\s\S]*\]\)/,
      negativePattern: /SELF_SERVICE_CHECKOUT_PLAN_KEYS = new Set\(\[[\s\S]*pilot[\s\S]*\]\)/,
    },
    {
      label: 'Pilot create-club free guard preserved',
      path: 'netlify/functions/platform-create-club.js',
      pattern: /billingMode === 'paid' && planKey === 'pilot'[\s\S]*billingMode === 'unpaid' \|\| planKey === 'pilot'/,
    },
    {
      label: 'Pilot update-club free guard preserved',
      path: 'netlify/functions/update-platform-club-billing.js',
      pattern: /const nextPlanStatus = nextPlanKey === 'pilot' \? 'active' : requestedPlanStatus[\s\S]*const nextIsPlanComped = nextPlanKey === 'pilot'/,
    },
  ]

  const failures = []

  for (const check of checks) {
    let content = ''

    try {
      content = readFileSync(path.resolve(check.path), 'utf8')
    } catch {
      failures.push(`${check.label}: ${check.path} is missing.`)
      continue
    }

    if (!check.pattern.test(content)) {
      failures.push(`${check.label}: expected preservation marker was not found.`)
    }

    if (check.negativePattern?.test(content)) {
      failures.push(`${check.label}: forbidden Pilot public or checkout marker was found.`)
    }
  }

  return {
    checked: true,
    failures,
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

function hasDeployCommandRisk(command) {
  const normalized = String(command ?? '').toLowerCase()
  return normalized.includes('netlify deploy')
    || normalized.includes('deploy:live')
    || normalized.includes('npm run deploy')
}

function hasDatabaseMutationRisk(command) {
  const normalized = String(command ?? '').toLowerCase()
  return normalized.includes('supabase db push')
    || normalized.includes('supabase migration')
    || normalized.includes('apply_migration')
    || normalized.includes('execute_sql')
    || normalized.includes('db reset')
}

function normalizeMode(value) {
  const normalizedValue = String(value ?? '').trim()
  return approvedModes.includes(normalizedValue) ? normalizedValue : 'deploy'
}

function hasAnySupabaseRef(dist) {
  return dist.hasLiveRef || dist.hasLegacyStagingRef
}

export function evaluateSafety({
  currentBranch = '',
  targetBranch = '',
  deployContext = '',
  intendedUrl = '',
  command = '',
  siteId = '',
  dist = { exists: false, hasLiveRef: false, hasLegacyStagingRef: false },
  expectedSupabaseRef = '',
  mode = 'deploy',
  pilot = { checked: false, failures: [] },
} = {}) {
  const safeMode = normalizeMode(mode)
  const mainInvolved = [currentBranch, targetBranch, deployContext, intendedUrl, command]
    .some((value) => String(value ?? '').toLowerCase().includes(productionBranch))
  const canTriggerProduction = hasProductionDeployRisk(command) || deployContext === 'production' || targetBranch === productionBranch
  const failures = []

  if (!dist.exists) {
    failures.push('dist folder is missing. Run the relevant web build before safety validation.')
  }

  if (dist.hasLiveRef && dist.hasLegacyStagingRef) {
    failures.push('Both live and legacy staging Supabase refs appear in dist.')
  }

  if (dist.exists && !hasAnySupabaseRef(dist)) {
    failures.push('No known Supabase ref was identified in dist.')
  }

  if (pilot.checked && pilot.failures.length > 0) {
    failures.push(...pilot.failures.map((failure) => `Pilot preservation check failed. ${failure}`))
  }

  if (safeMode === 'local-live') {
    if (command) {
      failures.push('Local live validation mode must not review or run a deploy command.')
    }

    if (deployContext) {
      failures.push('Local live validation mode must not set a Netlify deploy context.')
    }

    if (targetBranch && targetBranch !== currentBranch) {
      failures.push('Local live validation mode must not target a different branch.')
    }

    if (hasDeployCommandRisk(command)) {
      failures.push('Local live validation mode cannot include a deploy command.')
    }

    if (hasDatabaseMutationRisk(command)) {
      failures.push('Local live validation mode cannot include database mutation commands.')
    }

    if (!dist.hasLiveRef) {
      failures.push(`Local live validation mode requires live Supabase ref ${liveProjectRef} in dist.`)
    }

    if (dist.hasLegacyStagingRef) {
      failures.push(`Local live validation mode must not use legacy staging Supabase ref ${legacyStagingProjectRef}.`)
    }

    return {
      canTriggerProduction,
      failures,
      mainInvolved,
      mode: safeMode,
    }
  }

  if (!expectedSupabaseRef) {
    failures.push('Real deploy safety checks require --expected-supabase-ref.')
  }

  if (expectedSupabaseRef && expectedSupabaseRef !== liveProjectRef && expectedSupabaseRef !== legacyStagingProjectRef) {
    failures.push('Expected Supabase ref is not one of the known project refs for this repo.')
  }

  if (expectedSupabaseRef === liveProjectRef && !dist.hasLiveRef) {
    failures.push(`Expected Supabase ref ${liveProjectRef} is not proven in dist.`)
  }

  if (expectedSupabaseRef === legacyStagingProjectRef && !dist.hasLegacyStagingRef) {
    failures.push(`Expected Supabase ref ${legacyStagingProjectRef} is not proven in dist.`)
  }

  if (expectedSupabaseRef === liveProjectRef && dist.hasLegacyStagingRef) {
    failures.push('Unexpected legacy staging Supabase ref appears in a live-target build.')
  }

  if (expectedSupabaseRef === legacyStagingProjectRef && dist.hasLiveRef) {
    failures.push('Unexpected live Supabase ref appears in a staging-target build.')
  }

  if (!siteId) {
    failures.push('Netlify site id could not be read from .netlify/state.json.')
  }

  if (safeMode === 'production-prep') {
    if (expectedSupabaseRef !== liveProjectRef) {
      failures.push(`Production prep requires expected Supabase ref ${liveProjectRef}.`)
    }

    if (!command) {
      failures.push('Production prep requires the exact deploy command to be reviewed.')
    }

    if (!canTriggerProduction) {
      failures.push('Production prep did not prove that the reviewed command targets production.')
    }

    return {
      canTriggerProduction,
      failures,
      mainInvolved,
      mode: safeMode,
    }
  }

  if (targetBranch === productionBranch) {
    failures.push('Target branch is main.')
  }

  if (!approvedStagingBranches.has(targetBranch)) {
    failures.push(`Target branch must be one of ${Array.from(approvedStagingBranches).join(', ')} for staging work.`)
  }

  if (!deployContext) {
    failures.push('Netlify deploy context is not proven. Pass --context branch-deploy for staging.')
  }

  if (deployContext === 'production') {
    failures.push('Deploy context is production.')
  }

  const approvedBranchContext = approvedStagingBranches.has(String(deployContext).replace(/^branch:/, ''))

  if (deployContext && deployContext !== 'branch-deploy' && !approvedBranchContext) {
    failures.push('Deploy context is not an approved staging context.')
  }

  if (mainInvolved) {
    failures.push('The production branch name main is involved in the deploy evidence.')
  }

  if (canTriggerProduction) {
    failures.push('The command or target can trigger production.')
  }

  const commandIncludesApprovedBranch = Array.from(approvedStagingBranches).some((branch) => command.includes(branch))

  if (command && !commandIncludesApprovedBranch) {
    failures.push('Command under review does not include an approved staging branch.')
  }

  if (command && command.toLowerCase().includes('netlify deploy --trigger')) {
    failures.push('Netlify CLI trigger cannot prove target context safely for staging. Use an explicit branch build workflow instead.')
  }

  if (command && command.toLowerCase().includes('--prod')) {
    failures.push('Never use --prod during staging work.')
  }

  return {
    canTriggerProduction,
    failures,
    mainInvolved,
    mode: safeMode,
  }
}

function printReport(report) {
  console.log('Netlify deploy safety check')
  console.log('')
  console.log(`Safety mode: ${report.mode}`)
  console.log(`Current git branch: ${report.currentBranch || 'unknown'}`)
  console.log(`Target branch: ${report.targetBranch || 'unknown'}`)
  console.log(`Netlify site id: ${report.siteId || 'unknown'}`)
  console.log(`Netlify deploy context: ${report.deployContext || 'unknown'}`)
  console.log(`Intended URL or context: ${report.intendedUrl || 'unknown'}`)
  console.log(`Command under review: ${report.command || 'not provided'}`)
  console.log(`Expected Supabase ref: ${report.expectedSupabaseRef || 'not provided'}`)
  console.log(`Main involved: ${report.mainInvolved ? 'yes' : 'no'}`)
  console.log(`Can trigger production: ${report.canTriggerProduction ? 'yes' : 'no'}`)
  console.log(`Dist folder present: ${report.dist.exists ? 'yes' : 'no'}`)
  console.log(`Legacy staging Supabase ref present in dist: ${report.dist.hasLegacyStagingRef ? 'yes' : 'no'}`)
  console.log(`Live Supabase ref present in dist: ${report.dist.hasLiveRef ? 'yes' : 'no'}`)
  console.log(`Pilot preservation checked: ${report.pilot.checked ? 'yes' : 'no'}`)
  console.log('')

  if (report.failures.length > 0) {
    console.error('Deploy safety result: blocked')
    for (const failure of report.failures) {
      console.error(`- ${failure}`)
    }
    return
  }

  console.log(`Deploy safety result: allowed for ${report.mode}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const mode = normalizeMode(args.mode || process.env.DEPLOY_SAFETY_MODE || 'deploy')
  const currentBranch = runGit(['branch', '--show-current'])
  const targetBranch = args['target-branch'] || process.env.NETLIFY_TARGET_BRANCH || (mode === 'local-live' ? currentBranch : currentBranch)
  const deployContext = args.context || process.env.NETLIFY_DEPLOY_CONTEXT || (mode === 'local-live' ? '' : process.env.CONTEXT || '')
  const intendedUrl = args['intended-url'] || process.env.NETLIFY_INTENDED_URL || (mode === 'local-live' ? 'local live-aligned validation' : stagingUrl)
  const command = args.command || process.env.NETLIFY_DEPLOY_COMMAND || ''
  const expectedSupabaseRef = args['expected-supabase-ref'] || process.env.EXPECTED_SUPABASE_REF || ''
  const state = readJsonIfExists(path.resolve('.netlify', 'state.json'))
  const siteId = args['site-id'] || process.env.NETLIFY_SITE_ID || state?.siteId || ''
  const dist = await scanDistRefs()
  const pilot = scanPilotPreservation()
  const result = evaluateSafety({
    command,
    currentBranch,
    deployContext,
    dist,
    expectedSupabaseRef,
    intendedUrl,
    mode,
    pilot,
    siteId,
    targetBranch,
  })

  const report = {
    canTriggerProduction: result.canTriggerProduction,
    currentBranch,
    deployContext,
    dist,
    expectedSupabaseRef,
    failures: result.failures,
    intendedUrl,
    mainInvolved: result.mainInvolved,
    mode: result.mode,
    pilot,
    command,
    siteId,
    targetBranch,
  }

  printReport(report)

  if (result.failures.length > 0) {
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message || error)
    process.exit(1)
  })
}
