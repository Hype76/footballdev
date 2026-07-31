import { useEffect, useMemo, useRef, useState } from 'react'
import { StartMatchConfirmModal } from './StartMatchConfirmModal.jsx'
import {
  addPracticeGoal,
  advancePracticeMatch,
  getPracticeElapsedSeconds,
  loadPracticeSession,
  pausePracticeTimer,
  resetPracticeSession,
  resumePracticeTimer,
  savePracticeSession,
  setPracticeGuideDismissed,
  startPracticeMatch,
} from '../../lib/matchday-practice.js'

const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10'

function getStorage() {
  return typeof window === 'undefined' ? null : window.localStorage
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function getPhaseLabel(phase) {
  const labels = {
    pre_match: 'Pre-match',
    first_half: 'First half',
    half_time: 'Half-time',
    second_half: 'Second half',
    full_time: 'Full-time',
    completed: 'Practice complete',
  }

  return labels[phase] || 'Practice match'
}

function getAdvanceLabel(phase) {
  const labels = {
    first_half: 'Go to half-time',
    half_time: 'Start second half',
    second_half: 'Go to full-time',
    full_time: 'Conclude practice',
  }

  return labels[phase] || ''
}

function getGuideTasks(session) {
  const hasTeamGoal = session.events.some((event) => event.type === 'goal' && event.side === 'team')
  const hasSyntheticScorer = session.events.some((event) => event.type === 'goal' && String(event.playerId || '').startsWith('practice-player-'))
  const hasOpponentGoal = session.events.some((event) => event.type === 'goal' && event.side === 'opponent')
  const hasPauseResume = session.events.some((event) => event.type === 'timer_paused')
    && session.events.some((event) => event.type === 'timer_resumed')
  const reachedHalfTime = ['half_time', 'second_half', 'full_time', 'completed'].includes(session.match.currentMatchPhase)

  return [
    { id: 'start', label: 'Start the practice match', complete: session.match.currentMatchPhase !== 'pre_match' },
    { id: 'team-goal', label: 'Record a team goal', complete: hasTeamGoal },
    { id: 'scorer', label: 'Select a synthetic goalscorer', complete: hasSyntheticScorer },
    { id: 'opponent-goal', label: 'Record an opposition goal', complete: hasOpponentGoal },
    { id: 'timer', label: 'Pause and resume the timer', complete: hasPauseResume },
    { id: 'half-time', label: 'Move through half-time', complete: reachedHalfTime },
    { id: 'complete', label: 'Reach full-time and conclude practice', complete: session.match.currentMatchPhase === 'completed' },
  ]
}

export function PracticeMatchEntryCard({ hasTodayMatch = false, onOpen }) {
  return (
    <section
      aria-labelledby="practice-match-entry-title"
      className={`${hasTodayMatch ? 'border-[#d7e5dc] bg-[#f7faf8]' : 'border-[#86efac] bg-[#ecfdf5]'} rounded-lg border p-4 shadow-sm shadow-[#047857]/10 sm:p-5`}
      data-testid="practice-match-entry"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Private practice</p>
          <h2 id="practice-match-entry-title" className="mt-1 text-xl font-black tracking-tight text-[#101828]">
            Practice Match Scoring
          </h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
            Learn how Game Mode works before scoring a real fixture. Synthetic teams and players are used. Nothing is shared, no real team data is affected, and no notifications are sent.
          </p>
          {hasTodayMatch ? (
            <p className="mt-2 text-xs font-bold text-[#4b5f55]">Today&apos;s real fixture remains the priority above.</p>
          ) : null}
        </div>
        <button type="button" onClick={onOpen} className={hasTodayMatch ? secondaryButtonClass : primaryButtonClass}>
          Start practice match
        </button>
      </div>
    </section>
  )
}

export function PracticeMatchScoring({ onExit, parentIdentity }) {
  const identity = String(parentIdentity ?? '').trim()
  const [session, setSession] = useState(() => loadPracticeSession(getStorage(), identity))
  const [now, setNow] = useState(() => Date.now())
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [isStartModalOpen, setIsStartModalOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const startActivationRef = useRef(false)

  useEffect(() => {
    try {
      savePracticeSession(getStorage(), identity, session)
    } catch {
      // The in-memory practice session remains usable when browser storage is unavailable.
    }
  }, [identity, session])

  useEffect(() => {
    if (session.match.timerStatus !== 'running') {
      return undefined
    }

    const intervalId = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [session.match.timerStatus])

  const elapsedSeconds = getPracticeElapsedSeconds(session, now)
  const guideTasks = useMemo(() => getGuideTasks(session), [session])
  const completedTaskCount = guideTasks.filter((task) => task.complete).length
  const phase = session.match.currentMatchPhase
  const isComplete = phase === 'completed'

  const updateSession = (updater) => {
    setErrorMessage('')
    setSession((current) => updater(current))
    setNow(Date.now())
  }

  const handleStart = () => {
    if (startActivationRef.current) {
      return
    }

    startActivationRef.current = true
    setIsStarting(true)
    updateSession((current) => startPracticeMatch(current))
    setIsStartModalOpen(false)
    window.setTimeout(() => {
      startActivationRef.current = false
      setIsStarting(false)
    }, 0)
  }

  const handleGoal = (side) => {
    try {
      updateSession((current) => addPracticeGoal(current, {
        playerId: selectedPlayerId,
        side,
      }))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The practice goal could not be recorded.')
    }
  }

  const handleReset = () => {
    updateSession((current) => resetPracticeSession(current))
    setSelectedPlayerId('')
    setIsStartModalOpen(false)
  }

  return (
    <div
      className="parent-portal-theme-scope space-y-4 pb-12 sm:space-y-5"
      data-practice-boundary="browser-only"
      data-testid="practice-match-scoring"
    >
      <header className="rounded-lg border border-[#86efac] bg-[#ecfdf5] p-4 shadow-sm shadow-[#047857]/10 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Private practice</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-[#101828] sm:text-3xl">Practice Match Scoring</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
              This session uses synthetic teams and players in this browser only. Nothing is shared, no real fixture or statistic is changed, and no email, push notification, or SMS is sent.
            </p>
          </div>
          <button type="button" onClick={onExit} className={secondaryButtonClass}>Exit practice</button>
        </div>
      </header>

      {errorMessage ? (
        <div role="alert" className="rounded-lg border border-[#fecdca] bg-[#fff4f3] px-4 py-3 text-sm font-bold text-[#9b1c17]">
          {errorMessage}
        </div>
      ) : null}

      {!session.guideDismissed && !isComplete ? (
        <section aria-labelledby="practice-guide-title" className={panelClass} data-testid="practice-guide">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Guided walkthrough</p>
              <h2 id="practice-guide-title" className="mt-1 text-xl font-black text-[#101828]">Learn the scorer journey</h2>
              <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{completedTaskCount} of {guideTasks.length} tasks complete</p>
            </div>
            <button
              type="button"
              onClick={() => updateSession((current) => setPracticeGuideDismissed(current, true))}
              className={secondaryButtonClass}
            >
              Dismiss guide
            </button>
          </div>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2">
            {guideTasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-sm font-bold text-[#334155]">
                <span aria-hidden="true" className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${task.complete ? 'bg-[#047857] text-white' : 'border border-[#98a2b3] bg-white text-[#4b5f55]'}`}>
                  {task.complete ? 'OK' : guideTasks.findIndex((candidate) => candidate.id === task.id) + 1}
                </span>
                <span>{task.label}</span>
                <span className="sr-only">{task.complete ? 'Complete' : 'Not complete'}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <main className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <section aria-labelledby="practice-game-mode-title" className={`${panelClass} min-w-0`} data-testid="practice-game-mode">
          <div className="flex flex-col gap-3 border-b border-[#d7e5dc] pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Game Mode</p>
              <h2 id="practice-game-mode-title" className="mt-1 text-xl font-black text-[#101828]">Practice Rovers v Training United</h2>
              <p className="mt-1 text-sm font-semibold text-[#4b5f55]">Synthetic practice fixture</p>
            </div>
            <span className="inline-flex w-fit rounded-full border border-[#86efac] bg-[#ecfdf5] px-3 py-1 text-xs font-black uppercase tracking-wide text-[#065f46]">
              Practice only
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 text-center">
              <p className="text-xs font-black uppercase tracking-wide text-[#4b5f55]">Score</p>
              <p className="mt-2 text-4xl font-black tabular-nums text-[#101828]" aria-live="polite">
                {session.match.homeScore} - {session.match.awayScore}
              </p>
            </div>
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 text-center">
              <p className="text-xs font-black uppercase tracking-wide text-[#4b5f55]">Match clock</p>
              <p className="mt-2 text-4xl font-black tabular-nums text-[#101828]" data-testid="practice-timer">{formatClock(elapsedSeconds)}</p>
            </div>
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 text-center">
              <p className="text-xs font-black uppercase tracking-wide text-[#4b5f55]">Phase</p>
              <p className="mt-3 text-lg font-black text-[#101828]">{getPhaseLabel(phase)}</p>
            </div>
          </div>

          {phase === 'pre_match' ? (
            <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4" data-testid="practice-pre-match">
              <h3 className="text-lg font-black text-[#101828]">Ready to practise?</h3>
              <p className="mt-1 text-sm font-semibold leading-6 text-[#4b5f55]">
                Game Mode is open, but scoring and timer controls stay unavailable until you confirm Start match.
              </p>
              <button type="button" onClick={() => setIsStartModalOpen(true)} className={`${primaryButtonClass} mt-4`}>
                Start practice match
              </button>
            </div>
          ) : null}

          {['first_half', 'second_half'].includes(phase) ? (
            <div className="mt-4 space-y-4" data-testid="practice-live-controls">
              <div className="grid gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-wide text-[#4b5f55]">Synthetic goalscorer</span>
                  <select
                    value={selectedPlayerId}
                    onChange={(event) => setSelectedPlayerId(event.target.value)}
                    className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-semibold text-[#101828] outline-none focus:border-[#047857] focus:ring-2 focus:ring-[#bbf7d0]"
                  >
                    <option value="">Choose a practice player</option>
                    {session.players.map((player) => (
                      <option key={player.id} value={player.id}>{player.playerName} #{player.shirtNumber}</option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => handleGoal('team')} className={primaryButtonClass}>Record team goal</button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <button type="button" onClick={() => handleGoal('opponent')} className={secondaryButtonClass}>Record opposition goal</button>
                {session.match.timerStatus === 'running' ? (
                  <button type="button" onClick={() => updateSession((current) => pausePracticeTimer(current))} className={secondaryButtonClass}>Pause timer</button>
                ) : (
                  <button type="button" onClick={() => updateSession((current) => resumePracticeTimer(current))} className={secondaryButtonClass}>Resume timer</button>
                )}
                <button type="button" onClick={() => updateSession((current) => advancePracticeMatch(current))} className={primaryButtonClass}>
                  {getAdvanceLabel(phase)}
                </button>
              </div>
            </div>
          ) : null}

          {phase === 'half_time' || phase === 'full_time' ? (
            <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4" data-testid={`practice-${phase.replace('_', '-')}`}>
              <h3 className="text-lg font-black text-[#101828]">{getPhaseLabel(phase)}</h3>
              <p className="mt-1 text-sm font-semibold leading-6 text-[#4b5f55]">
                {phase === 'half_time' ? 'The timer is paused. Continue when the second half begins.' : 'The match has reached full-time. Conclude practice when you are ready.'}
              </p>
              <button type="button" onClick={() => updateSession((current) => advancePracticeMatch(current))} className={`${primaryButtonClass} mt-4`}>
                {getAdvanceLabel(phase)}
              </button>
            </div>
          ) : null}

          {isComplete ? (
            <div className="mt-4 rounded-lg border border-[#86efac] bg-[#ecfdf5] p-5" role="status" data-testid="practice-complete">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Practice complete</p>
              <h3 className="mt-1 text-xl font-black text-[#101828]">Nothing from this match was shared or added to your team&apos;s records.</h3>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={handleReset} className={primaryButtonClass}>Practise again</button>
                <button type="button" onClick={onExit} className={secondaryButtonClass}>Exit practice</button>
              </div>
            </div>
          ) : null}
        </section>

        <aside aria-labelledby="practice-timeline-title" className={`${panelClass} min-w-0`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Private timeline</p>
              <h2 id="practice-timeline-title" className="mt-1 text-xl font-black text-[#101828]">Practice events</h2>
            </div>
            {!isComplete ? <button type="button" onClick={handleReset} className={secondaryButtonClass}>Reset</button> : null}
          </div>
          {session.events.length > 0 ? (
            <ol className="mt-4 space-y-2" data-testid="practice-event-list">
              {[...session.events].reverse().map((event) => (
                <li key={event.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-black text-[#101828]">{event.label}</p>
                    {event.minute ? <span className="text-xs font-bold text-[#4b5f55]">{event.minute}&apos;</span> : null}
                  </div>
                  {event.type === 'goal' ? (
                    <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Practice score: {event.homeScore} - {event.awayScore}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-semibold leading-6 text-[#4b5f55]">
              Start the practice match to build a private event timeline.
            </p>
          )}
        </aside>
      </main>

      <StartMatchConfirmModal
        isBusy={isStarting}
        isOpen={isStartModalOpen}
        match={session.match}
        onCancel={() => setIsStartModalOpen(false)}
        onConfirm={handleStart}
        scorerLabel="Practice scorer"
      />
    </div>
  )
}
