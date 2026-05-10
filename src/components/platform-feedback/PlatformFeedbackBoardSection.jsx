import { FEEDBACK_PAGE_SIZE, formatFeedbackDate } from '../../lib/platform-feedback-utils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function PlatformFeedbackBoardSection({
  activeVoteId,
  feedbackItems,
  feedbackPage,
  isLoading,
  onPageChange,
  onVote,
  paginatedFeedback,
}) {
  return (
    <SectionCard title="Feedback board" description="Vote for feedback you agree with so platform admins can prioritise it.">
      {isLoading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
          Loading feedback...
        </div>
      ) : feedbackItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
          No feedback has been submitted yet.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedFeedback.items.map((item) => (
            <div key={item.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{item.message}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    {item.clubName} | {formatFeedbackDate(item.createdAt)} | {item.status}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onVote(item)}
                  disabled={activeVoteId === item.id}
                  className={[
                    'inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                    item.hasVoted
                      ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                      : 'border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
                  ].join(' ')}
                >
                  {item.hasVoted ? 'Voted' : 'Vote'} ({item.voteCount})
                </button>
              </div>
              {item.comments?.length ? (
                <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    Platform comments
                  </p>
                  <div className="mt-3 space-y-3">
                    {item.comments.map((comment) => (
                      <div key={comment.id} className="rounded-lg bg-[var(--panel-alt)] px-4 py-3">
                        <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{comment.message}</p>
                        <p className="mt-2 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                          Platform admin | {formatFeedbackDate(comment.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          <Pagination
            currentPage={feedbackPage}
            onPageChange={onPageChange}
            pageSize={FEEDBACK_PAGE_SIZE}
            totalItems={feedbackItems.length}
          />
        </div>
      )}
    </SectionCard>
  )
}
