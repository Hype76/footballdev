import { formatUkDate } from './date-format.js'

export const PLATFORM_FEEDBACK_CACHE_KEY = 'platform-feedback-page'
export const FEEDBACK_PAGE_SIZE = 10

export function formatFeedbackDate(value) {
  if (!value) {
    return 'No date'
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'No date'
  }

  return formatUkDate(parsedDate.toISOString().slice(0, 10), 'No date')
}

export function getFeedbackStats(feedbackItems, supportReports = []) {
  const reports = Array.isArray(supportReports) ? supportReports : []
  const openSupportReports = reports.filter((report) => report.status === 'new' || report.status === 'triaged' || !report.status)

  return [
    {
      label: 'Feedback items',
      value: feedbackItems.length + reports.length,
      caption: reports.length ? 'Ideas and issue reports' : 'Ideas submitted',
    },
    {
      label: 'Open',
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
      caption: 'Total votes',
    },
  ]
}
