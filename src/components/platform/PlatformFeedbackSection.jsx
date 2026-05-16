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
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
          Loading feedback...
        </div>
      ) : feedbackItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
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
              <div key={item.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
                <div className="grid gap-4 xl:grid-cols-[1fr_220px]">
                  <div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{item.message}</p>
                    <p className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                      {item.clubName} | {item.createdByEmail || 'No email'} | {item.voteCount} votes
                    </p>
                  </div>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Status</span>
                    <select
                      value={draft.status}
                      onChange={(event) => onDraftChange(item.id, 'status', event.target.value)}
                      className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
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
                  <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">Visible comments</p>
                    <div className="mt-3 space-y-3">
                      {item.comments.map((comment) => (
                        <div key={comment.id} className="rounded-lg bg-[var(--panel-alt)] px-4 py-3">
                          <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{comment.message}</p>
                          <p className="mt-2 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                            Platform admin | {formatPlatformDate(comment.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Add public comment</span>
                  <textarea
                    rows="3"
                    value={draft.adminComment}
                    onChange={(event) => onDraftChange(item.id, 'adminComment', event.target.value)}
                    placeholder="This will be visible to users on the feedback board."
                    className="min-h-24 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                </label>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    disabled={updatingFeedbackId === item.id}
                    title={updatingFeedbackId === item.id ? 'Please wait while this feedback is being saved.' : undefined}
                    onClick={() => void onSave(item)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={updatingFeedbackId === item.id}
                    title={updatingFeedbackId === item.id ? 'Please wait while this feedback is being updated.' : undefined}
                    onClick={() => void onDelete(item)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
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
