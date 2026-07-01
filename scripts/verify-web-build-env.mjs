import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const distDir = path.resolve('dist')
const liveProjectRef = 'hvapkizujvsahvgspser'
const retiredStagingProjectRef = 'llpufwzvgxyczxcjwupu'

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
  let hasRetiredStagingProject = false

  for (const file of files) {
    const content = await readFile(file, 'utf8')
    hasLiveProject ||= content.includes(liveProjectRef)
    hasRetiredStagingProject ||= content.includes(retiredStagingProjectRef)
  }

  if (hasRetiredStagingProject) {
    throw new Error('Build contains retired staging Supabase project ref.')
  }

  if (!hasLiveProject) {
    throw new Error('Build does not contain the live Supabase project ref.')
  }

  console.log('Verified live Supabase project in web build.')
}

verifyBuildEnvironment().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
