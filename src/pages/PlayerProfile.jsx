import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-development-logo-optimized.jpg'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canDeletePlayer, canShareEvaluation, useAuth } from '../lib/auth.js'
import {
  PARENT_EMAIL_TEMPLATES,
  buildParentEmailTemplate,
  getEmailTemplateKey,
  isInviteEmailTemplate,
} from '../lib/email-templates.js'
import {
  buildEvaluationSummary,
  buildFieldMovement,
  buildRatingTrend,
  createPlayerDraft,
  formatTrendDate,
  getEditableParentContacts,
  getLatestClubLogoUrl,
} from '../hooks/players/playerProfileUtils.js'
import {
  EVALUATION_SECTIONS,
  createCommunicationLog,
  deletePlayer,
  getEvaluations,
  getPlayers,
  formatParentContactEmails,
  formatParentContactNames,
  normalizeParentContacts,
  clearViewCaches,
  promotePlayerToSquad,
  readViewCache,
  readViewCacheValue,
  updatePlayer,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

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
  const [isPromotingId, setIsPromotingId] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [pdfLoadingId, setPdfLoadingId] = useState('')
  const [selectedEmailTemplates, setSelectedEmailTemplates] = useState({})
  const [selectedParentContacts, setSelectedParentContacts] = useState({})
  const [selectedInviteDates, setSelectedInviteDates] = useState({})
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
        setPlayerDrafts(Object.fromEntries(nextPlayers.map((player) => [player.id, createPlayerDraft(player)])))
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
  const ratingTrend = useMemo(() => buildRatingTrend(evaluations), [evaluations])
  const fieldMovement = useMemo(() => buildFieldMovement(evaluations), [evaluations])
  const ratingTrendMax = ratingTrend.some((evaluation) => Number(evaluation.averageScore) > 5) ? 10 : 5
  const overallAverage =
    scoredEvaluations.length > 0
      ? scoredEvaluations.reduce((sum, evaluation) => sum + evaluation.averageScore, 0) / scoredEvaluations.length
      : null

  const lastSection = evaluations[0]?.section || 'Trial'
  const lastTeam = evaluations[0]?.team || ''
  const primaryPlayer = players[0]
  const profileParentName = primaryPlayer?.parentName || evaluations.find((evaluation) => evaluation.parentName)?.parentName || ''
  const profileParentEmail = primaryPlayer?.parentEmail || evaluations.find((evaluation) => evaluation.parentEmail)?.parentEmail || ''
  const profileParentContacts = normalizeParentContacts(primaryPlayer?.parentContacts, {
    parentName: profileParentName,
    parentEmail: profileParentEmail,
  })

  const getSelectedEmailTemplateKey = (evaluation) =>
    selectedEmailTemplates[evaluation.id] || getEmailTemplateKey(evaluation.decision)
  const getSelectedInviteDate = (evaluation) => selectedInviteDates[evaluation.id] || ''
  const getEvaluationParentContacts = (evaluation) =>
    normalizeParentContacts(evaluation.parentContacts?.length ? evaluation.parentContacts : profileParentContacts, {
      parentName: evaluation.parentName || profileParentName,
      parentEmail: evaluation.parentEmail || profileParentEmail,
    })
  const getSelectedEvaluationParentContacts = (evaluation) => {
    const contacts = getEvaluationParentContacts(evaluation)
    const selectedIndexes = selectedParentContacts[evaluation.id] ?? contacts.map((_, index) => index)
    const nextContacts = contacts.filter((_, index) => selectedIndexes.includes(index))

    return nextContacts.length > 0 ? nextContacts : contacts.slice(0, 1)
  }

  const handleDownloadPdf = async (evaluation, mode) => {
    setPdfLoadingId(`${evaluation.id}:${mode}`)
    setErrorMessage('')

    try {
      const { exportEvaluationPdf } = await import('../lib/pdf.js')
      const latestClubLogoUrl = await getLatestClubLogoUrl(user)
      const summary = buildEvaluationSummary(evaluation, mode)
      const selectedContacts = getSelectedEvaluationParentContacts(evaluation)
      const recipientNames = formatParentContactNames(selectedContacts, evaluation.parentName || profileParentName)
      const recipientEmails = formatParentContactEmails(selectedContacts, evaluation.parentEmail || profileParentEmail)
      const emailTemplate = buildParentEmailTemplate({
        parentName: recipientNames,
        playerName: routePlayerName,
        coachName: evaluation.coach,
        clubName: user?.clubName,
        teamName: evaluation.team,
        session: evaluation.session,
        inviteDate: getSelectedInviteDate(evaluation),
        templateKey: getSelectedEmailTemplateKey(evaluation),
      })

      await exportEvaluationPdf({
        filename: `${routePlayerName}-${mode}.pdf`,
        mode,
        previewProps: {
          clubName: user?.clubName || user?.team || 'Club Name',
          logoUrl: latestClubLogoUrl || fallbackLogo,
          playerName: routePlayerName,
          team: evaluation.team,
          section: evaluation.section,
          session: evaluation.session,
          summary,
          emailSubject: emailTemplate.subject,
          emailBody: emailTemplate.body,
          recipientNames,
          recipientEmails,
          responseItems:
            mode === 'scored'
              ? Object.entries(evaluation.formResponses ?? {}).map(([label, value]) => ({
                  label,
                  value,
                }))
              : [],
        },
      })

      void createCommunicationLog({
        user,
        playerId: evaluation.playerId || primaryPlayer?.id,
        evaluationId: evaluation.id,
        channel: 'pdf',
        action: mode === 'scored' ? 'scored_pdf_downloaded' : 'email_template_pdf_downloaded',
        recipientEmail: recipientEmails,
      }).catch((error) => console.error(error))
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

  const handleStartEditingPlayer = (player) => {
    setErrorMessage('')
    setPlayerDrafts((current) => ({
      ...current,
      [player.id]: createPlayerDraft(current[player.id] ?? player),
    }))
    setEditingPlayerId(player.id)
  }

  const handleParentContactDraftChange = (playerId, index, fieldName, value) => {
    setErrorMessage('')
    setPlayerDrafts((current) => {
      const draft = current[playerId] ?? {}
      const contacts = normalizeParentContacts(draft.parentContacts, {
        parentName: draft.parentName,
        parentEmail: draft.parentEmail,
      })
      const nextContacts = contacts.length > 0 ? contacts : [{ name: '', email: '' }]

      return {
        ...current,
        [playerId]: {
          ...draft,
          parentContacts: nextContacts.map((contact, contactIndex) =>
            contactIndex === index
              ? {
                  ...contact,
                  [fieldName]: value,
                }
              : contact,
          ),
        },
      }
    })
  }

  const handleAddParentContact = (playerId) => {
    setErrorMessage('')
    setPlayerDrafts((current) => {
      const draft = current[playerId] ?? {}
      const contacts = normalizeParentContacts(draft.parentContacts, {
        parentName: draft.parentName,
        parentEmail: draft.parentEmail,
      })

      return {
        ...current,
        [playerId]: {
          ...draft,
          parentContacts: [...contacts, { name: '', email: '' }],
        },
      }
    })
  }

  const handleRemoveParentContact = (playerId, index) => {
    setErrorMessage('')
    setPlayerDrafts((current) => {
      const draft = current[playerId] ?? {}
      const contacts = normalizeParentContacts(draft.parentContacts, {
        parentName: draft.parentName,
        parentEmail: draft.parentEmail,
      })
      const nextContacts = contacts.length > 1 ? contacts.filter((_, contactIndex) => contactIndex !== index) : []

      return {
        ...current,
        [playerId]: {
          ...draft,
          parentContacts: nextContacts.length > 0 ? nextContacts : [{ name: '', email: '' }],
        },
      }
    })
  }

  const handleToggleEvaluationParentContact = (evaluationId, index, contacts) => {
    setSelectedParentContacts((current) => {
      const currentIndexes = current[evaluationId] ?? contacts.map((_, contactIndex) => contactIndex)

      if (currentIndexes.includes(index)) {
        const nextIndexes = currentIndexes.filter((item) => item !== index)
        return {
          ...current,
          [evaluationId]: nextIndexes.length > 0 ? nextIndexes : [index],
        }
      }

      return {
        ...current,
        [evaluationId]: [...currentIndexes, index].sort((left, right) => left - right),
      }
    })
  }

  const handleAddPlayerPosition = (playerId) => {
    const draft = playerDrafts[playerId]
    const nextPosition = String(draft?.positionDraft ?? '').trim()

    if (!nextPosition) {
      return
    }

    setErrorMessage('')
    setPlayerDrafts((current) => ({
      ...current,
      [playerId]: {
        ...current[playerId],
        positions: [...new Set([...(current[playerId]?.positions ?? []), nextPosition])],
        positionDraft: '',
      },
    }))
  }

  const handleRemovePlayerPosition = (playerId, positionToRemove) => {
    setErrorMessage('')
    setPlayerDrafts((current) => ({
      ...current,
      [playerId]: {
        ...current[playerId],
        positions: (current[playerId]?.positions ?? []).filter((position) => position !== positionToRemove),
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
        player: {
          ...draft,
          parentContacts: getEditableParentContacts(draft),
        },
      })
      const nextPlayers = players.map((player) => (player.id === playerId ? savedPlayer : player))
      setPlayers(nextPlayers)
      setPlayerDrafts(Object.fromEntries(nextPlayers.map((player) => [player.id, createPlayerDraft(player)])))
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

  const handlePromotePlayer = async (playerId) => {
    setIsPromotingId(playerId)
    setErrorMessage('')

    try {
      const promotedPlayer = await promotePlayerToSquad({ user, playerId })
      const nextPlayers = players.map((player) => (player.id === playerId ? promotedPlayer : player))
      setPlayers(nextPlayers)
      setPlayerDrafts(Object.fromEntries(nextPlayers.map((player) => [player.id, createPlayerDraft(player)])))
      writeViewCache(cacheKey, {
        evaluations,
        players: nextPlayers,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not promote this player to Squad.')
    } finally {
      setIsPromotingId('')
    }
  }

  const handleDeletePlayer = async () => {
    if (!window.confirm(`Delete ${routePlayerName}? This removes the player record and saved evaluations for this player.`)) {
      return
    }

    setIsDeleting(true)
    setErrorMessage('')

    try {
      await deletePlayer(routePlayerName, user, {
        playerIds: players.map((player) => player.id),
      })
      clearViewCaches()
      navigate('/players', { replace: true })
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
        description="Review the evaluation history for this player with club-scoped visibility."
      />

      {errorMessage ? (
        <NoticeBanner
          title="Player history is unavailable right now"
          message="We could not refresh this player's saved assessments. If no history has been entered yet, this page will remain empty."
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
        title="Rating trend"
        description="Shows how the player's assessment scores are moving over time."
      >
        {ratingTrend.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No scored evaluations yet.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {ratingTrend.map((evaluation) => {
                const scorePercent = Math.max(0, Math.min(100, (Number(evaluation.averageScore) / ratingTrendMax) * 100))

                return (
                  <div key={evaluation.id} className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{formatTrendDate(evaluation)}</p>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{evaluation.averageScore.toFixed(1)}</p>
                    </div>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--panel-soft)]">
                      <div
                        className="h-full rounded-full bg-[var(--button-primary)]"
                        style={{ width: `${scorePercent}%` }}
                      />
                    </div>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                      {evaluation.section || 'Trial'}
                    </p>
                  </div>
                )
              })}
            </div>

            {fieldMovement.length > 0 ? (
              <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Field movement</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {fieldMovement.map((item) => (
                    <div key={item.label} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{item.label}</p>
                      <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                        {item.firstValue} to {item.latestValue}
                      </p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        {item.change > 0 ? '+' : ''}{item.change.toFixed(1)} change
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Player details"
        description="Edit section, team, and parent contact details here."
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
                    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
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
                      <div className="md:col-span-2 xl:col-span-3">
                        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <span className="block text-sm font-semibold text-[var(--text-primary)]">Parent Contacts</span>
                            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                              Add multiple parents or guardians. Each contact can have a separate name and email.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddParentContact(player.id)}
                            className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
                          >
                            Add Another Parent
                          </button>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-2">
                          {getEditableParentContacts(draft).map((contact, index) => (
                            <div key={index} className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
                              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                                Parent {index + 1}
                              </p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="block">
                                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Parent Name</span>
                                  <input
                                    value={contact.name}
                                    onChange={(event) => handleParentContactDraftChange(player.id, index, 'name', event.target.value)}
                                    className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Parent Email</span>
                                  <input
                                    type="email"
                                    value={contact.email}
                                    onChange={(event) => handleParentContactDraftChange(player.id, index, 'email', event.target.value)}
                                    className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                                  />
                                </label>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveParentContact(player.id, index)}
                                className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
                              >
                                Remove Parent
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="md:col-span-2 xl:col-span-3">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player Positions</span>
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <input
                            value={draft.positionDraft ?? ''}
                            onChange={(event) => handlePlayerDraftChange(player.id, 'positionDraft', event.target.value)}
                            placeholder="Add position"
                            className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddPlayerPosition(player.id)}
                            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                          >
                            Add Position
                          </button>
                        </div>
                        {(draft.positions ?? []).length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {draft.positions.map((position) => (
                              <button
                                key={position}
                                type="button"
                                onClick={() => handleRemovePlayerPosition(player.id, position)}
                                className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                              >
                                {position} remove
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">No positions entered.</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="grid flex-1 gap-3 md:grid-cols-2 2xl:grid-cols-5">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Section</p>
                          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{player.section}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Team</p>
                          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{player.team || 'No team entered'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Parents</p>
                          <div className="mt-2 space-y-1">
                            {normalizeParentContacts(player.parentContacts, {
                              parentName: player.parentName,
                              parentEmail: player.parentEmail,
                            }).length > 0 ? (
                              normalizeParentContacts(player.parentContacts, {
                                parentName: player.parentName,
                                parentEmail: player.parentEmail,
                              }).map((contact, index) => (
                                <p key={index} className="break-words text-sm font-semibold text-[var(--text-primary)]">
                                  {contact.name || 'Parent/Guardian'}{contact.email ? ` | ${contact.email}` : ''}
                                </p>
                              ))
                            ) : (
                              <p className="text-sm font-semibold text-[var(--text-primary)]">No parent details entered</p>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Positions</p>
                          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                            {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Status</p>
                          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                            {player.status === 'promoted' ? 'Promoted' : 'Active'}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        {player.section !== 'Squad' ? (
                          <button
                            type="button"
                            disabled={isPromotingId === player.id}
                            onClick={() => void handlePromotePlayer(player.id)}
                            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isPromotingId === player.id ? 'Promoting...' : 'Promote to Squad'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleStartEditingPlayer(player)}
                          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                        >
                          Edit Details
                        </button>
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
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-500/40 bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeleting ? 'Deleting...' : 'Delete This Player'}
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
              const evaluationParentContacts = getEvaluationParentContacts(evaluation)
              const selectedTemplateKey = getSelectedEmailTemplateKey(evaluation)
              const shouldShowInviteDate = isInviteEmailTemplate(selectedTemplateKey)

              return (
                <div
                  key={evaluation.id}
                  className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 sm:p-5"
                >
                  <div>
                    <div>
                      <p className="text-lg font-semibold text-[var(--text-primary)]">{evaluation.date || 'No date entered'}</p>
                      {evaluation.session ? <p className="mt-1 text-sm text-[var(--text-muted)]">Session: {evaluation.session}</p> : null}
                      <p className="mt-1 text-sm text-[var(--text-muted)]">Section: {evaluation.section || 'Trial'}</p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(220px,1fr)_minmax(180px,1fr)_minmax(220px,1fr)_auto_auto] xl:items-end">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email template</span>
                      <select
                        value={selectedTemplateKey}
                        onChange={(event) =>
                          setSelectedEmailTemplates((currentTemplates) => ({
                            ...currentTemplates,
                            [evaluation.id]: event.target.value,
                          }))
                        }
                        className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                      >
                        {PARENT_EMAIL_TEMPLATES.map((template) => (
                          <option key={template.key} value={template.key}>
                            {template.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {shouldShowInviteDate ? (
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Invite date</span>
                        <input
                          type="date"
                          value={getSelectedInviteDate(evaluation)}
                          onChange={(event) =>
                            setSelectedInviteDates((currentDates) => ({
                              ...currentDates,
                              [evaluation.id]: event.target.value,
                            }))
                          }
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                      </label>
                    ) : (
                      <div className="hidden xl:block" />
                    )}
                    <div>
                      <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">PDF recipients</span>
                      {evaluationParentContacts.length > 0 ? (
                        <div className="space-y-2 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] p-3">
                          {evaluationParentContacts.map((contact, index) => {
                            const selectedIndexes =
                              selectedParentContacts[evaluation.id] ?? evaluationParentContacts.map((_, contactIndex) => contactIndex)

                            return (
                              <label key={`${contact.email || contact.name}-${index}`} className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                                <input
                                  type="checkbox"
                                  checked={selectedIndexes.includes(index)}
                                  onChange={() => handleToggleEvaluationParentContact(evaluation.id, index, evaluationParentContacts)}
                                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                                />
                                <span className="min-w-0">
                                  <span className="block font-semibold">{contact.name || 'Parent/Guardian'}</span>
                                  <span className="block break-words text-xs text-[var(--text-muted)]">{contact.email || 'No email entered'}</span>
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-muted)]">
                          No parent contacts entered.
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDownloadPdf(evaluation, 'scored')}
                      disabled={pdfLoadingId === `${evaluation.id}:scored` || !canShare}
                      title="Download scored PDF"
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pdfLoadingId === `${evaluation.id}:scored` ? 'Preparing...' : 'PDF With Scores'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadPdf(evaluation, 'email')}
                      disabled={pdfLoadingId === `${evaluation.id}:email` || !canShare}
                      title="Download email template PDF"
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pdfLoadingId === `${evaluation.id}:email` ? 'Preparing...' : 'Email Template PDF'}
                    </button>
                  </div>

                  {evaluationParentContacts.length > 0 ? (
                    <div className="mt-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Parent details</p>
                      <div className="mt-3 space-y-1">
                        {evaluationParentContacts.map((contact, index) => (
                          <p key={index} className="break-words text-sm leading-6 text-[var(--text-muted)]">
                            {contact.name || 'Parent/Guardian'}{contact.email ? ` | ${contact.email}` : ''}
                          </p>
                        ))}
                      </div>
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
