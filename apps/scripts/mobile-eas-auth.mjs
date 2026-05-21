import { execFileSync } from 'node:child_process'

export function assertEasLogin() {
  try {
    const accountName = execFileSync('npx', ['eas-cli', 'whoami'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

    if (!accountName) {
      throw new Error('EAS returned an empty account name.')
    }

    console.log(`Expo EAS account: ${accountName}`)
    return accountName
  } catch {
    console.error('Expo EAS login is required before this mobile external command can run.')
    console.error('Run npx eas-cli login and sign in to the correct Expo account, then rerun the guarded mobile command.')
    process.exit(1)
  }
}
