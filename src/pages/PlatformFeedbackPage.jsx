import { useEffect, useState } from 'react'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems, Pagination } from '../components/ui/Pagination.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { isSuperAdmin, useAuth } from '../lib/auth.js'
import {
  createPlatformFeedback,
  getPlatformFeedback,
  readViewCacheValue,
  unvotePlatformFeedback,
  votePlatformFeedback,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

const cacheKey = 'platform-feedback-page'
const FEEDBACK_PAGE_SIZE = 10

function formatDate(value) {
  if (!value) {
    return 'No date'
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'No date'
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsedDate)
}

export function PlatformFeedbackPage() {
  const { user } = useAuth()
  const [feedbackItems, setFeedbackItems] = useState(() => {
    const cachedItems = readViewCacheValue(cacheKey, 'feedbackItems', [])
    return Array.isArray(cachedItems) ? cachedItems : []
  })
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(() => feedbackItems.length === 0)
  const [isSaving, setIsSaving] = useState(false)
  const [activeVoteId, setActiveVoteId] = useState('')
  const [feedbackPage, setFeedbackPage] = useState(1)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const loadFeedback = async () => {
    const nextItems = await withRequestTimeout(() => getPlatformFeedback(user), 'Could not load platform feedback.')
    setFeedbackItems(nextItems)
    writeViewCache(cacheKey, {
      feedbackItems: nextItems,
    })
  }

  useEffect(() => {
    let isMounted = true

    const runLoad = async () => {
      if (!user) {
        setIsLoading(false)
        return
      }

      setErrorMessage('')

      try {
        const nextItems = await withRequestTimeout(() => getPlatformFeedback(user), 'Could not load platform feedback.')

        if (!isMounted) {
          return
        }

        setFeedbackItems(nextItems)
        writeViewCache(cacheKey, {
          feedbackItems: nextItems,
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Feedback could not be loaded right now.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void runLoad()

    return () => {
      isMounted = false
    }
  }, [user])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await createPlatformFeedback({
        user,
        message,
      })
      setMessage('')
      await loadFeedback()
      setSuccessMessage('Feedback submitted.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Feedback could not be submitted.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleVote = async (item) => {
    setActiveVoteId(item.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      if (item.hasVoted) {
        await unvotePlatformFeedback({
          user,
          feedbackId: item.id,
        })
      } else {
        await votePlatformFeedback({
          user,
          feedbackId: item.id,
        })
      }

      await loadFeedback()
    } catch (error) {
      console.error(error)
      setErrorMessage('Vote could not be saved.')
    } finally {
      setActiveVoteId('')
    }
  }

  const paginatedFeedback = getPaginatedItems(feedbackItems, feedbackPage, FEEDBACK_PAGE_SIZE)

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Platform Feedback"
        title="Share feedback"
        description="Tell us what would make the platform better. Other clubs can vote for ideas they also need."
      />

      {successMessage ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
          {successMessage}
        </div>
      ) : null}

      {errorMessage ? <NoticeBanner title="Feedback action failed" message={errorMessage} /> : null}

      {isSuperAdmin(user) ? null : (
        <SectionCard title="Create feedback" description="Keep it short and practical. One idea per feedback item works best.">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Feedback</span>
              <textarea
                required
                rows="5"
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value)
                  setErrorMessage('')
                  setSuccessMessage('')
                }}
                className="min-h-36 w-full rounded-3xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </form>
        </SectionCard>
      )}

      <SectionCard title="Feedback board" description="Vote for feedback you agree with so platform admins can prioritise it.">
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading feedback...
          </div>
        ) : feedbackItems.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No feedback has been submitted yet.
          </div>
        ) : (
          <div className="space-y-3">
            {paginatedFeedback.items.map((item) => (
              <div key={item.id} className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{item.message}</p>
                    <p className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                      {item.clubName} | {formatDate(item.createdAt)} | {item.status}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleVote(item)}
                    disabled={activeVoteId === item.id}
                    className={[
                      'inline-flex min-h-11 shrink-0 items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                      item.hasVoted
                        ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                        : 'border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
                    ].join(' ')}
                  >
                    {item.hasVoted ? 'Voted' : 'Vote'} ({item.voteCount})
                  </button>
                </div>
                {item.comments?.length ? (
                  <div className="mt-4 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                      Platform comments
                    </p>
                    <div className="mt-3 space-y-3">
                      {item.comments.map((comment) => (
                        <div key={comment.id} className="rounded-2xl bg-[var(--panel-alt)] px-4 py-3">
                          <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{comment.message}</p>
                          <p className="mt-2 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                            Platform admin | {formatDate(comment.createdAt)}
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
              onPageChange={setFeedbackPage}
              pageSize={FEEDBACK_PAGE_SIZE}
              totalItems={feedbackItems.length}
            />
          </div>
        )}
      </SectionCard>
    </div>
  )
}
