import { useEffect, useMemo, useState } from 'react'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems, Pagination } from '../components/ui/Pagination.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { isSuperAdmin, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import { buildEmailHtml, buildPlayerFeedbackSubject, sendParentEmail } from '../lib/email-builder.js'
import { PLAN_OPTIONS, getPlanName } from '../lib/plans.js'
import {
  createPlatformClub,
  deletePlatformFeedback,
  deletePlatformClub,
  getPlatformFeedback,
  getPlatformStats,
  readViewCacheValue,
  updatePlatformFeedback,
  updatePlatformClubPlan,
  updatePlatformClubStatus,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

const cacheKey = 'platform-admin-dashboard'
const feedbackCacheKey = 'platform-admin-feedback'
const PLATFORM_FEEDBACK_PAGE_SIZE = 6
const CLUB_PAGE_SIZE = 6

function formatDate(value) {
  if (!value) {
    return 'No activity yet'
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'No activity yet'
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsedDate)
}

export function PlatformAdminPage() {
  const { user } = useAuth()
  const [stats, setStats] = useState(() => readViewCacheValue(cacheKey, 'stats', null))
  const [feedbackItems, setFeedbackItems] = useState(() => {
    const cachedItems = readViewCacheValue(feedbackCacheKey, 'feedbackItems', [])
    return Array.isArray(cachedItems) ? cachedItems : []
  })
  const [feedbackDrafts, setFeedbackDrafts] = useState({})
  const [selectedClubId, setSelectedClubId] = useState('All')
  const [feedbackPage, setFeedbackPage] = useState(1)
  const [clubPage, setClubPage] = useState(1)
  const [feedbackDeleteTarget, setFeedbackDeleteTarget] = useState(null)
  const [clubDeleteTarget, setClubDeleteTarget] = useState(null)
  const [isLoading, setIsLoading] = useState(() => !stats)
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(() => feedbackItems.length === 0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isSavingClub, setIsSavingClub] = useState(false)
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false)
  const [isPreviewingPdf, setIsPreviewingPdf] = useState(false)
  const [previewEmailHtml, setPreviewEmailHtml] = useState('')
  const [previewPdfUrl, setPreviewPdfUrl] = useState('')
  const [testEmailDebug, setTestEmailDebug] = useState(null)
  const [updatingClubId, setUpdatingClubId] = useState('')
  const [updatingFeedbackId, setUpdatingFeedbackId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [newClubForm, setNewClubForm] = useState({
    name: '',
    contactEmail: '',
    contactPhone: '',
  })
  const [testEmailForm, setTestEmailForm] = useState({
    parentEmail: user?.email || '',
    parentName: 'Parent/Guardian',
    playerName: 'Test Player',
    teamName: 'U12',
    clubName: 'Test FC',
    summary: 'Strong performance, good awareness.',
    responses: [
      { label: 'Passing', value: 'Good' },
      { label: 'Positioning', value: 'Average' },
      { label: 'Effort', value: 'Excellent' },
    ],
  })

  useEffect(() => {
    let isMounted = true

    const loadStats = async () => {
      if (!isSuperAdmin(user)) {
        setIsLoading(false)
        return
      }

      setErrorMessage('')

      try {
        const nextStats = await withRequestTimeout(() => getPlatformStats(user), 'Could not load platform stats.')

        if (!isMounted) {
          return
        }

        setStats(nextStats)
        writeViewCache(cacheKey, {
          stats: nextStats,
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Platform stats could not be refreshed right now.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadStats()

    return () => {
      isMounted = false
    }
  }, [refreshKey, user])

  useEffect(() => {
    let isMounted = true

    const loadFeedback = async () => {
      if (!isSuperAdmin(user)) {
        setIsFeedbackLoading(false)
        return
      }

      try {
        const nextFeedbackItems = await withRequestTimeout(
          () => getPlatformFeedback(user),
          'Could not load platform feedback.',
        )

        if (!isMounted) {
          return
        }

        setFeedbackItems(nextFeedbackItems)
        setFeedbackDrafts(
          nextFeedbackItems.reduce((drafts, item) => {
            drafts[item.id] = {
              status: item.status,
              adminComment: '',
            }
            return drafts
          }, {}),
        )
        writeViewCache(feedbackCacheKey, {
          feedbackItems: nextFeedbackItems,
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Platform feedback could not be refreshed right now.')
        }
      } finally {
        if (isMounted) {
          setIsFeedbackLoading(false)
        }
      }
    }

    void loadFeedback()

    return () => {
      isMounted = false
    }
  }, [refreshKey, user])

  const visibleClubs = useMemo(() => {
    const clubs = stats?.clubs ?? []
    return selectedClubId === 'All' ? clubs : clubs.filter((club) => club.id === selectedClubId)
  }, [selectedClubId, stats])
  const paginatedFeedbackItems = useMemo(
    () => getPaginatedItems(feedbackItems, feedbackPage, PLATFORM_FEEDBACK_PAGE_SIZE),
    [feedbackItems, feedbackPage],
  )
  const paginatedVisibleClubs = useMemo(
    () => getPaginatedItems(visibleClubs, clubPage, CLUB_PAGE_SIZE),
    [clubPage, visibleClubs],
  )

  const refreshStats = () => {
    setRefreshKey((current) => current + 1)
  }

  const handleFeedbackDraftChange = (feedbackId, fieldName, value) => {
    setFeedbackDrafts((current) => ({
      ...current,
      [feedbackId]: {
        status: current[feedbackId]?.status ?? 'open',
        adminComment: current[feedbackId]?.adminComment ?? '',
        [fieldName]: value,
      },
    }))
    setErrorMessage('')
    setSuccessMessage('')
  }

  const handleSaveFeedback = async (item) => {
    const draft = feedbackDrafts[item.id] ?? {
      status: item.status,
      adminComment: '',
    }

    setUpdatingFeedbackId(item.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await updatePlatformFeedback({
        user,
        feedbackId: item.id,
        data: draft,
      })
      setSuccessMessage('Feedback updated.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Feedback could not be updated.')
    } finally {
      setUpdatingFeedbackId('')
    }
  }

  const handleDeleteFeedback = async (item) => {
    setFeedbackDeleteTarget(item)
  }

  const confirmDeleteFeedback = async (password) => {
    if (!feedbackDeleteTarget) {
      return
    }

    setUpdatingFeedbackId(feedbackDeleteTarget.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await deletePlatformFeedback({
        user,
        feedbackId: feedbackDeleteTarget.id,
      })
      setSuccessMessage('Feedback deleted.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Feedback could not be deleted.')
    } finally {
      setUpdatingFeedbackId('')
      setFeedbackDeleteTarget(null)
    }
  }

  const handleNewClubChange = (fieldName, value) => {
    setNewClubForm((current) => ({
      ...current,
      [fieldName]: value,
    }))
    setErrorMessage('')
    setSuccessMessage('')
  }

  const handleTestEmailChange = (fieldName, value) => {
    setTestEmailForm((current) => ({
      ...current,
      [fieldName]: value,
    }))
    setErrorMessage('')
    setSuccessMessage('')
  }

  const handleTestResponseChange = (index, fieldName, value) => {
    setTestEmailForm((current) => ({
      ...current,
      responses: current.responses.map((response, responseIndex) =>
        responseIndex === index
          ? {
              ...response,
              [fieldName]: value,
            }
          : response,
      ),
    }))
    setErrorMessage('')
    setSuccessMessage('')
  }

  const handleAddTestResponse = () => {
    setTestEmailForm((current) => ({
      ...current,
      responses: [...current.responses, { label: '', value: '' }],
    }))
  }

  const handleRemoveTestResponse = (index) => {
    setTestEmailForm((current) => ({
      ...current,
      responses: current.responses.filter((_, responseIndex) => responseIndex !== index),
    }))
  }

  const handleUseSampleData = () => {
    setTestEmailForm((current) => ({
      ...current,
      playerName: 'Test Player',
      teamName: 'U12',
      clubName: 'Test FC',
      summary: 'Strong performance, good awareness.',
      responses: [
        { label: 'Passing', value: 'Good' },
        { label: 'Positioning', value: 'Average' },
        { label: 'Effort', value: 'Excellent' },
      ],
    }))
    setPreviewEmailHtml('')
    setPreviewPdfUrl('')
    setTestEmailDebug(null)
    setSuccessMessage('Sample test data loaded.')
  }

  const getTestEmailPayload = () => {
    const subject = buildPlayerFeedbackSubject({
      playerName: testEmailForm.playerName,
      teamName: testEmailForm.teamName,
    })

    return {
      parentEmail: testEmailForm.parentEmail,
      parentName: testEmailForm.parentName,
      displayName: user?.displayName || user?.username || user?.name || 'Platform Admin',
      teamName: testEmailForm.teamName,
      clubName: testEmailForm.clubName,
      replyToEmail: user?.replyToEmail || user?.clubContactEmail || user?.email,
      clubContactEmail: user?.clubContactEmail,
      logoUrl: user?.clubLogoUrl || null,
      playerName: testEmailForm.playerName,
      summary: testEmailForm.summary,
      responses: testEmailForm.responses.filter((item) => item.label || item.value),
      subject,
    }
  }

  const handlePreviewEmail = () => {
    const payload = getTestEmailPayload()
    const html = buildEmailHtml(payload)
    setPreviewEmailHtml(html)
    setTestEmailDebug((current) => ({
      ...(current ?? {}),
      htmlSize: html.length,
    }))
    setSuccessMessage('Email preview generated.')
  }

  const handlePreviewPdf = async () => {
    setIsPreviewingPdf(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const payload = getTestEmailPayload()
      const response = await fetch('/.netlify/functions/test-pdf-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'PDF preview failed')
      }

      setPreviewPdfUrl(`data:application/pdf;base64,${result.pdfBase64}`)
      setTestEmailDebug((current) => ({
        ...(current ?? {}),
        htmlSize: result.htmlSize,
        pdfSize: result.pdfSize,
      }))
      setSuccessMessage('PDF preview generated.')
    } catch (error) {
      console.error(error)
      setErrorMessage('PDF preview could not be generated.')
    } finally {
      setIsPreviewingPdf(false)
    }
  }

  const handleSendTestEmail = async (event) => {
    event.preventDefault()
    setIsSendingTestEmail(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const result = await sendParentEmail(getTestEmailPayload())

      setTestEmailDebug((current) => ({
        ...(current ?? {}),
        sendResponseId: result.id || 'No response ID returned',
        hasAttachment: result.hasAttachment,
        htmlSize: result.htmlSize,
      }))
      setSuccessMessage('Test email sent with PDF attached')
    } catch (error) {
      console.error(error)
      setErrorMessage('Test email failed - check logs')
    } finally {
      setIsSendingTestEmail(false)
    }
  }

  const handleCreateClub = async (event) => {
    event.preventDefault()
    setIsSavingClub(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await createPlatformClub({
        user,
        name: newClubForm.name,
        contactEmail: newClubForm.contactEmail,
        contactPhone: newClubForm.contactPhone,
      })
      setNewClubForm({
        name: '',
        contactEmail: '',
        contactPhone: '',
      })
      setSuccessMessage('Club created.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club could not be created.')
    } finally {
      setIsSavingClub(false)
    }
  }

  const handleToggleClubStatus = async (club) => {
    const nextStatus = club.status === 'suspended' ? 'active' : 'suspended'
    setUpdatingClubId(club.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await updatePlatformClubStatus({
        user,
        clubId: club.id,
        status: nextStatus,
      })
      setSuccessMessage(nextStatus === 'suspended' ? 'Club suspended.' : 'Club reactivated.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club status could not be updated.')
    } finally {
      setUpdatingClubId('')
    }
  }

  const handleClubPlanChange = async (club, fieldName, value) => {
    setUpdatingClubId(club.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await updatePlatformClubPlan({
        user,
        clubId: club.id,
        planKey: fieldName === 'planKey' ? value : club.planKey,
        planStatus: fieldName === 'planStatus' ? value : club.planStatus,
        isPlanComped: fieldName === 'isPlanComped' ? value : club.isPlanComped,
      })
      setSuccessMessage('Club plan updated.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club plan could not be updated.')
    } finally {
      setUpdatingClubId('')
    }
  }

  const handleDeleteClub = async (club) => {
    setClubDeleteTarget(club)
  }

  const confirmDeleteClub = async (password) => {
    if (!clubDeleteTarget) {
      return
    }

    setUpdatingClubId(clubDeleteTarget.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await deletePlatformClub({
        user,
        clubId: clubDeleteTarget.id,
      })
      if (selectedClubId === clubDeleteTarget.id) {
        setSelectedClubId('All')
      }
      setSuccessMessage('Club deleted.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club could not be deleted.')
    } finally {
      setUpdatingClubId('')
      setClubDeleteTarget(null)
    }
  }

  if (!isSuperAdmin(user)) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <PageHeader
          eyebrow="Platform"
          title="Platform dashboard"
          description="This area is only available to platform administrators."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="Platform dashboard"
        description="View platform usage, clubs, teams, and adult user emails without exposing player personal details."
      />

      {errorMessage ? (
        <NoticeBanner
          title="Platform data is not fully available"
          message={errorMessage}
        />
      ) : null}

      {successMessage ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
          {successMessage}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Clubs', stats?.totals?.clubs ?? 0],
          ['Adult users', stats?.totals?.users ?? 0],
          ['Teams', stats?.totals?.teams ?? 0],
          ['Players', stats?.totals?.players ?? 0],
          ['Assessments', stats?.totals?.evaluations ?? 0],
          ['Shared exports', stats?.totals?.communications ?? 0],
          ['7 day assessments', stats?.totals?.recentEvaluations ?? 0],
          ['7 day shares', stats?.totals?.recentCommunications ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">{label}</p>
            <p className="mt-3 text-3xl font-semibold text-[var(--text-primary)]">{value}</p>
          </div>
        ))}
      </div>

      <SectionCard
        title="Test Email"
        description="Preview and send through the live email and PDF pipeline."
      >
        <form onSubmit={handleSendTestEmail} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Test email address</span>
              <input
                required
                type="email"
                value={testEmailForm.parentEmail}
                onChange={(event) => handleTestEmailChange('parentEmail', event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Parent name</span>
              <input
                value={testEmailForm.parentName}
                onChange={(event) => handleTestEmailChange('parentName', event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player name</span>
              <input
                required
                value={testEmailForm.playerName}
                onChange={(event) => handleTestEmailChange('playerName', event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team name</span>
              <input
                required
                value={testEmailForm.teamName}
                onChange={(event) => handleTestEmailChange('teamName', event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Club name</span>
              <input
                required
                value={testEmailForm.clubName}
                onChange={(event) => handleTestEmailChange('clubName', event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Summary</span>
              <textarea
                required
                rows="3"
                value={testEmailForm.summary}
                onChange={(event) => handleTestEmailChange('summary', event.target.value)}
                className="min-h-24 w-full rounded-3xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
          </div>

          <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Responses</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">These are included in the same HTML used by email and PDF.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleUseSampleData}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]"
                >
                  Use Sample Data
                </button>
                <button
                  type="button"
                  onClick={handleAddTestResponse}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]"
                >
                  Add Response
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {testEmailForm.responses.map((response, index) => (
                <div key={`${index}-${response.label}`} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <input
                    value={response.label}
                    onChange={(event) => handleTestResponseChange(index, 'label', event.target.value)}
                    placeholder="Label"
                    className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                  <input
                    value={response.value}
                    onChange={(event) => handleTestResponseChange(index, 'value', event.target.value)}
                    placeholder="Value"
                    className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveTestResponse(index)}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row">
            <button
              type="button"
              onClick={handlePreviewEmail}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
            >
              Preview Email
            </button>
            <button
              type="button"
              onClick={() => void handlePreviewPdf()}
              disabled={isPreviewingPdf}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPreviewingPdf ? 'Generating PDF...' : 'Preview PDF'}
            </button>
            <button
              type="submit"
              disabled={isSendingTestEmail}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSendingTestEmail ? 'Sending...' : 'Send Test Email'}
            </button>
          </div>

          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm leading-6 text-[var(--text-muted)]">
            From: {user?.displayName || user?.username || user?.name || 'Platform Admin'} ({testEmailForm.teamName || 'Team'} - {testEmailForm.clubName || 'Club'}) &lt;feedback@playerfeedback.online&gt;
            <br />
            Reply to: {user?.replyToEmail || user?.clubContactEmail || user?.email || 'No reply-to email set'}
            <br />
            Subject: {buildPlayerFeedbackSubject({ playerName: testEmailForm.playerName, teamName: testEmailForm.teamName })}
          </div>

          {testEmailDebug ? (
            <div className="grid gap-3 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 text-sm text-[var(--text-muted)] sm:grid-cols-2 xl:grid-cols-4">
              <p>HTML size: {testEmailDebug.htmlSize ?? 'Not generated'} bytes</p>
              <p>PDF size: {testEmailDebug.pdfSize ?? 'Not generated'} bytes</p>
              <p>Attachment: {testEmailDebug.hasAttachment === undefined ? 'Not sent' : testEmailDebug.hasAttachment ? 'Yes' : 'No'}</p>
              <p>Send response ID: {testEmailDebug.sendResponseId ?? 'Not sent'}</p>
            </div>
          ) : null}

          {previewEmailHtml ? (
            <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Email HTML Preview</p>
              <div className="max-h-[520px] overflow-auto rounded-2xl bg-white p-4">
                <div dangerouslySetInnerHTML={{ __html: previewEmailHtml }} />
              </div>
            </div>
          ) : null}

          {previewPdfUrl ? (
            <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">PDF Preview</p>
              <iframe title="PDF preview" src={previewPdfUrl} className="h-[620px] w-full rounded-2xl border border-[var(--border-color)] bg-white" />
            </div>
          ) : null}
        </form>
      </SectionCard>

      <SectionCard
        title="Manage clubs"
        description="Create clubs, suspend access, reactivate access, or delete unused club workspaces."
      >
        <form onSubmit={handleCreateClub} className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_auto] xl:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Club name</span>
            <input
              required
              value={newClubForm.name}
              onChange={(event) => handleNewClubChange('name', event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Contact email</span>
            <input
              type="email"
              value={newClubForm.contactEmail}
              onChange={(event) => handleNewClubChange('contactEmail', event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Contact phone</span>
            <input
              value={newClubForm.contactPhone}
              onChange={(event) => handleNewClubChange('contactPhone', event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <button
            type="submit"
            disabled={isSavingClub}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingClub ? 'Adding...' : 'Add Club'}
          </button>
        </form>
      </SectionCard>

      <SectionCard
        title="Platform feedback"
        description="Review product feedback, update status, add internal notes, or remove completed items."
      >
        {isFeedbackLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading feedback...
          </div>
        ) : feedbackItems.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No platform feedback has been submitted yet.
          </div>
        ) : (
          <div className="space-y-4">
            {paginatedFeedbackItems.items.map((item) => {
              const draft = feedbackDrafts[item.id] ?? {
                status: item.status,
                adminComment: '',
              }

              return (
                <div key={item.id} className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
                  <div className="grid gap-4 xl:grid-cols-[1fr_220px]">
                    <div>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{item.message}</p>
                      <p className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                        {item.clubName} | {item.createdByEmail || 'No email'} | {item.voteCount} votes
                      </p>
                    </div>
                    <div className="space-y-3">
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Status</span>
                        <select
                          value={draft.status}
                          onChange={(event) => handleFeedbackDraftChange(item.id, 'status', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        >
                          <option value="open">Open</option>
                          <option value="planned">Planned</option>
                          <option value="in_progress">In progress</option>
                          <option value="done">Done</option>
                          <option value="declined">Declined</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  {item.comments?.length ? (
                    <div className="mt-4 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">Visible comments</p>
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

                  <label className="mt-4 block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Add public comment</span>
                    <textarea
                      rows="3"
                      value={draft.adminComment}
                      onChange={(event) => handleFeedbackDraftChange(item.id, 'adminComment', event.target.value)}
                      placeholder="This will be visible to users on the feedback board."
                      className="min-h-24 w-full rounded-3xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                    />
                  </label>

                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      disabled={updatingFeedbackId === item.id}
                      onClick={() => void handleSaveFeedback(item)}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={updatingFeedbackId === item.id}
                      onClick={() => void handleDeleteFeedback(item)}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
            <Pagination
              currentPage={feedbackPage}
              onPageChange={setFeedbackPage}
              pageSize={PLATFORM_FEEDBACK_PAGE_SIZE}
              totalItems={feedbackItems.length}
            />
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Club usage"
        description="Operational usage only. Player names and child contact details are intentionally excluded."
      >
        <div className="mb-5 max-w-sm">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Club filter</span>
            <select
              value={selectedClubId}
              onChange={(event) => {
                setSelectedClubId(event.target.value)
                setClubPage(1)
              }}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              <option value="All">All clubs</option>
              {(stats?.clubs ?? []).map((club) => (
                <option key={club.id} value={club.id}>
                  {club.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading platform stats...
          </div>
        ) : visibleClubs.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No clubs found yet.
          </div>
        ) : (
          <div className="space-y-4">
            {paginatedVisibleClubs.items.map((club) => (
              <div key={club.id} className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
                <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-lg font-semibold text-[var(--text-primary)]">{club.name}</p>
                      <span
                        className={[
                          'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]',
                          club.status === 'suspended'
                            ? 'bg-red-500/15 text-red-300'
                            : 'bg-[var(--button-primary)] text-[var(--button-primary-text)]',
                        ].join(' ')}
                      >
                        {club.status === 'suspended' ? 'Suspended' : 'Active'}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--text-muted)]">
                      Contact: {club.contactEmail || 'No email entered'}
                      {club.contactPhone ? ` | ${club.contactPhone}` : ''}
                    </p>
                    <p className="mt-2 text-sm text-[var(--text-muted)]">
                      Latest activity: {formatDate(club.latestActivityAt)}
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <label className="block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Plan</span>
                        <select
                          value={club.planKey || 'small_club'}
                          disabled={updatingClubId === club.id}
                          onChange={(event) => void handleClubPlanChange(club, 'planKey', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:opacity-60"
                        >
                          {PLAN_OPTIONS.map((plan) => (
                            <option key={plan.key} value={plan.key}>
                              {plan.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Billing status</span>
                        <select
                          value={club.planStatus || 'active'}
                          disabled={updatingClubId === club.id}
                          onChange={(event) => void handleClubPlanChange(club, 'planStatus', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:opacity-60"
                        >
                          <option value="active">Active</option>
                          <option value="trialing">Trialing</option>
                          <option value="past_due">Past due</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </label>
                      <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] md:mt-7">
                        <input
                          type="checkbox"
                          checked={Boolean(club.isPlanComped)}
                          disabled={updatingClubId === club.id}
                          onChange={(event) => void handleClubPlanChange(club, 'isPlanComped', event.target.checked)}
                          className="h-4 w-4"
                        />
                        <span>Free access</span>
                      </label>
                    </div>
                    <p className="mt-2 text-sm text-[var(--text-muted)]">
                      Current plan: {getPlanName(club)}{club.isPlanComped ? ' | Free access enabled' : ''}
                    </p>
                    {club.suspendedAt ? (
                      <p className="mt-2 text-sm text-[var(--text-muted)]">Suspended: {formatDate(club.suspendedAt)}</p>
                    ) : null}
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        disabled={updatingClubId === club.id}
                        onClick={() => void handleToggleClubStatus(club)}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {club.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                      </button>
                      <button
                        type="button"
                        disabled={updatingClubId === club.id}
                        onClick={() => void handleDeleteClub(club)}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="grid w-full gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4 2xl:max-w-[620px]">
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Users</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.userCount}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Teams</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.teamCount}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Players</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.playerCount}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Shares</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.communicationCount}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Trial</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.trialPlayerCount}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Squad</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.squadPlayerCount}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Adult user emails</p>
                    <div className="mt-3 space-y-2">
                      {club.users.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)]">No users found.</p>
                      ) : (
                        club.users.map((member) => (
                          <div key={member.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                            <p className="break-words text-sm font-semibold text-[var(--text-primary)]">{member.email}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">{member.roleLabel}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Teams and role mix</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {club.teams.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)]">No teams found.</p>
                      ) : (
                        club.teams.map((team) => (
                          <span
                            key={team.id}
                            className="rounded-full border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-medium text-[var(--text-primary)]"
                          >
                            {team.name}
                          </span>
                        ))
                      )}
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {club.roleCounts.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)]">No role data found.</p>
                      ) : (
                        club.roleCounts.map((role) => (
                          <div key={role.label} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{role.label}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                              {role.count} users
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <Pagination
              currentPage={clubPage}
              onPageChange={setClubPage}
              pageSize={CLUB_PAGE_SIZE}
              totalItems={visibleClubs.length}
            />
          </div>
        )}
      </SectionCard>

      <ConfirmModal
        isOpen={Boolean(feedbackDeleteTarget)}
        isBusy={Boolean(updatingFeedbackId)}
        title="Delete platform feedback"
        message="This removes the feedback item and its comments from the feedback board."
        items={[
          `Feedback: ${feedbackDeleteTarget?.message || 'Selected feedback'}`,
          `Club: ${feedbackDeleteTarget?.clubName || 'No club entered'}`,
          `${feedbackDeleteTarget?.voteCount ?? 0} votes`,
        ]}
        confirmLabel="Delete Feedback"
        onCancel={() => setFeedbackDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteFeedback(password)}
      />

      <ConfirmModal
        isOpen={Boolean(clubDeleteTarget)}
        isBusy={Boolean(updatingClubId)}
        title="Delete club workspace"
        message="This is a platform admin action and cannot be undone from the app."
        items={[
          `Club: ${clubDeleteTarget?.name || 'Selected club'}`,
          `${clubDeleteTarget?.userCount ?? 0} adult users`,
          `${clubDeleteTarget?.teamCount ?? 0} teams`,
          `${clubDeleteTarget?.playerCount ?? 0} player records`,
          `${clubDeleteTarget?.evaluationCount ?? 0} assessments`,
          'Club settings and related workspace data',
        ]}
        confirmLabel="Delete Club"
        onCancel={() => setClubDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteClub(password)}
      />
    </div>
  )
}
