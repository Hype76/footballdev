import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadMobileLocalEnv(repoRoot, appPath) {
  const env = {}
  const envFiles = ['.env', '.env.local']

  envFiles.forEach((fileName) => {
    const envPath = resolve(repoRoot, appPath, fileName)

    if (!existsSync(envPath)) {
      return
    }

    const contents = readFileSync(envPath, 'utf8')

    contents.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith('#')) {
        return
      }

      const separatorIndex = trimmed.indexOf('=')

      if (separatorIndex === -1) {
        return
      }

      const key = trimmed.slice(0, separatorIndex).trim()
      const value = trimmed.slice(separatorIndex + 1).trim()

      if (key) {
        env[key] = value
      }
    })
  })

  return env
}
