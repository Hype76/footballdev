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

export function getPlatformDashboardStats(analyticsReport, { openIssueCount = 0 } = {}) {
  const estate = analyticsReport?.accountEstate ?? {}
  const activity = analyticsReport?.productActivity ?? {}
  const scope = estate.workspaceScopeBreakdown ?? {}

  return [
    {
      label: 'Customer clubs',
      value: estate.customerClubs ?? 0,
      caption: 'Active Club-scope customers',
      detail: `${estate.customerWorkspaces ?? 0} customer workspaces in total`,
      path: '/platform-analytics?focus=customerClubs',
      actionLabel: 'View customer clubs',
    },
    {
      label: 'Teams',
      value: estate.teams ?? 0,
      caption: 'Active football teams',
      detail: `${scope.team ?? 0} Team-scope workspaces`,
      path: '/platform-analytics?focus=teams',
      actionLabel: 'View counted teams',
    },
    {
      label: 'Active players',
      value: estate.activePlayers ?? 0,
      caption: 'Active players on active teams',
      detail: 'Test and promoted records excluded',
      path: '/platform-analytics?focus=activePlayers',
      actionLabel: 'View active-player breakdown',
    },
    {
      label: 'Staff accounts',
      value: estate.staffAccounts ?? 0,
      caption: 'Active customer staff accounts',
      detail: `${estate.staffAssignments ?? 0} team-role assignments`,
      path: '/platform-analytics?focus=staffAccounts',
      actionLabel: 'View staff breakdown',
    },
    {
      label: 'Users with Parent access',
      value: estate.usersWithParentAccess ?? 0,
      caption: 'Accepted authenticated access',
      detail: `${estate.staffWithParentAccess ?? 0} also have staff access`,
      path: '/platform-analytics?focus=parentAccess',
      actionLabel: 'View Parent access breakdown',
    },
    {
      label: 'Development records',
      value: estate.developmentRecords ?? 0,
      caption: 'Saved customer Development history',
      detail: 'Historical player lifecycle retained',
      path: '/platform-analytics?focus=developmentRecords',
      actionLabel: 'View Development breakdown',
    },
    {
      label: 'Active this week',
      value: activity.activeUsers7Days ?? 0,
      caption: 'Users with meaningful activity',
      detail: 'Rolling seven-day customer view',
      path: '/platform-analytics?focus=productActivity',
      actionLabel: 'View product activity',
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
