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
  return clubs.filter((club) => !club.archivedAt).reduce((items, club) => {
    const planName = getPlanName(club.planKey)
    items[planName] = (items[planName] ?? 0) + 1
    return items
  }, {})
}

export function getPlatformDashboardStats(stats, { openIssueCount = 0 } = {}) {
  const platformTotals = stats?.totals ?? {}
  const planBreakdown = getPlanBreakdown(stats?.clubs ?? [])

  return [
    {
      label: 'Clubs',
      value: platformTotals.clubs ?? 0,
      caption: 'Live club workspaces',
      detail: `${Object.keys(planBreakdown).length} plan types active`,
      path: '/platform-clubs',
      actionLabel: 'View clubs',
    },
    {
      label: 'Teams',
      value: platformTotals.teams ?? 0,
      caption: 'Operational team spaces',
      detail: 'Across all clubs',
      path: '/platform-clubs',
      actionLabel: 'View teams',
    },
    {
      label: 'Active players',
      value: platformTotals.players ?? 0,
      caption: 'Visible player records',
      detail: `${platformTotals.archivedPlayers ?? 0} archived`,
      path: '/platform-data-hygiene',
      actionLabel: 'View player records',
    },
    {
      label: 'Staff accounts',
      value: platformTotals.staffAccounts ?? 0,
      caption: 'Staff and platform operators',
      detail: `${platformTotals.clubUsers ?? 0} linked to clubs`,
      path: '/platform-staff',
      actionLabel: 'View platform staff',
    },
    {
      label: 'Parent accounts',
      value: platformTotals.parentAccounts ?? 0,
      caption: 'Authenticated parent users',
      detail: 'Separate from staff accounts',
      path: '/platform-analytics?focus=parents',
      actionLabel: 'View parent adoption',
    },
    {
      label: 'Development records',
      value: platformTotals.evaluations ?? 0,
      caption: 'Saved player reports',
      detail: `${platformTotals.recentEvaluations ?? 0} in the last 7 days`,
      path: '/platform-analytics?focus=development',
      actionLabel: 'View development analytics',
    },
    {
      label: 'Recent admin activity',
      value: platformTotals.recentAdminActions ?? 0,
      caption: 'Admin actions in the last 7 days',
      detail: 'Recent measure, not a capped lifetime total',
      path: '/platform-data-hygiene#recent-activity',
      actionLabel: 'View activity context',
    },
    {
      label: 'Open platform issues',
      value: Number(openIssueCount ?? 0),
      caption: 'Product and production reports',
      detail: 'Items that still need review',
      path: '/platform-feedback',
      actionLabel: 'View platform feedback',
    },
  ]
}

export function getClubManagementStats(stats) {
  const platformTotals = stats?.totals ?? {}
  const clubs = stats?.clubs ?? []
  const activeClubs = clubs.filter((club) => !club.archivedAt)
  const suspendedClubs = activeClubs.filter((club) => club.status === 'suspended').length
  const compedClubs = activeClubs.filter((club) => club.isPlanComped).length

  return [
    {
      label: 'Club workspaces',
      value: platformTotals.clubs ?? 0,
      caption: `${suspendedClubs} suspended, ${platformTotals.archivedClubs ?? 0} archived`,
    },
    {
      label: 'Adult users',
      value: platformTotals.users ?? 0,
      caption: `${platformTotals.clubUsers ?? 0} linked to clubs`,
    },
    {
      label: 'Teams',
      value: platformTotals.teams ?? 0,
      caption: `${platformTotals.archivedTeams ?? 0} archived`,
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
