import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-development-logo-optimized.jpg'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { StatusBadge } from '../components/ui/StatusBadge.jsx'
import { canDeletePlayer, canShareEvaluation, useAuth } from '../lib/auth.js'
import {
  EVALUATION_SECTIONS,
  deletePlayerRecord,
  deletePlayer,
  getEvaluations,
  getPlayers,
  readViewCache,
  readViewCacheValue,
  updatePlayer,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

function buildEvaluationSummary(evaluation, mode = 'scored') {
  if (mode === 'email') {
    return (
      evaluation.comments?.overall ||
      evaluation.comments?.strengths ||
      evaluation.comments?.improvements ||
      'No written summary provided.'
    )
  }

  const responseEntries = Object.entries(evaluation.formResponses ?? {})

  if (responseEntries.length > 0) {
    return responseEntries
      .slice(0, 4)
      .map(([label, value]) => `${label}: ${value}`)
      .join(', ')
  }

  return (
    evaluation.comments?.overall ||
    evaluation.comments?.strengths ||
    evaluation.comments?.improvements ||
    'No written summary provided.'
  )
}

function buildParentEmailLink(playerName, evaluation) {
  if (!evaluation.parentEmail) {
    return ''
  }

  const summary = buildEvaluationSummary(evaluation, 'email')
  const body = [
    `Player: ${playerName}`,
    `Section: ${evaluation.section || 'Trial'}`,
    evaluation.session ? `Session: ${evaluation.session}` : null,
    `Summary: ${summary}`,
    `Decision: ${evaluation.decision || 'Progress'}`,
    '',
    'A PDF download option is also available in the system for sharing feedback.',
  ]
    .filter(Boolean)
    .join('\n')

  const subject = encodeURIComponent('Player Trial Feedback')
  return `mailto:${encodeURIComponent(evaluation.parentEmail)}?subject=${subject}&body=${encodeURIComponent(body)}`
}

export function PlayerProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const routePlayerName = decodeURIComponent(id)
  const cacheKey = user ? `player:${user.id}:${user.clubId || 'platform'}:${routePlayerName}` : ''
  const [evaluations, setEvaluations] = useState(() => {
    const cachedEvaluations = readViewCacheValue(cacheKey, 'evaluations', [])
    return Array.isArray(cachedEvaluations) ? cachedEvaluations : []
  })
  const [players, setPlayers] = useState(() => {
    const cachedPlayers = readViewCacheValue(cacheKey, 'players', [])
    return Array.isArray(cachedPlayers) ? cachedPlayers : []
  })
  const [editingPlayerId, setEditingPlayerId] = useState('')
  const [playerDrafts, setPlayerDrafts] = useState({})
  const [isLoading, setIsLoading] = useState(() => evaluations.length === 0)
  const [isSavingPlayer, setIsSavingPlayer] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [pdfLoadingId, setPdfLoadingId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || 'platform'}:${user.role}:${user.roleRank}` : ''

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadEvaluations = async () => {
      setErrorMessage('')

      try {
        const [evaluationsResult, playersResult] = await Promise.allSettled([
          withRequestTimeout(
            () =>
              getEvaluations({
                user,
                playerName: routePlayerName,
              }),
            'Could not load player history. No data entered yet, or the request took too long.',
          ),
          withRequestTimeout(() => getPlayers({ user, playerName: routePlayerName }), 'Could not load player details.'),
        ])

        if (!isMounted) {
          return
        }

        const nextEvaluations = evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : []
        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : []

        if (evaluationsResult.status === 'rejected') {
          console.error(evaluationsResult.reason)
        }

        if (playersResult.status === 'rejected') {
          console.error(playersResult.reason)
        }

        setEvaluations(nextEvaluations)
        setPlayers(nextPlayers)
        setPlayerDrafts(Object.fromEntries(nextPlayers.map((player) => [player.id, player])))
        writeViewCache(cacheKey, {
          evaluations: nextEvaluations,
          players: nextPlayers,
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          if (!cachedValue?.evaluations) {
            setEvaluations([])
          }
          if (!cachedValue?.players) {
            setPlayers([])
          }
          setErrorMessage('Could not load player history.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadEvaluations()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, routePlayerName, user, userScopeKey])

  const scoredEvaluations = useMemo(
    () => evaluations.filter((evaluation) => evaluation.averageScore !== null),
    [evaluations],
  )
  const overallAverage =
    scoredEvaluations.length > 0
      ? scoredEvaluations.reduce((sum, evaluation) => sum + evaluation.averageScore, 0) / scoredEvaluations.length
      : null

  const lastSection = evaluations[0]?.section || 'Trial'
  const lastTeam = evaluations[0]?.team || ''
  const primaryPlayer = players[0]
  const profileParentName = primaryPlayer?.parentName || evaluations.find((evaluation) => evaluation.parentName)?.parentName || ''
  const profileParentEmail = primaryPlayer?.parentEmail || evaluations.find((evaluation) => evaluation.parentEmail)?.parentEmail || ''

  const handleDownloadPdf = async (evaluation, mode) => {
    setPdfLoadingId(`${evaluation.id}:${mode}`)
    setErrorMessage('')

    try {
      const { exportEvaluationPdf } = await import('../lib/pdf.js')
      const summary = buildEvaluationSummary(evaluation, mode)

      await exportEvaluationPdf({
        filename: `${routePlayerName}-${mode}.pdf`,
        mode,
        previewProps: {
          clubName: user?.clubName || user?.team || 'Club Name',
          logoUrl: user?.clubLogoUrl || fallbackLogo,
          playerName: routePlayerName,
          team: evaluation.team,
          section: evaluation.section,
          session: evaluation.session,
          decision: evaluation.decision,
          summary,
          responseItems:
            mode === 'scored'
              ? Object.entries(evaluation.formResponses ?? {}).map(([label, value]) => ({
                  label,
                  value,
                }))
              : [],
        },
      })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not generate the PDF.')
    } finally {
      setPdfLoadingId('')
    }
  }

  const handlePlayerDraftChange = (playerId, fieldName, value) => {
    setErrorMessage('')
    setPlayerDrafts((current) => ({
      ...current,
      [playerId]: {
        ...current[playerId],
        [fieldName]: value,
      },
    }))
  }

  const handleSavePlayer = async (playerId) => {
    const draft = playerDrafts[playerId]

    if (!draft) {
      return
    }

    setIsSavingPlayer(true)
    setErrorMessage('')

    try {
      const savedPlayer = await updatePlayer({
        user,
        playerId,
        player: draft,
      })
      const nextPlayers = players.map((player) => (player.id === playerId ? savedPlayer : player))
      setPlayers(nextPlayers)
      setPlayerDrafts(Object.fromEntries(nextPlayers.map((player) => [player.id, player])))
      writeViewCache(cacheKey, {
        evaluations,
        players: nextPlayers,
      })
      setEditingPlayerId('')

      if (savedPlayer.playerName !== routePlayerName) {
        navigate(`/player/${encodeURIComponent(savedPlayer.playerName)}`)
      }
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save player details.')
    } finally {
      setIsSavingPlayer(false)
    }
  }

  const handleDeletePlayerRecord = async (playerId) => {
    if (!window.confirm('Delete this player record? Assessments will remain in history.')) {
      return
    }

    setIsSavingPlayer(true)
    setErrorMessage('')

    try {
      await deletePlayerRecord({ user, playerId })
      const nextPlayers = players.filter((player) => player.id !== playerId)
      setPlayers(nextPlayers)
      setPlayerDrafts(Object.fromEntries(nextPlayers.map((player) => [player.id, player])))
      writeViewCache(cacheKey, {
        evaluations,
        players: nextPlayers,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not delete player details.')
    } finally {
      setIsSavingPlayer(false)
    }
  }

  const handleDeletePlayer = async () => {
    if (!window.confirm(`Delete all saved evaluations for ${routePlayerName}?`)) {
      return
    }

    setIsDeleting(true)
    setErrorMessage('')

    try {
      await deletePlayer(routePlayerName, user)
      sessionStorage.removeItem(`view-cache:${cacheKey}`)
      navigate('/dashboard')
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not delete this player.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Player Profile"
        title={routePlayerName}
        description="Review the evaluation history for this player with club-scoped Supabase visibility."
      />

      {errorMessage ? (
        <NoticeBanner
          title="Player history is unavailable right now"
          message="We could not refresh this player's saved assessments. If no history has been entered yet, this page will remain empty."
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Player name</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{routePlayerName}</p>
        </div>
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Total evaluations</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{evaluations.length}</p>
        </div>
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Average score</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">
            {overallAverage !== null ? overallAverage.toFixed(1) : '-'}
          </p>
        </div>
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Latest section</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{lastSection}</p>
        </div>
      </div>

      <SectionCard
        title="Player details"
        description="Edit section, team, and parent contact details here. Promotion to Squad requires an approved Trial evaluation when approval is enabled for the team."
      >
        {players.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No saved player details yet. This profile was created from assessment history.
          </div>
        ) : (
          <div className="space-y-4">
            {players.map((player) => {
              const draft = playerDrafts[player.id] ?? player
              const isEditing = editingPlayerId === player.id

              return (
                <div key={player.id} className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                  {isEditing ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player Name</span>
                        <input
                          value={draft.playerName}
                          onChange={(event) => handlePlayerDraftChange(player.id, 'playerName', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Section</span>
                        <select
                          value={draft.section}
                          onChange={(event) => handlePlayerDraftChange(player.id, 'section', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        >
                          {EVALUATION_SECTIONS.map((section) => (
                            <option key={section} value={section}>
                              {section}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
                        <input
                          value={draft.team}
                          onChange={(event) => handlePlayerDraftChange(player.id, 'team', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Parent Name</span>
                        <input
                          value={draft.parentName}
                          onChange={(event) => handlePlayerDraftChange(player.id, 'parentName', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Parent Email</span>
                        <input
                          type="email"
                          value={draft.parentEmail}
                          onChange={(event) => handlePlayerDraftChange(player.id, 'parentEmail', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                      </label>
                      <div className="flex items-end gap-3">
                        <button
                          type="button"
                          disabled={isSavingPlayer}
                          onClick={() => void handleSavePlayer(player.id)}
                          className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={isSavingPlayer}
                          onClick={() => setEditingPlayerId('')}
                          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Section</p>
                          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{player.section}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Team</p>
                          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{player.team || 'No team entered'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Parent Name</p>
                          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{player.parentName || 'No parent name entered'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Parent Email</p>
                          <p className="mt-2 break-words text-sm font-semibold text-[var(--text-primary)]">{player.parentEmail || 'No parent email entered'}</p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => setEditingPlayerId(player.id)}
                          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                        >
                          Edit Details
                        </button>
                        {canDeletePlayer(user) ? (
                          <button
                            type="button"
                            disabled={isSavingPlayer}
                            onClick={() => void handleDeletePlayerRecord(player.id)}
                            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Delete Record
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          to={`/create?player=${encodeURIComponent(routePlayerName)}&team=${encodeURIComponent(lastTeam)}&section=${encodeURIComponent(lastSection)}`}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
        >
          Add New Evaluation
        </Link>
        {canDeletePlayer(user) ? (
          <button
            type="button"
            disabled={isDeleting}
            onClick={handleDeletePlayer}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeleting ? 'Deleting...' : 'Delete Player'}
          </button>
        ) : null}
      </div>

      <SectionCard
        title="Past evaluations"
        description="History is scoped by club and role, with sharing actions available on each evaluation."
      >
        {isLoading ? (
          <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-6 py-10 text-center text-sm font-medium text-[var(--text-muted)]">
            Loading player history...
          </div>
        ) : evaluations.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-6 py-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Player History</p>
            <p className="mt-3 text-xl font-semibold text-[var(--text-primary)]">No history for this player yet</p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              Once evaluations are saved for this player, the full review trail will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {evaluations.map((evaluation) => {
              const responseItems = Object.entries(evaluation.formResponses ?? {}).map(([label, value]) => ({
                label,
                value,
              }))
              const summary = buildEvaluationSummary(evaluation)
              const canShare = canShareEvaluation(user, evaluation)

              return (
                <div
                  key={evaluation.id}
                  className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 sm:p-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-lg font-semibold text-[var(--text-primary)]">{evaluation.date || 'No date entered'}</p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">Decision: {evaluation.decision}</p>
                      {evaluation.session ? <p className="mt-1 text-sm text-[var(--text-muted)]">Session: {evaluation.session}</p> : null}
                      <p className="mt-1 text-sm text-[var(--text-muted)]">Section: {evaluation.section || 'Trial'}</p>
                    </div>
                    <StatusBadge status={evaluation.status} />
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <button
                      type="button"
                      onClick={() => void handleDownloadPdf(evaluation, 'scored')}
                      disabled={pdfLoadingId === `${evaluation.id}:scored` || !canShare}
                      title={canShare ? 'Download scored PDF' : 'Requires manager approval'}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pdfLoadingId === `${evaluation.id}:scored` ? 'Preparing...' : 'PDF With Scores'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadPdf(evaluation, 'email')}
                      disabled={pdfLoadingId === `${evaluation.id}:email` || !canShare}
                      title={canShare ? 'Download email template PDF' : 'Requires manager approval'}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pdfLoadingId === `${evaluation.id}:email` ? 'Preparing...' : 'Email Template PDF'}
                    </button>
                    {evaluation.parentEmail ? (
                      <a
                        href={canShare ? buildParentEmailLink(routePlayerName, evaluation) : undefined}
                        title={canShare ? 'Send to parent' : 'Requires manager approval'}
                        onClick={(event) => {
                          if (!canShare) {
                            event.preventDefault()
                          }
                        }}
                        className={[
                          'inline-flex min-h-11 items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition',
                          canShare
                            ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)] hover:opacity-90'
                            : 'cursor-not-allowed border border-[var(--border-color)] bg-[var(--panel-soft)] text-[var(--text-muted)]',
                        ].join(' ')}
                      >
                        Send to Parent
                      </a>
                    ) : null}
                  </div>

                  {(evaluation.parentName || evaluation.parentEmail || profileParentName || profileParentEmail) ? (
                    <div className="mt-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Parent details</p>
                      <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                        {evaluation.parentName || profileParentName || 'No parent name entered'}
                        {evaluation.parentEmail || profileParentEmail ? ` | ${evaluation.parentEmail || profileParentEmail}` : ''}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Summary</p>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">{summary}</p>
                  </div>

                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Responses</p>
                    <div className="mt-3 space-y-2">
                      {responseItems.length > 0 ? (
                        responseItems.map((item) => (
                          <div key={item.label} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{item.label}</p>
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">{String(item.value)}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm leading-6 text-[var(--text-muted)]">No responses provided.</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
