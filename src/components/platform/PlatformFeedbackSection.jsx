import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'
import { formatPlatformDate } from '../../lib/platform-admin-stats.js'

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'declined', label: 'Declined' },
]

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] transition hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60'
const emptyStateClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10'

export function PlatformFeedbackSection({
  drafts,
  feedbackItems,
  isLoading,
  onDelete,
  onDraftChange,
  onPageChange,
  onSave,
  page,
  pageSize,
  paginatedItems,
  supportReports = [],
  updatingFeedbackId,
}) {
  return (
    <SectionCard
      title="Platform feedback"
      description="Review product feedback, support reports, roadmap status, and internal notes."
    >
      {isLoading ? (
        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
          Loading feedback...
        </div>
      ) : feedbackItems.length === 0 && supportReports.length === 0 ? (
        <div className={emptyStateClass}>
          No platform feedback has been submitted yet.
        </div>
      ) : (
        <div className="space-y-4">
          {supportReports.length ? (
            <div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-5 shadow-sm shadow-[#047857]/10">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#1d4ed8]">Issue reports</p>
                  <h3 className="mt-1 text-lg font-black text-[#101828]">Production Report Issue submissions</h3>
                </div>
                <p className="rounded-lg border border-[#bfdbfe] bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-[#1d4ed8]">
                  {supportReports.length} visible
                </p>
              </div>
              <div className="mt-4 space-y-3">
                {supportReports.map((report) => (
                  <div key={report.id} className="rounded-lg border border-[#bfdbfe] bg-white p-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <p className="text-sm font-black text-[#101828]">{report.title || 'Untitled report'}</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#4b5f55]">
                          {report.summary || 'No summary provided.'}
                        </p>
                      </div>
                      <p className="text-xs font-black uppercase tracking-[0.12em] text-[#1d4ed8]">
                        {report.status || 'new'}
                      </p>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs font-black uppercase tracking-[0.12em] text-[#4b5f55] md:grid-cols-2 xl:grid-cols-4">
                      <span>Type: {report.feedbackType || 'Unknown'}</span>
                      <span>Severity: {report.severity || 'Unknown'}</span>
                      <span>Module: {report.module || 'Unknown'}</span>
                      <span>Route: {report.route || 'Unknown'}</span>
                      <span>Reporter: {report.submittedByName || report.submittedByEmail || 'Unknown'}</span>
                      <span>Club: {report.clubName || 'No club'}</span>
                      <span>Team: {report.teamName || 'No team'}</span>
                      <span>Date: {formatPlatformDate(report.createdAt)}</span>
                    </div>
                    <p className="mt-3 break-all text-xs font-semibold text-[#4b5f55]">Report ID: {report.id}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {paginatedItems.items.map((item) => {
            const draft = drafts[item.id] ?? {
              status: item.status,
              adminComment: '',
            }

            return (
              <div key={item.id} className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10">
                <div className="grid gap-4 xl:grid-cols-[1fr_220px]">
                  <div>
                    <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-[#4b5f55]">{item.message}</p>
                    <p className="mt-3 text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">
                      Club: {item.clubName}, Email: {item.createdByEmail || 'No email'}, Votes: {item.voteCount}
                    </p>
                  </div>
                  <label className="block">
                    <span className={labelClass}>Status</span>
                    <select
                      value={draft.status}
                      onChange={(event) => onDraftChange(item.id, 'status', event.target.value)}
                      className={fieldClass}
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {item.comments?.length ? (
                  <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
                    <p className="text-sm font-black text-[#101828]">Visible comments</p>
                    <div className="mt-3 space-y-3">
                      {item.comments.map((comment) => (
                        <div key={comment.id} className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-3">
                          <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-[#4b5f55]">{comment.message}</p>
                          <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">
                            Author: Platform admin, Date: {formatPlatformDate(comment.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <label className="mt-4 block">
                  <span className={labelClass}>Add public comment</span>
                  <textarea
                    rows="3"
                    value={draft.adminComment}
                    onChange={(event) => onDraftChange(item.id, 'adminComment', event.target.value)}
                    placeholder="This will be visible to users on the feedback board."
                    className={fieldClass}
                  />
                </label>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    disabled={updatingFeedbackId === item.id}
                    title={updatingFeedbackId === item.id ? 'Please wait while this feedback is being saved.' : undefined}
                    onClick={() => void onSave(item)}
                    className={primaryButtonClass}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={updatingFeedbackId === item.id}
                    title={updatingFeedbackId === item.id ? 'Please wait while this feedback is being updated.' : undefined}
                    onClick={() => void onDelete(item)}
                    className={dangerButtonClass}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
          <Pagination
            currentPage={page}
            onPageChange={onPageChange}
            pageSize={pageSize}
            totalItems={feedbackItems.length}
          />
        </div>
      )}
    </SectionCard>
  )
}
