import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { CreatePlatformFeedbackSection } from '../components/platform-feedback/CreatePlatformFeedbackSection.jsx'
import { PlatformFeedbackBoardSection } from '../components/platform-feedback/PlatformFeedbackBoardSection.jsx'
import { PlatformFeedbackHero } from '../components/platform-feedback/PlatformFeedbackHero.jsx'
import { PlatformFeedbackStats } from '../components/platform-feedback/PlatformFeedbackStats.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { useToast } from '../components/ui/toast-context.js'
import { canViewPlatformFeedback, isSuperAdmin, useAuth } from '../lib/auth.js'
import { FEEDBACK_PAGE_SIZE, PLATFORM_FEEDBACK_CACHE_KEY, getFeedbackStats } from '../lib/platform-feedback-utils.js'
import {
  createPlatformFeedback,
  getPlatformFeedback,
  readViewCacheValue,
  unvotePlatformFeedback,
  votePlatformFeedback,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

export function PlatformFeedbackPage() {
  const { isLoading: isAuthLoading, isProfileLoading, session, user } = useAuth()
  const { showToast } = useToast()
  const [feedbackItems, setFeedbackItems] = useState(() => {
    const cachedItems = readViewCacheValue(PLATFORM_FEEDBACK_CACHE_KEY, 'feedbackItems', [])
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
    writeViewCache(PLATFORM_FEEDBACK_CACHE_KEY, {
      feedbackItems: nextItems,
    })
  }

  useEffect(() => {
    let isMounted = true

    const runLoad = async () => {
      if (!canViewPlatformFeedback(user)) {
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
        writeViewCache(PLATFORM_FEEDBACK_CACHE_KEY, {
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
      showToast({ title: 'Feedback saved', message: 'Your platform feedback has been submitted.' })
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
      showToast({ title: 'Vote saved', message: item.hasVoted ? 'Your vote has been removed.' : 'Your vote has been added.' })
    } catch (error) {
      console.error(error)
      setErrorMessage('Vote could not be saved.')
    } finally {
      setActiveVoteId('')
    }
  }

  const paginatedFeedback = getPaginatedItems(feedbackItems, feedbackPage, FEEDBACK_PAGE_SIZE)
  const feedbackStats = getFeedbackStats(feedbackItems)

  if ((isAuthLoading && !session?.user) || (!user && isProfileLoading)) {
    return (
      <div className="rounded-lg border border-[#d7e5dc] bg-white px-5 py-8 text-sm font-bold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
        Loading...
      </div>
    )
  }

  if (!canViewPlatformFeedback(user)) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {successMessage ? (
        <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#047857] shadow-sm shadow-[#047857]/10">
          {successMessage}
        </div>
      ) : null}

      {errorMessage ? <NoticeBanner title="Feedback action failed" message={errorMessage} /> : null}

      <PlatformFeedbackHero isLoading={isLoading} />

      <PlatformFeedbackStats feedbackStats={feedbackStats} />

      {isSuperAdmin(user) ? null : (
        <CreatePlatformFeedbackSection
          isSaving={isSaving}
          message={message}
          onMessageChange={(nextMessage) => {
            setMessage(nextMessage)
            setErrorMessage('')
            setSuccessMessage('')
          }}
          onSubmit={handleSubmit}
        />
      )}

      <PlatformFeedbackBoardSection
        activeVoteId={activeVoteId}
        feedbackItems={feedbackItems}
        feedbackPage={feedbackPage}
        isLoading={isLoading}
        onPageChange={setFeedbackPage}
        onVote={handleVote}
        paginatedFeedback={paginatedFeedback}
      />
    </div>
  )
}
