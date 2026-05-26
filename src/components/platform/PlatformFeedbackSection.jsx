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

const labelClass = 'mb-2 block text-sm font-black text-[#0f172a]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition placeholder:text-[#94a3b8] focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#bfdbfe]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#2563eb] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] transition hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60'
const emptyStateClass = 'rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-5 text-sm font-semibold text-[#475569] shadow-sm shadow-[#2563eb]/10'

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
  updatingFeedbackId,
}) {
  return (
    <SectionCard
      title="Platform feedback"
      description="Review product feedback, update status, add internal notes, or remove completed items."
    >
      {isLoading ? (
        <div className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-5 text-sm font-semibold text-[#475569] shadow-sm shadow-[#2563eb]/10">
          Loading feedback...
        </div>
      ) : feedbackItems.length === 0 ? (
        <div className={emptyStateClass}>
          No platform feedback has been submitted yet.
        </div>
      ) : (
        <div className="space-y-4">
          {paginatedItems.items.map((item) => {
            const draft = drafts[item.id] ?? {
              status: item.status,
              adminComment: '',
            }

            return (
              <div key={item.id} className="rounded-lg border border-[#cbd5e1] bg-white p-5 shadow-sm shadow-[#2563eb]/10">
                <div className="grid gap-4 xl:grid-cols-[1fr_220px]">
                  <div>
                    <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-[#475569]">{item.message}</p>
                    <p className="mt-3 text-xs font-black uppercase tracking-[0.14em] text-[#475569]">
                      {item.clubName} | {item.createdByEmail || 'No email'} | {item.voteCount} votes
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
                  <div className="mt-4 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-sm shadow-[#2563eb]/10">
                    <p className="text-sm font-black text-[#0f172a]">Visible comments</p>
                    <div className="mt-3 space-y-3">
                      {item.comments.map((comment) => (
                        <div key={comment.id} className="rounded-lg border border-[#cbd5e1] bg-white px-4 py-3">
                          <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-[#475569]">{comment.message}</p>
                          <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-[#475569]">
                            Platform admin | {formatPlatformDate(comment.createdAt)}
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
