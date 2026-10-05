import { execFileSync } from 'node:child_process'
import { publisherInvocation } from './mobile-eas-publisher.mjs'

export function assertEasLogin() {
  try {
    const publisher = publisherInvocation(['whoami'])
    const accountName = execFileSync(publisher.command, publisher.args, {
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

    if (!accountName) {
      throw new Error('EAS returned an empty account name.')
    }

    console.log(`Expo EAS account: ${accountName}`)
    return accountName
  } catch {
    console.error('Expo EAS login is required before this mobile external command can run.')
    console.error('Install the reviewed publisher with npm run mobile:publisher:install and retain the existing Expo account login, then rerun the guarded mobile command.')
    process.exit(1)
  }
}
