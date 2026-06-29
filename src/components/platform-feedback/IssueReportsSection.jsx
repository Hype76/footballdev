import { useMemo, useState } from 'react'
import { formatPlatformDate } from '../../lib/platform-admin-stats.js'

const statusLabels = {
  new: 'New',
  triaged: 'Reviewed',
  accepted: 'Accepted',
  in_progress: 'In progress',
  fixed: 'Closed',
  rejected: 'Rejected',
  duplicate: 'Duplicate',
  needs_info: 'Needs info',
}

const closedStatuses = new Set(['fixed', 'rejected', 'duplicate'])
const actionButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-[#4f7c66] bg-[#12251d] px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-[#e7fff1] transition hover:border-[#6ee7b7] hover:bg-[#163426] disabled:cursor-not-allowed disabled:opacity-50'

function getStatusLabel(status) {
  const normalizedStatus = String(status || 'new').trim()
  return statusLabels[normalizedStatus] || normalizedStatus || 'New'
}

function getVisibleReports(reports, showClosedReports) {
  if (showClosedReports) {
    return reports
  }

  return reports.filter((report) => !closedStatuses.has(String(report.status || '').trim()))
}

export function IssueReportsSection({
  activeAttachmentId = '',
  activeReportId = '',
  isLoading = false,
  onAttachmentOpen,
  onStatusChange,
  reports = [],
  showAdminActions = false,
}) {
  const [showClosedReports, setShowClosedReports] = useState(false)
  const visibleReports = useMemo(() => getVisibleReports(reports, showClosedReports), [reports, showClosedReports])
  const closedCount = reports.length - getVisibleReports(reports, false).length

  if (isLoading) {
    return (
      <div className="rounded-lg border border-[#29483b] bg-[#102019] px-4 py-5 text-sm font-semibold text-[#d8fbe5] shadow-sm shadow-[#020806]/30">
        Loading issue reports...
      </div>
    )
  }

  return (
    <section
      aria-labelledby="issue-reports-heading"
      className="rounded-lg border border-[#345b48] bg-[#0f1f18] p-5 shadow-sm shadow-[#020806]/40"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#64a8ff]">Issue reports</p>
          <h3 id="issue-reports-heading" className="mt-1 text-lg font-black text-[#f4fff8]">
            Production Report Issue submissions
          </h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#c7f7d8]">
            Operational support reports submitted through Report issue.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <p className="rounded-lg border border-[#345b48] bg-[#07130e] px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-[#64a8ff]">
            {reports.length} visible
          </p>
          {closedCount ? (
            <button
              type="button"
              onClick={() => setShowClosedReports((current) => !current)}
              className="text-left text-xs font-black uppercase tracking-[0.12em] text-[#d8fbe5] underline decoration-[#4f7c66] underline-offset-4 transition hover:text-white"
            >
              {showClosedReports ? 'Hide closed' : `Show closed (${closedCount})`}
            </button>
          ) : null}
        </div>
      </div>

      {reports.length === 0 ? (
        <div className="mt-4 rounded-lg border border-[#29483b] bg-[#102019] px-4 py-5 text-sm font-semibold text-[#d8fbe5]">
          No issue reports have been submitted yet.
        </div>
      ) : visibleReports.length === 0 ? (
        <div className="mt-4 rounded-lg border border-[#29483b] bg-[#102019] px-4 py-5 text-sm font-semibold text-[#d8fbe5]">
          All issue reports are closed. Use Show closed to review them.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visibleReports.map((report) => {
            const normalizedStatus = String(report.status || 'new').trim() || 'new'
            const canMarkReviewed = showAdminActions && normalizedStatus !== 'triaged'
            const canMarkClosed = showAdminActions && normalizedStatus !== 'fixed'
            const attachment = report.attachment || {}
            const hasAttachment = Boolean(attachment.hasAttachment)

            return (
              <article key={report.id} className="rounded-lg border border-[#29483b] bg-[#0b1712] p-4 shadow-sm shadow-[#020806]/30">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-black text-[#f4fff8]">{report.title || 'Untitled report'}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#d8fbe5]">
                      {report.summary || 'No summary provided.'}
                    </p>
                  </div>
                  <p className="shrink-0 rounded-lg border border-[#1d4ed8] bg-[#0b2d5b] px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-[#64a8ff]">
                    {getStatusLabel(normalizedStatus)}
                  </p>
                </div>
                <div className="mt-3 grid gap-2 text-xs font-black uppercase tracking-[0.12em] text-[#c7f7d8] md:grid-cols-2 xl:grid-cols-4">
                  <span>Type: {report.feedbackType || 'Unknown'}</span>
                  <span>Severity: {report.severity || 'Unknown'}</span>
                  <span>Module: {report.module || 'Unknown'}</span>
                  <span>Route: {report.route || 'Unknown'}</span>
                  <span>Reporter: {report.submittedByName || report.submittedByEmail || 'Unknown'}</span>
                  <span>Club: {report.clubName || 'No club'}</span>
                  <span>Team: {report.teamName || 'No team'}</span>
                  <span>Date: {formatPlatformDate(report.createdAt)}</span>
                </div>
                <p className="mt-3 break-all text-xs font-semibold text-[#b9dcc8]">Report ID: {report.id}</p>
                {hasAttachment ? (
                  <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[#29483b] bg-[#102019] px-3 py-3 text-xs font-black uppercase tracking-[0.12em] text-[#c7f7d8] sm:flex-row sm:items-center sm:justify-between">
                    <span className="break-words">
                      Screenshot: {attachment.originalFilename || 'Attached'}
                    </span>
                    {showAdminActions ? (
                      <button
                        type="button"
                        disabled={activeAttachmentId === report.id}
                        onClick={() => onAttachmentOpen?.(report)}
                        className={actionButtonClass}
                      >
                        {activeAttachmentId === report.id ? 'Opening...' : 'View screenshot'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {showAdminActions ? (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      disabled={!canMarkReviewed || activeReportId === report.id}
                      onClick={() => onStatusChange?.(report, 'reviewed')}
                      className={actionButtonClass}
                    >
                      Mark reviewed
                    </button>
                    <button
                      type="button"
                      disabled={!canMarkClosed || activeReportId === report.id}
                      onClick={() => onStatusChange?.(report, 'closed')}
                      className={actionButtonClass}
                    >
                      Mark closed
                    </button>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
