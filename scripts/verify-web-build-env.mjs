import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const distDir = path.resolve('dist')
const liveProjectRef = 'hvapkizujvsahvgspser'
const stagingProjectRef = 'llpufwzvgxyczxcjwupu'

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return listJavaScriptFiles(absolutePath)
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [absolutePath] : []
  }))
  return files.flat()
}

async function verifyBuildEnvironment() {
  try {
    await stat(distDir)
  } catch {
    throw new Error('dist folder is missing. Run the web build before verifying it.')
  }

  const files = await listJavaScriptFiles(distDir)
  let hasLiveProject = false
  let hasStagingProject = false

  for (const file of files) {
    const content = await readFile(file, 'utf8')
    hasLiveProject ||= content.includes(liveProjectRef)
    hasStagingProject ||= content.includes(stagingProjectRef)
  }

  if (hasLiveProject && hasStagingProject) {
    throw new Error('Build contains both live and staging Supabase project refs.')
  }

  if (!hasLiveProject && !hasStagingProject) {
    throw new Error('Build does not contain a known Supabase project ref.')
  }

  if (process.env.CONTEXT === 'production' && hasStagingProject) {
    throw new Error('Production Netlify build is pointing at staging Supabase.')
  }

  if (process.env.CONTEXT && process.env.CONTEXT !== 'production' && hasLiveProject) {
    throw new Error(`${process.env.CONTEXT} Netlify build is pointing at live Supabase.`)
  }

  const target = hasLiveProject ? 'live' : 'staging'
  console.log(`Verified ${target} Supabase project in web build.`)
}

verifyBuildEnvironment().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
