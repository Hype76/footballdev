import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const confirmModalSource = readFileSync('src/components/ui/ConfirmModal.jsx', 'utf8')
const platformAdminPageSource = readFileSync('src/pages/PlatformAdminPage.jsx', 'utf8')
const platformAccountSectionSource = readFileSync('src/components/platform/PlatformAccountManagementSection.jsx', 'utf8')
const platformAdminActionsSource = readFileSync('src/lib/domain/platform-admin-actions.js', 'utf8')
const manageClubsSectionSource = readFileSync('src/components/platform/ManageClubsSection.jsx', 'utf8')

function getFunctionSource(source, functionName) {
  const declarations = [
    `const ${functionName} = async`,
    `export async function ${functionName}`,
  ]
  const matchedDeclaration = declarations.find((declaration) => source.includes(declaration))
  const declarationIndex = matchedDeclaration ? source.indexOf(matchedDeclaration) : -1

  assert.notEqual(declarationIndex, -1, `${functionName} should exist`)

  const arrowIndex = source.indexOf('=>', declarationIndex)
  const functionBodyMarkerIndex = source.indexOf(') {', declarationIndex)
  const bodySearchStart = arrowIndex !== -1 && (functionBodyMarkerIndex === -1 || arrowIndex < functionBodyMarkerIndex)
    ? arrowIndex
    : functionBodyMarkerIndex
  const bodyStart = source.indexOf('{', bodySearchStart)
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`)

  let depth = 0

  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index]

    if (character === '{') {
      depth += 1
    }

    if (character === '}') {
      depth -= 1
    }

    if (depth === 0) {
      return source.slice(declarationIndex, index + 1)
    }
  }

  throw new Error(`${functionName} body was not closed`)
}

function getFinallyBlock(functionSource) {
  const match = functionSource.match(/finally\s+\{([\s\S]*?)\n\s+\}/)
  assert.ok(match, 'handler should have a finally block')
  return match[1]
}

test('ConfirmModal submits through a form and shows missing password validation', () => {
  assert.match(confirmModalSource, /<form onSubmit=\{handleConfirm\}>/)
  assert.match(confirmModalSource, /type="submit"/)
  assert.match(confirmModalSource, /Enter your password to confirm this action\./)
  assert.match(confirmModalSource, /visibleErrorMessage/)
  assert.match(confirmModalSource, /await onConfirm\(nextPassword, nextReason\)/)
  assert.doesNotMatch(confirmModalSource, /onClick=\{handleConfirm\}/)
})

test('ConfirmModal locks repeated submissions while an async confirmation is pending', () => {
  assert.match(confirmModalSource, /const \[isSubmitting, setIsSubmitting\] = useState\(false\)/)
  assert.match(confirmModalSource, /if \(isBusy \|\| isSubmitting \|\| confirmDisabled\)/)
  assert.match(confirmModalSource, /setIsSubmitting\(true\)/)
  assert.match(confirmModalSource, /setIsSubmitting\(false\)/)
  assert.match(confirmModalSource, /const isActionBusy = isBusy \|\| isSubmitting/)
})

test('Platform Admin team delete failures keep the modal target open', () => {
  const teamHandler = getFunctionSource(platformAdminPageSource, 'confirmDeleteTeam')

  assert.match(teamHandler, /setConfirmErrorMessage\(getPlatformActionErrorMessage\(error, 'Team could not be deleted\.'\)\)/)
  assert.match(teamHandler, /setTeamDeleteTarget\(null\)/)
  assert.doesNotMatch(getFinallyBlock(teamHandler), /setTeamDeleteTarget\(null\)/)
})

test('Platform Admin delete team confirmation passes the async handler and in-modal error to ConfirmModal', () => {
  const teamModalIndex = platformAdminPageSource.indexOf('title="Delete team"')
  const teamModalSource = platformAdminPageSource.slice(teamModalIndex, platformAdminPageSource.indexOf('</ConfirmModal>', teamModalIndex))

  assert.match(teamModalSource, /errorMessage=\{confirmErrorMessage\}/)
  assert.match(teamModalSource, /onConfirm=\{confirmDeleteTeam\}/)
  assert.doesNotMatch(teamModalSource, /void confirmDeleteTeam\(password\)/)
})

test('Platform Admin team delete handler sends team, club, password, and access token', () => {
  const teamHandler = getFunctionSource(platformAdminPageSource, 'confirmDeleteTeam')

  assert.match(teamHandler, /if \(!teamDeleteTarget\?\.id \|\| !teamDeleteTarget\?\.clubId\)/)
  assert.match(teamHandler, /if \(updatingTeamId\)/)
  assert.match(teamHandler, /deletePlatformTeam\(\{[\s\S]*teamId: teamDeleteTarget\.id,[\s\S]*clubId: teamDeleteTarget\.clubId,[\s\S]*password,[\s\S]*accessToken: session\?\.access_token \|\| ''/)
})

test('Platform Admin modal error mapping covers password, session, permission, not found, conflict, and network failures', () => {
  assert.match(platformAdminPageSource, /That password was not accepted\./)
  assert.match(platformAdminPageSource, /Your session has expired\. Sign in again before retrying this action\./)
  assert.match(platformAdminPageSource, /You do not have permission to delete teams\./)
  assert.match(platformAdminPageSource, /This team could not be found\./)
  assert.match(platformAdminPageSource, /This team belongs to a different club than expected\./)
  assert.match(platformAdminPageSource, /This team cannot be deleted because linked records still depend on it\./)
  assert.match(platformAdminPageSource, /The server could not complete this action\. Please try again or contact support\./)
  assert.match(platformAdminPageSource, /Network failure\. Check your connection and try again\./)
})

test('Platform clubs search no longer binds browser datalist suggestions', () => {
  assert.doesNotMatch(platformAccountSectionSource, /list="platform-club-search-suggestions"/)
  assert.doesNotMatch(platformAccountSectionSource, /<datalist/)
  assert.match(platformAccountSectionSource, /type="search"/)
})

test('Platform Admin team deletion uses the server endpoint instead of direct client database delete', () => {
  const teamDeleteFunction = getFunctionSource(platformAdminActionsSource, 'deletePlatformTeam')

  assert.match(teamDeleteFunction, /fetch\('\/\.netlify\/functions\/platform-delete-team'/)
  assert.match(teamDeleteFunction, /method: 'DELETE'/)
  assert.match(teamDeleteFunction, /Authorization: `Bearer \$\{accessToken \|\| ''\}`/)
  assert.match(teamDeleteFunction, /clubId: normalizedClubId/)
  assert.match(teamDeleteFunction, /password: String\(password \?\? ''\)/)
  assert.doesNotMatch(teamDeleteFunction, /from\('teams'\)[\s\S]*\.delete\(\)/)
})

test('Manage Clubs invite copy distinguishes production accepted email from skipped environment email', () => {
  assert.match(manageClubsSectionSource, /inviteWasSent/)
  assert.match(manageClubsSectionSource, /The invite email was accepted for delivery\. Use this link only if the owner needs it manually\./)
  assert.match(manageClubsSectionSource, /Email delivery was skipped by environment policy\. Send this link manually to test setup\./)
  assert.doesNotMatch(manageClubsSectionSource, /Staging invite link/)
  assert.doesNotMatch(manageClubsSectionSource, /Emails are skipped on staging/)
})
