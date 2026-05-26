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
        <div className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] px-4 py-5 text-sm font-semibold text-[#5f7468]">
          Loading feedback...
        </div>
      ) : feedbackItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#bddcca] bg-[#f8fdf9] px-4 py-5 text-sm font-semibold text-[#5f7468]">
          No feedback has been submitted yet.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedFeedback.items.map((item) => (
            <div key={item.id} className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] p-4 shadow-sm shadow-[#d7eadf]/60">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-[#10231a]">{item.message}</p>
                  <p className="mt-3 text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">
                    {item.clubName} | {formatFeedbackDate(item.createdAt)} | {item.status}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onVote(item)}
                  disabled={activeVoteId === item.id}
                  title={activeVoteId === item.id ? 'Please wait while your vote is being saved.' : undefined}
                  className={[
                    'inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60',
                    item.hasVoted
                      ? 'bg-[#067a46] text-white hover:bg-[#05603a]'
                      : 'border border-[#bddcca] bg-white text-[#10231a] hover:bg-[#f8fdf9]',
                  ].join(' ')}
                >
                  {item.hasVoted ? 'Voted' : 'Vote'} ({item.voteCount})
                </button>
              </div>
              {item.comments?.length ? (
                <div className="mt-4 rounded-lg border border-[#bddcca] bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">
                    Platform comments
                  </p>
                  <div className="mt-3 space-y-3">
                    {item.comments.map((comment) => (
                      <div key={comment.id} className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] px-4 py-3">
                        <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-[#10231a]">{comment.message}</p>
                        <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">
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
