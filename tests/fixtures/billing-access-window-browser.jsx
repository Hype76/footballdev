import React from 'react'
import { createRoot } from 'react-dom/client'
import { PlatformAccountManagementSection } from '../../src/components/platform/PlatformAccountManagementSection.jsx'

const club = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'FP TEST Billing Browser Club',
  contactEmail: 'billing@example.test',
  planKey: 'small_club',
  planStatus: 'active',
  billingArrangement: 'deferred',
  billingStartAt: '2027-01-15T00:00:00.000Z',
  billingAccessState: 'full',
  status: 'active',
  teamCount: 0,
  userCount: 0,
  playerCount: 0,
  teams: [],
  users: [],
}

window.billingSaveCalls = []
window.fetch = async () => new Response(JSON.stringify({
  success: true,
  access: { club, invites: [], users: [], teams: [] },
}), { status: 200, headers: { 'Content-Type': 'application/json' } })

const noOp = () => {}

createRoot(document.getElementById('root')).render(
  <PlatformAccountManagementSection
    accessToken="fixture-token"
    archiveCount={0}
    clubPage={1}
    clubSearchTerm=""
    isLoading={false}
    onAccountAction={noOp}
    onArchiveClub={noOp}
    onArchiveTeam={noOp}
    onClubPageChange={noOp}
    onClubPlanChange={async (_club, fieldName, value) => {
      window.billingSaveCalls.push({ fieldName, value })
      return { success: true }
    }}
    onClubSearchChange={noOp}
    onDeleteClub={noOp}
    onDeleteTeam={noOp}
    onRecordViewChange={noOp}
    onRestoreClub={noOp}
    onRestoreTeam={noOp}
    onSelectedClubChange={noOp}
    onToggleClubStatus={noOp}
    pageSize={10}
    paginatedClubs={{ items: [club] }}
    recordView="active"
    selectedClubId="All"
    stats={{ clubs: [club] }}
    updatingClubId=""
    updatingTeamId=""
    updatingUserId=""
    visibleClubs={[club]}
  />,
)
