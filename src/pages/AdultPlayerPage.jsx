import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/auth.js'
import {
  getOwnAdultPlayerInvitations,
  respondToOwnAdultPlayerInvitation,
} from '../lib/domain/adult-player.js'

const matchResponses = [
  { value: 'available', label: 'Available' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'unavailable', label: 'Unavailable' },
]

const trainingResponses = [
  { value: 'available', label: 'Attending' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'unavailable', label: 'Not attending' },
]

function formatEventDate(value) {
  if (!value) {
    return 'Date to be confirmed'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Date to be confirmed'
  }

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function responseLabel(invitation) {
  const labels = invitation.invitationType === 'training_attendance'
    ? trainingResponses
    : matchResponses
  return labels.find((option) => option.value === invitation.responseState)?.label
    || (invitation.responseState === 'awaiting_response' ? 'Awaiting response' : invitation.responseState)
}

function InvitationCard({ invitation, isSaving, onRespond }) {
  const options = invitation.invitationType === 'training_attendance'
    ? trainingResponses
    : invitation.invitationType === 'match_attendance'
      ? matchResponses
      : []

  return (
    <article className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
            {invitation.eventType === 'match_day' ? 'Match' : invitation.eventType === 'training' ? 'Training' : 'Calendar'}
          </p>
          <h2 className="mt-2 text-xl font-black text-slate-950">{invitation.eventTitle}</h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">{formatEventDate(invitation.eventStart)}</p>
          {invitation.eventLocation ? <p className="mt-1 text-sm text-slate-600">{invitation.eventLocation}</p> : null}
          {invitation.teamName ? <p className="mt-1 text-sm text-slate-500">{invitation.teamName}</p> : null}
        </div>
        <div className="shrink-0 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-800">
          {responseLabel(invitation)}
        </div>
      </div>

      {invitation.selectionState === 'selected' ? (
        <p className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900">
          You are selected for this fixture.
        </p>
      ) : null}

      {options.length > 0 && invitation.canRespond ? (
        <div className="mt-5 grid gap-2 sm:grid-cols-3" aria-label={`Respond to ${invitation.eventTitle}`}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={isSaving}
              onClick={() => onRespond(invitation, option.value)}
              className={[
                'min-h-11 rounded-xl border px-4 py-2 text-sm font-black transition disabled:cursor-wait disabled:opacity-60',
                invitation.responseState === option.value
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-emerald-200 bg-white text-emerald-800 hover:border-emerald-600 hover:bg-emerald-50',
              ].join(' ')}
            >
              {isSaving ? 'Saving...' : option.label}
            </button>
          ))}
        </div>
      ) : null}

      {!invitation.canRespond && invitation.lockReason ? (
        <p className="mt-4 text-sm font-semibold text-slate-600">{invitation.lockReason}</p>
      ) : null}
    </article>
  )
}

export function AdultPlayerPage() {
  const { signOut, user } = useAuth()
  const [invitations, setInvitations] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const loadInvitations = useCallback(async () => {
    setIsLoading(true)
    setError('')

    try {
      setInvitations(await getOwnAdultPlayerInvitations())
    } catch (loadError) {
      console.error(loadError)
      setError(loadError.message || 'Your invitations could not be loaded.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadInvitations()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadInvitations])

  const upcomingInvitations = invitations

  const handleRespond = async (invitation, responseState) => {
    setSavingId(invitation.invitationId)
    setNotice('')
    setError('')

    try {
      await respondToOwnAdultPlayerInvitation({ invitation, responseState })
      setNotice('Your response has been saved.')
      await loadInvitations()
    } catch (responseError) {
      console.error(responseError)
      setError(responseError.message || 'Your response could not be saved.')
    } finally {
      setSavingId('')
    }
  }

  const handleSignOut = async () => {
    await signOut()
    window.location.assign('/sign-in')
  }

  return (
    <div className="mx-auto min-h-[calc(100vh-2.5rem)] max-w-5xl py-2 sm:py-5">
      <header className="rounded-2xl bg-slate-950 px-5 py-6 text-white shadow-xl shadow-slate-950/10 sm:px-8 sm:py-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Player account</p>
            <h1 className="mt-3 text-3xl font-black sm:text-4xl">{user?.selectedPlayerName || user?.displayName || 'Player'}</h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-300">
              View your own invitations and manage your availability. This account cannot open Parent, Coach, or administration tools.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="min-h-11 shrink-0 rounded-xl border border-slate-700 px-4 py-2 text-sm font-black text-white hover:border-slate-500 hover:bg-slate-900"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mt-6">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Calendar and RSVP</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Your invitations</h2>
          </div>
          <button
            type="button"
            onClick={() => void loadInvitations()}
            disabled={isLoading}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-800 hover:border-emerald-400 disabled:opacity-60"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {notice ? <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">{notice}</p> : null}
        {error ? <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">{error}</p> : null}

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-600">
            Loading your invitations...
          </div>
        ) : upcomingInvitations.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <p className="text-lg font-black text-slate-950">No upcoming invitations</p>
            <p className="mt-2 text-sm font-semibold text-slate-600">New match, training, and Calendar invitations will appear here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {upcomingInvitations.map((invitation) => (
              <InvitationCard
                key={invitation.invitationId}
                invitation={invitation}
                isSaving={savingId === invitation.invitationId}
                onRespond={handleRespond}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

export default AdultPlayerPage
