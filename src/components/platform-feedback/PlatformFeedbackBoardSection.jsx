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
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600">
          Loading feedback...
        </div>
      ) : feedbackItems.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600">
          No feedback has been submitted yet.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedFeedback.items.map((item) => (
            <div key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-900">{item.message}</p>
                  <p className="mt-3 text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                    {item.clubName} | {formatFeedbackDate(item.createdAt)} | {item.status}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onVote(item)}
                  disabled={activeVoteId === item.id}
                  title={activeVoteId === item.id ? 'Please wait while your vote is being saved.' : undefined}
                  className={[
                    'inline-flex min-h-11 shrink-0 items-center justify-center rounded-md px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60',
                    item.hasVoted
                      ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                      : 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-100',
                  ].join(' ')}
                >
                  {item.hasVoted ? 'Voted' : 'Vote'} ({item.voteCount})
                </button>
              </div>
              {item.comments?.length ? (
                <div className="mt-4 rounded-md border border-slate-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                    Platform comments
                  </p>
                  <div className="mt-3 space-y-3">
                    {item.comments.map((comment) => (
                      <div key={comment.id} className="rounded-md bg-slate-50 px-4 py-3">
                        <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-900">{comment.message}</p>
                        <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
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
