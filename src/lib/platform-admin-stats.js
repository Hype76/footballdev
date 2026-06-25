import { formatUkDateTime } from './date-format.js'
import { getPlanName } from './plans.js'

export function formatPlatformDate(value) {
  if (!value) {
    return 'No activity yet'
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'No activity yet'
  }

  return formatUkDateTime(parsedDate.toISOString(), 'No activity yet')
}

export function getPlanBreakdown(clubs = []) {
  return clubs.reduce((items, club) => {
    const planName = getPlanName(club.planKey)
    items[planName] = (items[planName] ?? 0) + 1
    return items
  }, {})
}

export function getPlatformDashboardStats(stats) {
  const platformTotals = stats?.totals ?? {}
  const planBreakdown = getPlanBreakdown(stats?.clubs ?? [])

  return [
    {
      label: 'Clubs',
      value: platformTotals.clubs ?? 0,
      caption: 'Live club workspaces',
      detail: `${Object.keys(planBreakdown).length} plan types active`,
    },
    {
      label: 'Adult users',
      value: platformTotals.users ?? 0,
      caption: 'Signed in staff accounts',
      detail: `${platformTotals.clubUsers ?? 0} linked to clubs`,
    },
    {
      label: 'Teams',
      value: platformTotals.teams ?? 0,
      caption: 'Operational team spaces',
      detail: 'Across all clubs',
    },
    {
      label: 'Active players',
      value: platformTotals.players ?? 0,
      caption: 'Visible player records',
      detail: `${platformTotals.archivedPlayers ?? 0} archived`,
    },
    {
      label: 'Development records',
      value: platformTotals.evaluations ?? 0,
      caption: 'Saved player reports',
      detail: `${platformTotals.recentEvaluations ?? 0} in the last 7 days`,
    },
    {
      label: 'Shared exports',
      value: platformTotals.communications ?? 0,
      caption: 'Emails and shares',
      detail: `${platformTotals.recentCommunications ?? 0} in the last 7 days`,
    },
    {
      label: 'Audit events',
      value: platformTotals.auditEvents ?? 0,
      caption: 'Tracked admin actions',
      detail: 'Accountability trail',
    },
    {
      label: 'Platform admins',
      value: platformTotals.platformAdmins ?? 0,
      caption: 'Owner level access',
      detail: 'Restricted admin users',
    },
  ]
}

export function getClubManagementStats(stats) {
  const platformTotals = stats?.totals ?? {}
  const clubs = stats?.clubs ?? []
  const suspendedClubs = clubs.filter((club) => club.status === 'suspended').length
  const compedClubs = clubs.filter((club) => club.isPlanComped).length

  return [
    {
      label: 'Club workspaces',
      value: platformTotals.clubs ?? 0,
      caption: `${suspendedClubs} suspended`,
    },
    {
      label: 'Adult users',
      value: platformTotals.users ?? 0,
      caption: `${platformTotals.clubUsers ?? 0} linked to clubs`,
    },
    {
      label: 'Teams',
      value: platformTotals.teams ?? 0,
      caption: 'Created across clubs',
    },
    {
      label: 'Free access',
      value: compedClubs,
      caption: 'Platform controlled overrides',
    },
  ]
}

export function getFeedbackStats(feedbackItems = [], supportReports = []) {
  const reports = Array.isArray(supportReports) ? supportReports : []
  const openSupportReports = reports.filter((report) => report.status === 'new' || report.status === 'triaged' || !report.status)

  return [
    {
      label: 'Feedback items',
      value: feedbackItems.length + reports.length,
      caption: reports.length ? 'Ideas and issue reports' : 'Submitted ideas',
    },
    {
      label: 'Open items',
      value: feedbackItems.filter((item) => item.status === 'open').length + openSupportReports.length,
      caption: 'Needs review',
    },
    {
      label: 'Planned',
      value: feedbackItems.filter((item) => item.status === 'planned').length,
      caption: 'Roadmap candidates',
    },
    {
      label: 'Votes',
      value: feedbackItems.reduce((total, item) => total + Number(item.voteCount ?? 0), 0),
      caption: 'Total user votes',
    },
  ]
}
