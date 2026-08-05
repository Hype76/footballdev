import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SECURITY_PHASE_REQUIREMENT =
  'A new named mobile Auth security phase is required before implementation.'

const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.json', '.jsx', '.mjs', '.ts', '.tsx'])
const SKIPPED_NAMES = new Set(['node_modules', 'package-lock.json'])

const PROHIBITED_RULES = [
  { category: 'redirect-based Auth options', pattern: /\b(?:redirectTo|emailRedirectTo)\s*:/g },
  { category: 'password recovery Auth API', pattern: /\.auth\s*\.\s*resetPasswordForEmail\s*\(/g },
  { category: 'OTP or magic-link Auth API', pattern: /\.auth\s*\.\s*(?:signInWithOtp|verifyOtp|resend)\s*\(/g },
  { category: 'mobile Auth signup API', pattern: /\.auth\s*\.\s*signUp\s*\(/g },
  { category: 'Auth code exchange', pattern: /\.auth\s*\.\s*exchangeCodeForSession\s*\(/g },
  { category: 'URL-provided session authority', pattern: /\.auth\s*\.\s*setSession\s*\(/g },
  { category: 'URL session extraction', pattern: /\b(?:getSessionFromUrl|sessionFromUrl|parseAuthSessionFromUrl)\s*\(/gi },
  { category: 'URL-session detection enabled', pattern: /\bdetectSessionInUrl\s*:\s*true\b/g },
  {
    category: 'Auth token parsing from URL',
    pattern: /(?:URLSearchParams|Linking\s*\.\s*parse|new\s+URL\s*\(|location\s*\.\s*(?:hash|search))[\s\S]{0,800}\b(?:access_token|refresh_token|token_hash|email_otp)\b/gi,
  },
  {
    category: 'Auth callback deep-link handling',
    pattern: /(?:Linking\s*\.\s*(?:getInitialURL|addEventListener|createURL)|useURL\s*\()[\s\S]{0,600}(?:auth\w*callback|callback\w*auth|(?:invite|magic|otp|recovery)\w*link|link\w*(?:invite|magic|otp|recovery))/gi,
  },
  {
    category: 'Auth callback navigation',
    pattern: /\b(?:path|pathname|routeName|screen)\s*:\s*['"][^'"]*(?:auth[^'"]*callback|callback[^'"]*auth|auth[^'"]*(?:invite|recovery|magic|otp))[^'"]*['"]/gi,
  },
  {
    category: 'Auth callback navigation',
    pattern: /\b(?:name|path)\s*=\s*['"][^'"]*(?:auth[^'"]*callback|callback[^'"]*auth|auth[^'"]*(?:invite|recovery|magic|otp))[^'"]*['"]/gi,
  },
  {
    category: 'raw redirect-based Auth endpoint',
    pattern: /\/auth\/v1\/(?:callback|invite|magiclink|otp|recover|verify)\b/gi,
  },
  { category: 'Expo Auth callback requirement', pattern: /\b(?:expo-auth-session|makeRedirectUri|useProxy)\b/gi },
  { category: 'Expo Go loopback Auth callback', pattern: /\bexps?:\/\/127\.0\.0\.1(?::\d+)?\b/gi },
]

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/')
}

function moduleFor(relativePath) {
  if (relativePath.startsWith('apps/coach-mobile/')) return 'Coach app'
  if (relativePath.startsWith('apps/parent-mobile/')) return 'Parent app'
  return 'mobile-core shared module'
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (SKIPPED_NAMES.has(entry.name) || entry.name.startsWith('.')) continue
    const absolutePath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(absolutePath))
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolutePath)
    }
  }

  return files
}

export function scanMobileAuthSource({ content, file = 'fixture.js', module = 'test fixture' }) {
  const failures = []

  for (const rule of PROHIBITED_RULES) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(content)) failures.push({ category: rule.category, file, module })
  }

  return failures
}

export async function scanMobileAuthBoundary({ repositoryRoot }) {
  const roots = [
    path.join(repositoryRoot, 'apps', 'coach-mobile'),
    path.join(repositoryRoot, 'apps', 'parent-mobile'),
    path.join(repositoryRoot, 'apps', 'mobile-core'),
  ]
  const files = (await Promise.all(roots.map(collectSourceFiles))).flat()
  const failures = []
  let passwordSignInCalls = 0
  let detectSessionInUrlFalse = 0

  for (const absolutePath of files) {
    const content = await readFile(absolutePath, 'utf8')
    const relativePath = normalizeRelativePath(path.relative(repositoryRoot, absolutePath))
    const module = moduleFor(relativePath)

    failures.push(...scanMobileAuthSource({ content, file: relativePath, module }))
    passwordSignInCalls += (content.match(/\.auth\s*\.\s*signInWithPassword\s*\(/g) || []).length
    detectSessionInUrlFalse += (content.match(/\bdetectSessionInUrl\s*:\s*false\b/g) || []).length
  }

  if (passwordSignInCalls < 1) {
    failures.push({ category: 'password-only Auth baseline missing', file: 'apps/mobile-core', module: 'mobile-core shared module' })
  }
  if (detectSessionInUrlFalse < 1) {
    failures.push({ category: 'detectSessionInUrl false baseline missing', file: 'apps/mobile-core', module: 'mobile-core shared module' })
  }

  return { detectSessionInUrlFalse, failures, filesScanned: files.length, passwordSignInCalls }
}

export function formatMobileAuthFailures(failures) {
  return failures.map((failure) =>
    `${failure.module} | ${failure.file} | ${failure.category} | ${SECURITY_PHASE_REQUIREMENT}`,
  )
}

async function runCli() {
  const scriptPath = fileURLToPath(import.meta.url)
  const repositoryRoot = path.resolve(path.dirname(scriptPath), '..', '..')
  const result = await scanMobileAuthBoundary({ repositoryRoot })

  if (result.failures.length > 0) {
    console.error('Mobile Auth boundary guard failed.')
    for (const line of formatMobileAuthFailures(result.failures)) console.error(line)
    process.exitCode = 1
    return
  }

  console.log(
    `Mobile Auth boundary guard passed: ${result.filesScanned} files, ` +
    `${result.passwordSignInCalls} password sign-in call, ` +
    `${result.detectSessionInUrlFalse} detectSessionInUrl false setting.`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli()
