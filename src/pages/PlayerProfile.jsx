import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-development-logo-optimized.jpg'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { StatusBadge } from '../components/ui/StatusBadge.jsx'
import { canDeletePlayer, canShareEvaluation, useAuth } from '../lib/auth.js'
import { buildEvaluationSummary, exportEvaluationPdf } from '../lib/pdf.js'
import { deletePlayer, getEvaluations, withRequestTimeout } from '../lib/supabase.js'

function buildParentEmailLink(playerName, evaluation) {
  if (!evaluation.parentEmail) {
    return ''
  }

  const summary = buildEvaluationSummary(evaluation)
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
  const [evaluations, setEvaluations] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [pdfLoadingId, setPdfLoadingId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadEvaluations = async () => {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const nextEvaluations = await withRequestTimeout(
          () =>
            getEvaluations({
              user,
              playerName: routePlayerName,
            }),
          'Could not load player history. No data entered yet, or the request took too long.',
        )

        if (!isMounted) {
          return
        }

        setEvaluations(nextEvaluations)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setEvaluations([])
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
  }, [routePlayerName, user])

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

  const handleDownloadPdf = async (evaluation, mode) => {
    setPdfLoadingId(`${evaluation.id}:${mode}`)
    setErrorMessage('')

    try {
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
          summary: buildEvaluationSummary(evaluation),
          responseItems: Object.entries(evaluation.formResponses ?? {}).map(([label, value]) => ({
            label,
            value,
          })),
        },
      })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not generate the PDF.')
    } finally {
      setPdfLoadingId('')
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
        <div className="rounded-[20px] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger-text)]">
          {errorMessage}
        </div>
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
