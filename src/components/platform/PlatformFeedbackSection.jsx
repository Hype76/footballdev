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
        <div className="border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600">
          Loading feedback...
        </div>
      ) : feedbackItems.length === 0 ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600">
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
              <div key={item.id} className="border border-slate-200 bg-white p-5">
                <div className="grid gap-4 xl:grid-cols-[1fr_220px]">
                  <div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.message}</p>
                    <p className="mt-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                      {item.clubName} | {item.createdByEmail || 'No email'} | {item.voteCount} votes
                    </p>
                  </div>
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-slate-950">Status</span>
                    <select
                      value={draft.status}
                      onChange={(event) => onDraftChange(item.id, 'status', event.target.value)}
                      className="min-h-11 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
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
                  <div className="mt-4 border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-black text-slate-950">Visible comments</p>
                    <div className="mt-3 space-y-3">
                      {item.comments.map((comment) => (
                        <div key={comment.id} className="border border-slate-200 bg-white px-4 py-3">
                          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{comment.message}</p>
                          <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            Platform admin | {formatPlatformDate(comment.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-bold text-slate-950">Add public comment</span>
                  <textarea
                    rows="3"
                    value={draft.adminComment}
                    onChange={(event) => onDraftChange(item.id, 'adminComment', event.target.value)}
                    placeholder="This will be visible to users on the feedback board."
                    className="min-h-24 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                  />
                </label>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    disabled={updatingFeedbackId === item.id}
                    title={updatingFeedbackId === item.id ? 'Please wait while this feedback is being saved.' : undefined}
                    onClick={() => void onSave(item)}
                    className="inline-flex min-h-11 items-center justify-center bg-emerald-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={updatingFeedbackId === item.id}
                    title={updatingFeedbackId === item.id ? 'Please wait while this feedback is being updated.' : undefined}
                    onClick={() => void onDelete(item)}
                    className="inline-flex min-h-11 items-center justify-center border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
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
