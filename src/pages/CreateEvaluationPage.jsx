import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useBlocker, useNavigate, useSearchParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-player-logo.png'
import { BlankPrintForm } from '../components/evaluations/BlankPrintForm.jsx'
import { ConfiguredFieldsSection } from '../components/evaluations/ConfiguredFieldsSection.jsx'
import { EvaluationAvailabilityState } from '../components/evaluations/EvaluationAvailabilityState.jsx'
import { EvaluationPlayerDetailsSection } from '../components/evaluations/EvaluationPlayerDetailsSection.jsx'
import { PreviousAssessmentsSection } from '../components/evaluations/PreviousAssessmentsSection.jsx'
import { SubmitExportSection } from '../components/evaluations/SubmitExportSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canDeletePlayer, canManageParentEmailTemplates, canManageUsers, isSuperAdmin, useAuth } from '../lib/auth.js'
import {
  EMAIL_TEMPLATE_AUDIENCES,
  isInviteEmailTemplate,
  mergeEmailTemplatesWithDefaults,
  normalizeEmailTemplateAudience,
} from '../lib/email-templates.js'
import { isDemoUser } from '../lib/demo.js'
import {
  confirmDevelopmentSubmission,
  finalizeDevelopmentParentReport,
  sendParentEmail,
} from '../lib/email-builder.js'
import {
  getDevelopmentParentEmailRecipientCandidates,
} from '../lib/domain/development-parent-email-recipients.js'
import { isDevelopmentPdfClientEnabled } from '../lib/development-pdf-feature.js'
import { buildPlayerProgressionData, buildProgressionEmailSections } from '../lib/player-progression.js'
import { sendParentMobilePushNotification } from '../lib/push-notifications.js'
import { CAPABILITIES } from '../lib/paywall-access.js'
import { canUseUiFeature, createUiFeatureUnavailableMessage } from '../lib/paywall-ui.js'
import {
  createLimitUpgradeMessage,
  isWithinPlanLimit,
} from '../lib/plans.js'
import {
  getSavedEvaluationExportLabels,
  getSelectedEvaluationResponses,
  reorderEvaluationExportLabels,
  saveEvaluationExportLabels,
} from '../lib/evaluation-export-selection.js'
import {
  buildPrivateEvaluationDraftContext,
  closeServerEvaluationDraft,
  createPrivateEvaluationDraftPayload,
  findServerEvaluationDraft,
  getEvaluationDraftContextKey,
  hasPrivateEvaluationDraftContent,
  PRIVATE_EVALUATION_DRAFT_STATUSES,
  saveServerEvaluationDraft,
} from '../lib/evaluation-drafts.js'
import {
  DEVELOPMENT_PARENT_OUTPUT_CONTEXT,
  DEVELOPMENT_RECIPIENT_OUTPUT_CONTEXT,
  normalizeDevelopmentPreviewMode,
} from '../lib/development-email-output-policy.js'
import {
  buildDevelopmentCompletionItems,
  buildDevelopmentSubmissionReviewItems,
  createDevelopmentMeaningfulStateSignature,
  getDevelopmentSubmissionActionLabel,
} from '../lib/development-submission-flow.js'
import {
  buildComments,
  buildFormResponses,
  buildParentEmailJobs,
  buildPreviousFieldValueMap,
  buildScores,
  createEvaluationPersistenceFingerprint,
  createEvaluationPayload,
  createLocalId,
  createEmptyResponseValues,
  createInitialFormData,
  createPostAssessmentFormData,
  createResponseItems,
  findSavedPlayerForEvaluation,
  formatSessionForDisplay,
  getAverageScore,
  getContactCopy,
  getCurrentMonthEvaluationCount,
  getDevelopmentRecordSaveFailureMessage,
  getMatchedPlayerFieldUpdate,
  getNextExportLabels,
  getNextSelectedContactIndexes,
  getPostAssessmentNavigation,
  getSelectedContactIndexes,
  mapEvaluationResponsesToFieldValues,
  normalizePlayerName,
  normalizeSessionValue,
  writeSessionAssessmentProgress,
} from '../hooks/evaluations/evaluationFormUtils.js'
import {
  EVALUATION_SECTIONS,
  PLAYER_CONTACT_TYPES,
  archivePlayer,
  buildFeedbackFormSnapshot,
  createAssessmentReminderOnce,
  createCommunicationLog,
  createEvaluation,
  getActiveFeedbackForms,
  getContactTemplateAudiences,
  getEvaluations,
  getAvailableTeamsForUser,
  getDefaultFormFields,
  getFormFields,
  getParentEmailTemplates,
  getPlayers,
  normalizeParentContacts,
  normalizePlayerContactType,
  clearViewCaches,
  readViewCache,
  readViewCacheValue,
  updateEvaluation,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

const DEFAULT_FEEDBACK_FORM_ID = '__default_development_form__'

function getReadyState(isReady) {
  return isReady
    ? {
        label: 'Ready',
        className: 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]',
        dotClassName: 'bg-[#047857]',
      }
    : {
        label: 'Missing',
        className: 'border-[#fedf89] bg-[#fffaeb] text-[#93370d]',
        dotClassName: 'bg-[#dc6803]',
      }
}

function normalizeAssessmentSearch(value) {
  return String(value ?? '').trim().toLowerCase()
}

function getPlayerSectionLabel(section) {
  return String(section ?? '').trim() === 'Trial' ? 'Trial player' : 'Squad player'
}

function getPlayerSectionKey(section) {
  return String(section ?? '').trim() === 'Trial' ? 'trial' : 'squad'
}

function formatPrivateDraftSavedAt(value) {
  if (!value) {
    return ''
  }

  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch (error) {
    console.error(error)
    return ''
  }
}

function getPrivateDraftBannerCopy(status, draftInfo) {
  const savedAt = formatPrivateDraftSavedAt(draftInfo?.lastSavedAt || draftInfo?.restoredAt)
  const lastSavedMessage = savedAt ? ` Last saved: ${savedAt}.` : ''

  if (status === 'restored') {
    return {
      title: 'Draft saved',
      message: `Your explicitly saved Development Record draft has been restored.${lastSavedMessage}`,
    }
  }

  if (status === 'unsaved') {
    return {
      title: 'Unsaved changes',
      message: 'Press Save Draft to keep these changes before leaving this page.',
    }
  }

  if (status === 'saving') {
    return {
      title: 'Saving draft',
      message: 'Waiting for the server to confirm this draft.',
    }
  }

  if (status === 'error') {
    return {
      title: 'Draft could not be saved',
      message: 'Your entered values are still on this page. Try Save Draft again.',
    }
  }

  return {
    title: 'Draft saved',
    message: `This Development Record draft is saved privately for your Coach account.${lastSavedMessage}`,
  }
}

const ASSESSMENT_PLAYER_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'squad', label: 'Squad players' },
  { value: 'trial', label: 'Trial players' },
]

const ASSESSMENT_PLAYER_SECTIONS = [
  {
    value: 'squad',
    title: 'Squad players',
    emptyMessage: 'No squad players are available for this team.',
  },
  {
    value: 'trial',
    title: 'Trial players',
    emptyMessage: 'No trial players are available for this team.',
  },
]

function PlayerPickerCard({ activeTeamName, onSelectPlayer, player }) {
  const sectionKey = getPlayerSectionKey(player.section)
  const isTrialPlayer = sectionKey === 'trial'
  const badgeClassName = isTrialPlayer
    ? 'border-[#fde68a] bg-[#fffbeb] text-[#93370d]'
    : 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]'
  const accentClassName = isTrialPlayer ? 'border-l-[#d97706]' : 'border-l-[#047857]'
  const hoverClassName = isTrialPlayer ? 'hover:border-[#d97706] hover:bg-[#fffbeb]' : 'hover:border-[#047857] hover:bg-[#ecfdf5]'

  return (
    <button
      type="button"
      onClick={() => onSelectPlayer(player)}
      className={`min-h-28 rounded-lg border border-l-4 border-[#d7e5dc] ${accentClassName} bg-white px-4 py-4 text-left shadow-sm shadow-[#047857]/10 transition hover:-translate-y-0.5 ${hoverClassName} focus:outline-none focus:ring-2 focus:ring-[#047857] focus:ring-offset-2`}
    >
      <span className="block text-base font-black text-[#101828]">{player.playerName}</span>
      <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${badgeClassName}`}>
        {getPlayerSectionLabel(player.section)}
      </span>
      <span className="mt-3 block text-sm font-semibold text-[#4b5f55]">
        {player.team || activeTeamName || 'Current team'}
      </span>
    </button>
  )
}

function PlayerPickerSection({
  activeTeamName,
  emptyMessage,
  isSearchActive,
  onSelectPlayer,
  players,
  title,
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-black uppercase tracking-[0.14em] text-[#101828]">
          {title}
        </h3>
        <span className="rounded-full border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#4b5f55]">
          {players.length} {players.length === 1 ? 'player' : 'players'}
        </span>
      </div>

      {players.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {players.map((player) => (
            <PlayerPickerCard
              key={player.id || `${player.team}-${player.section}-${player.playerName}`}
              activeTeamName={activeTeamName}
              onSelectPlayer={onSelectPlayer}
              player={player}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-5 text-sm font-bold text-[#4b5f55]">
          {isSearchActive ? 'No players match your search.' : emptyMessage}
        </div>
      )}
    </div>
  )
}

function AssessmentPlayerPicker({
  activeTeamName,
  isLoading,
  onSelectPlayer,
  players,
  searchValue,
  onSearchChange,
}) {
  const [activeFilter, setActiveFilter] = useState('all')
  const normalizedSearch = normalizeAssessmentSearch(searchValue)
  const sortedPlayers = players
    .slice()
    .sort((left, right) => {
      const leftSection = getPlayerSectionKey(left.section)
      const rightSection = getPlayerSectionKey(right.section)
      if (leftSection !== rightSection) {
        return leftSection === 'squad' ? -1 : 1
      }

      return String(left.playerName ?? '').localeCompare(String(right.playerName ?? ''))
    })
  const sectionCounts = sortedPlayers.reduce(
    (counts, player) => {
      counts[getPlayerSectionKey(player.section)] += 1
      return counts
    },
    { squad: 0, trial: 0 },
  )
  const filteredPlayers = sortedPlayers
    .filter((player) => activeFilter === 'all' || getPlayerSectionKey(player.section) === activeFilter)
    .filter((player) => {
      if (!normalizedSearch) {
        return true
      }

      return [
        player.playerName,
        player.team,
        player.section,
      ].some((value) => normalizeAssessmentSearch(value).includes(normalizedSearch))
    })
  const playerGroups = ASSESSMENT_PLAYER_SECTIONS.map((section) => ({
    ...section,
    players: filteredPlayers.filter((player) => getPlayerSectionKey(player.section) === section.value),
  }))
  const activeFilterEmptyMessage = ASSESSMENT_PLAYER_SECTIONS.find((section) => section.value === activeFilter)?.emptyMessage
  const visibleGroups = activeFilter === 'all'
    ? playerGroups.filter((group) => group.players.length > 0)
    : playerGroups.filter((group) => group.value === activeFilter)

  return (
    <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
      <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Select player</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Choose who this assessment is for.</h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
          Select a squad or trial player from {activeTeamName || 'the current team'} before opening the assessment form.
        </p>
      </div>

      <div className="space-y-4 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap gap-2">
          {ASSESSMENT_PLAYER_FILTERS.map((filter) => {
            const isActive = activeFilter === filter.value
            const count = filter.value === 'all' ? players.length : sectionCounts[filter.value]
            const countLabel = `${count} ${count === 1 ? 'player' : 'players'}`
            const activeClassName = isActive
              ? 'border-[#047857] bg-[#047857] text-white shadow-sm shadow-[#047857]/20'
              : 'border-[#d7e5dc] bg-[#f7faf8] text-[#4b5f55] hover:border-[#047857] hover:bg-[#ecfdf5] hover:text-[#047857]'

            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={isActive}
                aria-label={`${filter.label}, ${countLabel}`}
                onClick={() => setActiveFilter(filter.value)}
                className={`min-h-11 rounded-full border px-4 py-2 text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-[#047857] focus:ring-offset-2 ${activeClassName}`}
              >
                {filter.label}
                <span aria-hidden="true" className="ml-2 opacity-80">{count}</span>
              </button>
            )
          })}
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-black text-[#101828]">Search players</span>
          <input
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search by player name"
            className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]"
          />
        </label>

        {isLoading ? (
          <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-5 text-sm font-bold text-[#4b5f55]">
            Loading players.
          </div>
        ) : null}

        {!isLoading && players.length === 0 ? (
          <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-5 text-sm font-bold text-[#4b5f55]">
            No players are available for assessment yet. Add a player first.
          </div>
        ) : null}

        {!isLoading && players.length > 0 && filteredPlayers.length === 0 ? (
          <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-5 text-sm font-bold text-[#4b5f55]">
            {normalizedSearch ? 'No players match your search.' : activeFilterEmptyMessage || 'No players are available for assessment yet. Add a player first.'}
          </div>
        ) : null}

        {!isLoading && players.length > 0 && filteredPlayers.length > 0 ? (
          <div className="space-y-6">
            {visibleGroups.map((group) => (
              <PlayerPickerSection
                key={group.value}
                activeTeamName={activeTeamName}
                emptyMessage={group.emptyMessage}
                isSearchActive={Boolean(normalizedSearch)}
                onSelectPlayer={onSelectPlayer}
                players={group.players}
                title={group.title}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function RecordReadinessItem({ isReady, label, value }) {
  const state = getReadyState(isReady)

  return (
    <div className={`rounded-lg border px-4 py-3 shadow-sm shadow-[#047857]/10 ${state.className}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-lg ${state.dotClassName}`} />
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.14em]">{state.label}</p>
          <p className="mt-1 text-sm font-black">{label}</p>
          <p className="mt-1 text-sm font-semibold leading-5 opacity-80">{value}</p>
        </div>
      </div>
    </div>
  )
}

function DevelopmentRecordCommandPanel({
  contactNounPlural,
  enabledFieldCount,
  formData,
  isEmailEnabled,
  isPdfAttachmentApproved,
  previousEvaluationCount,
  selectedContactCount,
  selectedResponseCount,
}) {
  const selectedPlayerName = normalizePlayerName(formData.playerName)
  const selectedTeam = String(formData.team ?? '').trim()
  const selectedSession = formatSessionForDisplay(formData.session)
  const hasPlayer = Boolean(selectedPlayerName)
  const hasTeam = Boolean(selectedTeam)
  const hasFields = enabledFieldCount > 0
  const nextAction = !hasTeam
    ? 'Pick the team first.'
    : !hasPlayer
      ? 'Pick the player.'
      : !hasFields
        ? 'Enable development fields for this club.'
        : selectedResponseCount === 0
          ? 'Complete the useful development fields.'
          : 'Save the development record.'

  return (
    <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
      <div className="grid gap-5 border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Record workspace</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Build one clear development record.</h3>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
            Work top to bottom: player, development detail, then sharing choice. Save internal notes first unless the parent output is ready.
          </p>
        </div>
        <div className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 shadow-sm shadow-[#047857]/10">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">Next action</p>
          <p className="mt-2 text-lg font-black text-[#101828]">{nextAction}</p>
        </div>
      </div>

      <div className="grid gap-3 px-5 py-5 md:grid-cols-3">
        <RecordReadinessItem
          isReady={hasTeam}
          label="Team"
          value={hasTeam ? selectedTeam : 'Required before saving.'}
        />
        <RecordReadinessItem
          isReady={hasPlayer}
          label="Player"
          value={hasPlayer ? selectedPlayerName : 'Required before saving.'}
        />
        <RecordReadinessItem
          isReady={hasFields}
          label="Development fields"
          value={hasFields ? `${enabledFieldCount} field${enabledFieldCount === 1 ? '' : 's'} available.` : 'No enabled fields found.'}
        />
      </div>

      <div className="grid gap-3 border-t border-[#d7e5dc] bg-[#f7faf8] px-5 py-4 text-sm font-semibold text-[#4b5f55] md:grid-cols-3">
        <p>
          Session: <span className="font-black text-[#101828]">{selectedSession}</span>
        </p>
        <p>
          Previous records: <span className="font-black text-[#101828]">{previousEvaluationCount}</span>
        </p>
        <p>
          Output: <span className="font-black text-[#101828]">{isEmailEnabled
            ? isPdfAttachmentApproved ? 'Email selected parents with PDF' : 'Email selected parents'
            : 'Internal only'}</span>
        </p>
        <p className="md:col-span-3">
          Recipients: <span className="font-black text-[#101828]">{selectedContactCount} selected {contactNounPlural}</span>
        </p>
      </div>
    </section>
  )
}

function FeedbackFormSelectionSection({
  feedbackForms,
  hasUnavailableSelectedForm,
  isEditingHistoricalForm,
  isDefaultFeedbackFormSelected,
  isLoadingFeedbackForms,
  onSelectFeedbackForm,
  selectedFeedbackForm,
  selectedFeedbackFormId,
}) {
  if (isEditingHistoricalForm) {
    return (
      <section className="rounded-lg border border-[#d7e5dc] bg-white px-5 py-5 shadow-sm shadow-[#047857]/10 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Feedback form</p>
        <h3 className="mt-2 text-xl font-black text-[#101828]">{selectedFeedbackForm?.name || 'Historical form snapshot'}</h3>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
          This record is using the form snapshot saved at submission time.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-[#d7e5dc] bg-white px-5 py-5 shadow-sm shadow-[#047857]/10 sm:px-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)] lg:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Feedback form</p>
          <h3 className="mt-2 text-xl font-black text-[#101828]">Select feedback form</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
            Choose the default development form or an active team form to complete for this player.
          </p>
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-black text-[#101828]">Form</span>
          <select
            value={selectedFeedbackFormId}
            onChange={(event) => onSelectFeedbackForm(event.target.value)}
            disabled={isLoadingFeedbackForms}
            className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">
              {isLoadingFeedbackForms ? 'Loading forms' : 'Choose a form'}
            </option>
            <option value={DEFAULT_FEEDBACK_FORM_ID}>Default development form</option>
            {hasUnavailableSelectedForm ? (
              <option value={selectedFeedbackFormId}>Saved form unavailable</option>
            ) : null}
            {feedbackForms.map((form) => (
              <option key={form.selectionId || form.id} value={form.selectionId || form.id}>
                {form.name}{form.isRecommended ? ' (Recommended)' : ''}{form.isPlatformTemplate ? ' | Starter' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!isLoadingFeedbackForms && feedbackForms.length === 0 ? (
        <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold leading-6 text-[#4b5f55]">
          No feedback forms yet. A Team Admin or Manager can create reusable forms for coaches to complete.
        </p>
      ) : null}
      {!isLoadingFeedbackForms && hasUnavailableSelectedForm ? (
        <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold leading-6 text-[#4b5f55]">
          This draft references a form that is not available. Choose the default development form or another active form before saving.
        </p>
      ) : null}
      {!isLoadingFeedbackForms && isDefaultFeedbackFormSelected ? (
        <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold leading-6 text-[#4b5f55]">
          The default development fields will be used for this record.
        </p>
      ) : null}
    </section>
  )
}

export function CreateEvaluationPage() {
  const { user } = useAuth()
  const isPlatformOwner = isSuperAdmin(user)
  const formRef = useRef(null)
  const hasInitializedRef = useRef(false)
  const manualDraftSavePromiseRef = useRef(null)
  const privateDraftInfoRef = useRef(null)
  const submissionPromiseRef = useRef(null)
  const persistedEvaluationForRetryRef = useRef(null)
  const evaluationContentRevisionRef = useRef(0)
  const developmentRecipientContextKeyRef = useRef('')
  const hasUnsavedChangesRef = useRef(false)
  const currentMeaningfulDraftSignatureRef = useRef('')
  const meaningfulDraftBaselineRef = useRef('')
  const hasMeaningfulUserChangeRef = useRef(false)
  const pendingContextChangeRef = useRef(null)
  const restoredPrivateDraftExportLabelsRef = useRef(null)
  const serverDraftRestoreCompleteKeyRef = useRef('')
  const serverDraftRestoreKeyRef = useRef('')
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const userScopeKey = user ? `${user.id}:${user.clubId || 'platform'}:${user.role}:${user.roleRank}` : ''
  const canUseParentEmail = canUseUiFeature(user, CAPABILITIES.parentEmails)
  const hasDevelopmentPdfAccess =
    isDevelopmentPdfClientEnabled(import.meta.env) &&
    canUseUiFeature(user, CAPABILITIES.pdfReports)
  const searchParamsKey = searchParams.toString()
  const editingEvaluationId = String(searchParams.get('evaluationId') ?? '').trim()
  const requestedAssessmentSection = String(searchParams.get('section') ?? '').trim()
  const requestedAssessmentSessionId = String(searchParams.get('sessionId') ?? '').trim()
  const requestedAssessmentPlayer = String(searchParams.get('player') ?? '').trim()
  const shouldChooseAssessmentPlayer =
    !editingEvaluationId &&
    String(searchParams.get('choosePlayer') ?? '').trim() === '1' &&
    !requestedAssessmentPlayer
  const hasInvalidAssessmentSection =
    Boolean(requestedAssessmentSection) && !EVALUATION_SECTIONS.includes(requestedAssessmentSection)
  const hasIncompleteSessionAssessmentLink = Boolean(requestedAssessmentSessionId) && !requestedAssessmentPlayer
  const activeTeamScope = user?.activeTeamId || user?.activeTeamName || 'all'
  const teamsCacheKey = user ? `assessment-teams:${user.id}:${user.clubId || 'platform'}:${activeTeamScope}` : ''
  const fieldsCacheKey = user ? `assessment-fields:${user.id}:${user.clubId || 'platform'}:${activeTeamScope}` : ''
  const cachedTeams = readViewCacheValue(teamsCacheKey, 'availableTeams', [])
  const cachedFields = readViewCache(fieldsCacheKey)
  const [formData, setFormData] = useState(() => createInitialFormData(user))
  const [dynamicFields, setDynamicFields] = useState(() => {
    const nextCachedFields = Array.isArray(cachedFields?.dynamicFields) ? cachedFields.dynamicFields : []
    return nextCachedFields
  })
  const [feedbackForms, setFeedbackForms] = useState([])
  const [selectedFeedbackFormId, setSelectedFeedbackFormId] = useState('')
  const [isLoadingFeedbackForms, setIsLoadingFeedbackForms] = useState(false)
  const [availableTeams, setAvailableTeams] = useState(() => (Array.isArray(cachedTeams) ? cachedTeams : []))
  const [savedPlayers, setSavedPlayers] = useState([])
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(false)
  const [assessmentPlayerSearch, setAssessmentPlayerSearch] = useState('')
  const [previousEvaluations, setPreviousEvaluations] = useState([])
  const [editingEvaluation, setEditingEvaluation] = useState(null)
  const [responseValues, setResponseValues] = useState({})
  const [isFallbackFields, setIsFallbackFields] = useState(() => Boolean(cachedFields?.isFallbackFields))
  const [isLoadingFields, setIsLoadingFields] = useState(() => !cachedFields?.dynamicFields)
  const [isLoadingTeams, setIsLoadingTeams] = useState(() => !cachedTeams?.length)
  const [isSaved, setIsSaved] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSendingParentEmail, setIsSendingParentEmail] = useState(false)
  const [isPrintingBlankView, setIsPrintingBlankView] = useState(false)
  const [lastSavedPlayerName, setLastSavedPlayerName] = useState('')
  const [lastUsedSession, setLastUsedSession] = useState('')
  const [previewMode, setPreviewMode] = useState('scored')
  const [isPdfAttachmentApproved, setIsPdfAttachmentApproved] = useState(false)
  const [includeAttendanceSummary, setIncludeAttendanceSummary] = useState(true)
  const [emailSendMode, setEmailSendMode] = useState('now')
  const [scheduledEmailDateTime, setScheduledEmailDateTime] = useState('')
  const [isDefaultTemplateConfirmOpen, setIsDefaultTemplateConfirmOpen] = useState(false)
  const [hasApprovedDefaultTemplate, setHasApprovedDefaultTemplate] = useState(false)
  const [showPreviousAssessments, setShowPreviousAssessments] = useState(false)
  const [isPreviousScoresConfirmOpen, setIsPreviousScoresConfirmOpen] = useState(false)
  const [previousScoresPromptKey, setPreviousScoresPromptKey] = useState('')
  const promptedPreviousScoresKeyRef = useRef('')
  const [emailTemplateKey, setEmailTemplateKey] = useState('')
  const [emailTemplates, setEmailTemplates] = useState([])
  const [isLoadingEmailTemplates, setIsLoadingEmailTemplates] = useState(false)
  const [selectedParentContactIndexes, setSelectedParentContactIndexes] = useState([0])
  const [developmentParentRecipients, setDevelopmentParentRecipients] = useState([])
  const [selectedDevelopmentParentLinkIds, setSelectedDevelopmentParentLinkIds] = useState([])
  const [isLoadingDevelopmentParentRecipients, setIsLoadingDevelopmentParentRecipients] = useState(false)
  const [developmentParentRecipientLoadError, setDevelopmentParentRecipientLoadError] = useState('')
  const [developmentPdfServerAvailable, setDevelopmentPdfServerAvailable] = useState(null)
  const [inviteDate, setInviteDate] = useState('')
  const [selectedExportLabels, setSelectedExportLabels] = useState(null)
  const [actionErrorMessage, setActionErrorMessage] = useState('')
  const [dataRefreshNotice, setDataRefreshNotice] = useState('')
  const [teamsLoadErrorMessage, setTeamsLoadErrorMessage] = useState('')
  const [evaluationClientId, setEvaluationClientId] = useState(createLocalId)
  const [nextAssessmentReminderChoice, setNextAssessmentReminderChoice] = useState('skip')
  const [nextAssessmentReminderDate, setNextAssessmentReminderDate] = useState('')
  const [isFinalReviewOpen, setIsFinalReviewOpen] = useState(false)
  const [completionModal, setCompletionModal] = useState(null)
  const [completionNavigationUrl, setCompletionNavigationUrl] = useState('')
  const [archiveAfterNoPlace, setArchiveAfterNoPlace] = useState(false)
  const [privateDraftInfo, setPrivateDraftInfo] = useState(null)
  const [privateDraftStatus, setPrivateDraftStatus] = useState('idle')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isContextChangePending, setIsContextChangePending] = useState(false)
  const [isLoadingDraft, setIsLoadingDraft] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const meaningfulDraftSignature = createDevelopmentMeaningfulStateSignature({
    archiveAfterNoPlace,
    emailSendMode,
    emailTemplateKey,
    formData,
    includeAttendanceSummary,
    inviteDate,
    isPdfAttachmentApproved,
    nextAssessmentReminderChoice,
    nextAssessmentReminderDate,
    previewMode,
    responseValues,
    scheduledEmailDateTime,
    selectedDevelopmentParentLinkIds,
    selectedExportLabels,
    selectedParentContactIndexes,
  })
  currentMeaningfulDraftSignatureRef.current = meaningfulDraftSignature
  const buildCurrentPrivateDraftContext = useCallback((currentFormData = formData) => {
    const playerName = normalizePlayerName(currentFormData.playerName)
    const matchingPlayer = findSavedPlayerForEvaluation(
      savedPlayers,
      playerName,
      currentFormData.team,
      user?.activeTeamId,
    )

    return buildPrivateEvaluationDraftContext({
      editingEvaluationId,
      formData: {
        ...currentFormData,
        playerId: matchingPlayer?.id || currentFormData.playerId || '',
      },
      selectedFeedbackFormId,
      user,
    })
  }, [editingEvaluationId, formData, savedPlayers, selectedFeedbackFormId, user])

  useEffect(() => {
    privateDraftInfoRef.current = privateDraftInfo
  }, [privateDraftInfo])

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges
  }, [hasUnsavedChanges])

  const buildCurrentPrivateDraftPayload = useCallback((saveVersion = 0) => (
    createPrivateEvaluationDraftPayload({
      archiveAfterNoPlace,
      emailSendMode,
      emailTemplateKey,
      formData,
      includeAttendanceSummary,
      isPdfAttachmentApproved,
      inviteDate,
      lastUsedSession,
      previewMode,
      responseValues,
      saveVersion,
      scheduledEmailDateTime,
      selectedDevelopmentParentLinkIds,
      selectedFeedbackFormId,
      selectedExportLabels,
      selectedParentContactIndexes,
      nextAssessmentReminderChoice,
      nextAssessmentReminderDate,
    })
  ), [
    archiveAfterNoPlace,
    emailSendMode,
    emailTemplateKey,
    formData,
    includeAttendanceSummary,
    isPdfAttachmentApproved,
    inviteDate,
    lastUsedSession,
    previewMode,
    responseValues,
    scheduledEmailDateTime,
    selectedDevelopmentParentLinkIds,
    selectedFeedbackFormId,
    selectedExportLabels,
    selectedParentContactIndexes,
    nextAssessmentReminderChoice,
    nextAssessmentReminderDate,
  ])

  const restorePrivateDraftPayload = useCallback((draft) => {
    const payload = draft?.payload || draft

    if (!payload || !hasPrivateEvaluationDraftContent(payload)) {
      return false
    }

    const restoredFormData =
      payload.formData && typeof payload.formData === 'object'
        ? payload.formData
        : {}
    const restoredSession = normalizeSessionValue(restoredFormData.session)
    const rememberedSession = normalizeSessionValue(payload.lastUsedSession)
    const nextSessionValue = restoredSession || rememberedSession || formData.session

    setFormData(createInitialFormData(user, {
      ...restoredFormData,
      coachName: user.name || '',
      session: nextSessionValue,
    }))
    setPreviewMode(normalizeDevelopmentPreviewMode(payload.previewMode))
    setEmailTemplateKey(String(payload.emailTemplateKey ?? ''))
    setSelectedParentContactIndexes(
      Array.isArray(payload.selectedParentContactIndexes) && payload.selectedParentContactIndexes.length > 0
        ? payload.selectedParentContactIndexes
        : [0],
    )
    setInviteDate(normalizeSessionValue(payload.inviteDate))
    setResponseValues(payload.responseValues && typeof payload.responseValues === 'object' ? payload.responseValues : {})
    setSelectedFeedbackFormId(String(payload.selectedFeedbackFormId ?? '').trim())
    setLastUsedSession(nextSessionValue)
    setIncludeAttendanceSummary(payload.includeAttendanceSummary !== false)
    setIsPdfAttachmentApproved(payload.isPdfAttachmentApproved === true)
    setEmailSendMode(payload.emailSendMode === 'scheduled' ? 'scheduled' : 'now')
    setScheduledEmailDateTime(String(payload.scheduledEmailDateTime ?? ''))
    setSelectedDevelopmentParentLinkIds(
      Array.isArray(payload.selectedDevelopmentParentLinkIds)
        ? payload.selectedDevelopmentParentLinkIds
        : [],
    )
    restoredPrivateDraftExportLabelsRef.current = Array.isArray(payload.selectedExportLabels)
      ? payload.selectedExportLabels
      : null
    setSelectedExportLabels(restoredPrivateDraftExportLabelsRef.current)
    setArchiveAfterNoPlace(Boolean(payload.archiveAfterNoPlace))
    setNextAssessmentReminderChoice(payload.nextAssessmentReminderChoice === 'set' ? 'set' : 'skip')
    setNextAssessmentReminderDate(String(payload.nextAssessmentReminderDate ?? ''))

    if (draft?.id) {
      const nextInfo = {
        clientSaveVersion: Number(payload.draftMeta?.clientSaveVersion || 0),
        id: draft.id,
        lastSavedAt: draft.lastSavedAt || draft.updatedAt || '',
        restoredAt: draft.lastSavedAt || draft.updatedAt || '',
        source: 'server',
      }

      privateDraftInfoRef.current = nextInfo
      setPrivateDraftInfo(nextInfo)
    }

    hasUnsavedChangesRef.current = false
    hasMeaningfulUserChangeRef.current = false
    setHasUnsavedChanges(false)
    setPrivateDraftStatus('restored')
    return true
  }, [formData.session, user])

  const markDraftUnsaved = useCallback(() => {
    if (!hasInitializedRef.current) {
      return
    }

    hasMeaningfulUserChangeRef.current = true
  }, [])

  const clearDraftBaseline = useCallback((status = 'idle') => {
    meaningfulDraftBaselineRef.current = currentMeaningfulDraftSignatureRef.current
    hasMeaningfulUserChangeRef.current = false
    hasUnsavedChangesRef.current = false
    setHasUnsavedChanges(false)
    setPrivateDraftStatus(status)
  }, [])

  useEffect(() => {
    if (!hasInitializedRef.current) {
      return
    }

    if (!meaningfulDraftBaselineRef.current || !hasMeaningfulUserChangeRef.current) {
      meaningfulDraftBaselineRef.current = meaningfulDraftSignature
      hasUnsavedChangesRef.current = false
      setHasUnsavedChanges(false)
      return
    }

    const isDirty = meaningfulDraftSignature !== meaningfulDraftBaselineRef.current
    hasUnsavedChangesRef.current = isDirty
    setHasUnsavedChanges(isDirty)
    setPrivateDraftStatus(isDirty ? 'unsaved' : 'idle')
  }, [meaningfulDraftSignature])

  useEffect(() => {
    if (!user) {
      return
    }

    const requestedPlayerName = String(searchParams.get('player') ?? '').trim()
    const requestedTeam = String(searchParams.get('team') ?? '').trim()
    const requestedSession = normalizeSessionValue(searchParams.get('session'))
    const requestedSection = String(searchParams.get('section') ?? '').trim()
    const nextFormData = createInitialFormData(user, {
      playerName: requestedPlayerName,
      team: requestedTeam,
      section: EVALUATION_SECTIONS.includes(requestedSection) ? requestedSection : 'Trial',
      session: requestedSession,
      coachName: user.name || '',
    })

    serverDraftRestoreCompleteKeyRef.current = ''
    serverDraftRestoreKeyRef.current = ''
    setIsLoadingDraft(false)
    setFormData(nextFormData)
    setSelectedFeedbackFormId(String(searchParams.get('feedbackForm') ?? '').trim())
    privateDraftInfoRef.current = null
    setPrivateDraftInfo(null)
    clearDraftBaseline('idle')
    hasInitializedRef.current = true
  }, [clearDraftBaseline, searchParams, searchParamsKey, user, userScopeKey])

  useEffect(() => {
    if (
      !hasInitializedRef.current ||
      !user ||
      isPlatformOwner ||
      isDemoUser(user) ||
      editingEvaluationId ||
      shouldChooseAssessmentPlayer ||
      !selectedFeedbackFormId
    ) {
      return undefined
    }

    const draftContext = buildCurrentPrivateDraftContext(formData)
    const hasDraftContext = Boolean(
      (draftContext.playerName || draftContext.playerId) &&
      (draftContext.teamId || draftContext.teamName) &&
      draftContext.formId,
    )

    if (!hasDraftContext) {
      setIsLoadingDraft(false)
      return undefined
    }

    const restoreKey = `${draftContext.clubId}:${draftContext.createdByUserId}:${getEvaluationDraftContextKey(draftContext)}`

    if (serverDraftRestoreKeyRef.current === restoreKey) {
      return undefined
    }

    serverDraftRestoreKeyRef.current = restoreKey
    setIsLoadingDraft(true)

    const restoreServerDraft = async () => {
      try {
        const serverDraft = await findServerEvaluationDraft({
          context: draftContext,
          user,
        })

        if (
          serverDraftRestoreKeyRef.current !== restoreKey ||
          hasUnsavedChangesRef.current
        ) {
          return
        }

        if (serverDraft?.payload && hasPrivateEvaluationDraftContent(serverDraft.payload)) {
          serverDraftRestoreCompleteKeyRef.current = restoreKey
          restorePrivateDraftPayload(serverDraft)
          return
        }

        serverDraftRestoreCompleteKeyRef.current = restoreKey
        privateDraftInfoRef.current = null
        setPrivateDraftInfo(null)
        clearDraftBaseline('idle')
      } catch (error) {
        console.error(error)
        if (serverDraftRestoreKeyRef.current === restoreKey) {
          setActionErrorMessage('Saved drafts could not be checked. Refresh the page before saving this draft.')
        }
      } finally {
        if (serverDraftRestoreKeyRef.current === restoreKey) {
          setIsLoadingDraft(false)
        }
      }
    }

    void restoreServerDraft()
  }, [
    buildCurrentPrivateDraftContext,
    clearDraftBaseline,
    editingEvaluationId,
    formData,
    isPlatformOwner,
    restorePrivateDraftPayload,
    selectedFeedbackFormId,
    shouldChooseAssessmentPlayer,
    user,
  ])

  useEffect(() => {
    let isMounted = true
    const cachedTeamsValue = readViewCacheValue(teamsCacheKey, 'availableTeams', [])

    const loadTeams = async () => {
      if (!user || isPlatformOwner) {
        setAvailableTeams([])
        setIsLoadingTeams(false)
        return
      }

      setTeamsLoadErrorMessage('')

      try {
        const nextTeams = await withRequestTimeout(
          () => getAvailableTeamsForUser(user),
          'Could not load teams. No team data entered yet, or the request took too long.',
        )

        if (!isMounted) {
          return
        }

        setAvailableTeams(nextTeams)
        setDataRefreshNotice((current) =>
          current.startsWith('Live team data') || current.startsWith('The latest team list')
            ? ''
            : current,
        )
        writeViewCache(teamsCacheKey, {
          availableTeams: nextTeams,
        })
        setFormData((current) => {
          const requestedTeam = String(searchParams.get('team') ?? '').trim()
          const currentTeam = String(current.team ?? '').trim()

          if (currentTeam && nextTeams.some((team) => team.name === currentTeam)) {
            return current
          }

          if (requestedTeam && nextTeams.some((team) => team.name === requestedTeam)) {
            return {
              ...current,
              team: requestedTeam,
            }
          }

          return {
            ...current,
            team: nextTeams[0]?.name || '',
          }
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          if (cachedTeamsValue?.length) {
            setDataRefreshNotice('The latest team list could not be refreshed. The last available team setup is still shown.')
          } else {
            setAvailableTeams([])
            setTeamsLoadErrorMessage('Team data could not be loaded right now. Try again in a moment.')
          }
        }
      } finally {
        if (isMounted) {
          setIsLoadingTeams(false)
        }
      }
    }

    void loadTeams()

    return () => {
      isMounted = false
    }
  }, [isPlatformOwner, searchParams, searchParamsKey, teamsCacheKey, user, userScopeKey])

  useEffect(() => {
    let isMounted = true

    const loadSavedPlayers = async () => {
      if (!user || isPlatformOwner) {
        setSavedPlayers([])
        return
      }

      try {
        setIsLoadingPlayers(true)
        const nextPlayers = await withRequestTimeout(() => getPlayers({ user }), 'Could not load saved players.')

        if (!isMounted) {
          return
        }

        setSavedPlayers(nextPlayers)
        const requestedPlayerName = String(searchParams.get('player') ?? '').trim()
        const requestedPlayerId = String(searchParams.get('playerId') ?? '').trim()
        const requestedTeam = String(searchParams.get('team') ?? '').trim()
        const requestedSection = String(searchParams.get('section') ?? '').trim()
        const matchingPlayer = (() => {
          if (requestedPlayerId) {
            return nextPlayers.find((player) => String(player.id ?? '') === requestedPlayerId) || null
          }

          if (!requestedPlayerName) {
            return null
          }

          const normalizedPlayerName = normalizePlayerName(requestedPlayerName)
          const sameNamePlayers = nextPlayers.filter((player) => normalizePlayerName(player.playerName) === normalizedPlayerName)

          return (
            sameNamePlayers.find(
              (player) =>
                (!requestedTeam || player.team === requestedTeam) &&
                (!requestedSection || player.section === requestedSection),
            ) ||
            sameNamePlayers.find((player) => !requestedTeam || player.team === requestedTeam) ||
            sameNamePlayers[0]
          )
        })()

        if (matchingPlayer) {
          const parentContacts = normalizeParentContacts(matchingPlayer.parentContacts, {
            parentName: matchingPlayer.parentName,
            parentEmail: matchingPlayer.parentEmail,
          })

          setFormData((current) => ({
            ...current,
            playerName: matchingPlayer.playerName,
            parentName: parentContacts[0]?.name || '',
            parentEmail: parentContacts[0]?.email || '',
            parentContacts,
            contactType: normalizePlayerContactType(matchingPlayer.contactType),
            team: requestedTeam || matchingPlayer.team || current.team,
            section: matchingPlayer.section || requestedSection || current.section,
          }))
          setSelectedParentContactIndexes(parentContacts.length > 0 ? parentContacts.map((_, index) => index) : [0])
        }
      } catch (error) {
        console.error(error)
      } finally {
        if (isMounted) {
          setIsLoadingPlayers(false)
        }
      }
    }

    void loadSavedPlayers()

    return () => {
      isMounted = false
    }
  }, [isPlatformOwner, searchParams, searchParamsKey, user, userScopeKey])

  useEffect(() => {
    let isMounted = true
    const playerName = normalizePlayerName(formData.playerName)

    const loadPreviousEvaluations = async () => {
      if (!user || isPlatformOwner || !playerName) {
        setPreviousEvaluations([])
        return
      }

      try {
        const nextEvaluations = await withRequestTimeout(
          () => getEvaluations({ user, playerName }),
          'Could not load previous development records.',
        )

        if (!isMounted) {
          return
        }

        setPreviousEvaluations(
          nextEvaluations
            .filter((evaluation) => String(evaluation.id) !== String(editingEvaluationId))
            .filter((evaluation) => !formData.team || evaluation.team === formData.team)
            .slice(0, 5),
        )
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setPreviousEvaluations([])
        }
      }
    }

    void loadPreviousEvaluations()

    return () => {
      isMounted = false
    }
  }, [editingEvaluationId, formData.playerName, formData.team, isPlatformOwner, user, userScopeKey])

  useEffect(() => {
    const playerName = normalizePlayerName(formData.playerName)
    const team = String(formData.team ?? '').trim()
    const promptKey = `${playerName}:${team}`

    if (editingEvaluation || previousEvaluations.length === 0 || !playerName || promptedPreviousScoresKeyRef.current === promptKey) {
      return
    }

    promptedPreviousScoresKeyRef.current = promptKey
    setPreviousScoresPromptKey(promptKey)
    setIsPreviousScoresConfirmOpen(true)
  }, [editingEvaluation, formData.playerName, formData.team, previousEvaluations.length])

  useEffect(() => {
    let isMounted = true

    const loadEditingEvaluation = async () => {
      if (!editingEvaluationId || !user || isPlatformOwner) {
        setEditingEvaluation(null)
        return
      }

      try {
        const nextEvaluations = await withRequestTimeout(() => getEvaluations({ user }), 'Could not load development record.')
        const targetEvaluation = nextEvaluations.find((evaluation) => String(evaluation.id) === editingEvaluationId)

        if (!isMounted) {
          return
        }

        if (!targetEvaluation) {
          setActionErrorMessage('This development record could not be found. It may have been removed or you may not have access.')
          setEditingEvaluation(null)
          return
        }

        setEditingEvaluation(targetEvaluation)
        persistedEvaluationForRetryRef.current = {
          contentRevision: evaluationContentRevisionRef.current,
          evaluation: targetEvaluation,
          fingerprint: '',
        }
        setFormData((current) =>
          createInitialFormData(user, {
            ...current,
            playerName: targetEvaluation.playerName,
            team: targetEvaluation.team,
            section: targetEvaluation.section || 'Trial',
            session: normalizeSessionValue(targetEvaluation.session),
            coachName: targetEvaluation.coach || current.coachName,
            parentName: targetEvaluation.parentName,
            parentEmail: targetEvaluation.parentEmail,
            parentContacts: normalizeParentContacts(targetEvaluation.parentContacts, {
              parentName: targetEvaluation.parentName,
              parentEmail: targetEvaluation.parentEmail,
            }),
            contactType: normalizePlayerContactType(targetEvaluation.contactType),
          }),
        )
        setSelectedParentContactIndexes(
          targetEvaluation.parentContacts?.length
            ? targetEvaluation.parentContacts.map((_, index) => index)
            : [0],
        )
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setActionErrorMessage('This development record could not be loaded for editing. Try again in a moment.')
          setEditingEvaluation(null)
        }
      }
    }

    void loadEditingEvaluation()

    return () => {
      isMounted = false
    }
  }, [editingEvaluationId, isPlatformOwner, user, userScopeKey])

  useEffect(() => {
    let isMounted = true
    const cachedFieldsValue = readViewCache(fieldsCacheKey)

    const loadFields = async () => {
      if (!user || isPlatformOwner) {
        setDynamicFields([])
        setResponseValues({})
        setIsLoadingFields(false)
        return
      }

      try {
        const { fields, isFallback } = await withRequestTimeout(
          () => getFormFields({ user }),
          'Could not load form fields. Showing default empty form instead.',
        )

        if (!isMounted) {
          return
        }

        setDynamicFields(fields)
        setIsFallbackFields(isFallback)
        setDataRefreshNotice((current) =>
          current.startsWith('Live form fields') || current.startsWith('Default development fields')
            ? ''
            : current,
        )
        writeViewCache(fieldsCacheKey, {
          dynamicFields: fields,
          isFallbackFields: isFallback,
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          const fallbackFields = getDefaultFormFields()
          if (!cachedFieldsValue?.dynamicFields) {
            setDynamicFields(fallbackFields)
            setIsFallbackFields(true)
            setDataRefreshNotice('Default development fields are in use because the saved club form could not be loaded.')
          } else {
            setDataRefreshNotice('Live form fields could not be refreshed. The last available form setup is still shown.')
          }
        }
      } finally {
        if (isMounted) {
          setIsLoadingFields(false)
        }
      }
    }

    void loadFields()

    return () => {
      isMounted = false
    }
  }, [fieldsCacheKey, isPlatformOwner, user, userScopeKey])

  useEffect(() => {
    let isMounted = true

    const loadFeedbackForms = async () => {
      if (!user || isPlatformOwner) {
        setFeedbackForms([])
        setSelectedFeedbackFormId('')
        setIsLoadingFeedbackForms(false)
        return
      }

      setIsLoadingFeedbackForms(true)

      try {
        const forms = await withRequestTimeout(
          () => getActiveFeedbackForms({ user }),
          'Could not load feedback forms.',
        )

        if (!isMounted) {
          return
        }

        setFeedbackForms(forms)
        setSelectedFeedbackFormId((current) => {
          if (editingEvaluation?.feedbackFormId) {
            return String(editingEvaluation.feedbackFormId)
          }

          const requestedFeedbackForm = String(searchParams.get('feedbackForm') ?? '').trim()
          return requestedFeedbackForm || String(current ?? '').trim()
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setFeedbackForms([])
          setDataRefreshNotice((current) => current || 'Feedback forms could not be loaded. The default development fields are still available.')
        }
      } finally {
        if (isMounted) {
          setIsLoadingFeedbackForms(false)
        }
      }
    }

    void loadFeedbackForms()

    return () => {
      isMounted = false
    }
  }, [editingEvaluation?.feedbackFormId, isPlatformOwner, searchParams, user, userScopeKey])

  useEffect(() => {
    let isMounted = true

    const loadEmailTemplates = async () => {
      if (!user?.clubId || !canUseParentEmail) {
        setEmailTemplates([])
        return
      }

      setIsLoadingEmailTemplates(true)

      try {
        const nextTemplates = mergeEmailTemplatesWithDefaults(
          await getParentEmailTemplates({ user, audience: 'all' }),
          'all',
        )

        if (isMounted) {
          setEmailTemplates(nextTemplates)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setEmailTemplates(mergeEmailTemplatesWithDefaults([], 'all'))
        }
      } finally {
        if (isMounted) {
          setIsLoadingEmailTemplates(false)
        }
      }
    }

    void loadEmailTemplates()

    return () => {
      isMounted = false
    }
  }, [canUseParentEmail, user, userScopeKey])

  useEffect(() => {
    if (!isSaved) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setIsSaved(false)
    }, 3000)

    return () => window.clearTimeout(timeoutId)
  }, [isSaved])

  useEffect(() => {
    if (!isPrintingBlankView) {
      return undefined
    }

    const handleAfterPrint = () => {
      setIsPrintingBlankView(false)
    }

    const timeoutId = window.setTimeout(() => {
      window.print()
    }, 100)

    window.addEventListener('afterprint', handleAfterPrint)

    return () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('afterprint', handleAfterPrint)
    }
  }, [isPrintingBlankView])

  const navigationBlocker = useBlocker(hasUnsavedChanges)

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!hasUnsavedChangesRef.current) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    if (!editingEvaluation || dynamicFields.length === 0) {
      return
    }

    const snapshotFields = editingEvaluation.feedbackFormSnapshot?.fields
    const fieldsForEditing = Array.isArray(snapshotFields) && snapshotFields.length > 0 ? snapshotFields : dynamicFields
    setResponseValues(mapEvaluationResponsesToFieldValues(fieldsForEditing, editingEvaluation.formResponses))
  }, [dynamicFields, editingEvaluation])

  const selectedFeedbackForm = useMemo(
    () => feedbackForms.find((form) => String(form.selectionId || form.id) === String(selectedFeedbackFormId)) || null,
    [feedbackForms, selectedFeedbackFormId],
  )
  const snapshotFields = editingEvaluation?.feedbackFormSnapshot?.fields
  const hasHistoricalFeedbackFormSnapshot = Array.isArray(snapshotFields) && snapshotFields.length > 0
  const isDefaultFeedbackFormSelected = selectedFeedbackFormId === DEFAULT_FEEDBACK_FORM_ID
  const hasUnavailableSelectedForm = Boolean(
    selectedFeedbackFormId &&
      !isDefaultFeedbackFormSelected &&
      !selectedFeedbackForm &&
      !hasHistoricalFeedbackFormSnapshot,
  )
  const hasFeedbackFormSelection = isDefaultFeedbackFormSelected || Boolean(selectedFeedbackForm)
  const isSelectedFeedbackFormReady = Boolean(
    hasHistoricalFeedbackFormSnapshot ||
      (isDefaultFeedbackFormSelected && !isLoadingFields) ||
      selectedFeedbackForm,
  )
  const activeFields = useMemo(() => {
    if (hasHistoricalFeedbackFormSnapshot) {
      return snapshotFields
    }

    if (isDefaultFeedbackFormSelected) {
      return dynamicFields
    }

    if (selectedFeedbackFormId) {
      return selectedFeedbackForm?.fields ?? []
    }

    return []
  }, [dynamicFields, hasHistoricalFeedbackFormSnapshot, isDefaultFeedbackFormSelected, selectedFeedbackForm, selectedFeedbackFormId, snapshotFields])

  useEffect(() => {
    if (editingEvaluation || !selectedFeedbackFormId || !isSelectedFeedbackFormReady) {
      return
    }

    setResponseValues((current) => {
      const emptyValues = createEmptyResponseValues(activeFields)
      return Object.fromEntries(Object.keys(emptyValues).map((key) => [key, current[key] ?? '']))
    })
  }, [activeFields, editingEvaluation, isSelectedFeedbackFormReady, selectedFeedbackFormId])

  const enabledFields = useMemo(() => activeFields.filter((field) => field.isEnabled !== false), [activeFields])
  const formResponses = useMemo(() => buildFormResponses(enabledFields, responseValues), [enabledFields, responseValues])
  const scores = useMemo(() => buildScores(formResponses, enabledFields), [enabledFields, formResponses])
  const comments = useMemo(() => buildComments(formResponses), [formResponses])
  const averageScore = useMemo(() => getAverageScore(formResponses, enabledFields), [enabledFields, formResponses])
  const responseItems = useMemo(() => createResponseItems(enabledFields, responseValues), [enabledFields, responseValues])
  const previousFieldValues = useMemo(
    () => buildPreviousFieldValueMap(enabledFields, previousEvaluations),
    [enabledFields, previousEvaluations],
  )
  const feedbackFormSnapshot = useMemo(
    () => buildFeedbackFormSnapshot({ form: selectedFeedbackForm, formResponses }),
    [formResponses, selectedFeedbackForm],
  )
  const canSubmitEvaluation = availableTeams.length > 0
  const canConfigureEmailTemplates = canManageParentEmailTemplates(user) && canUseParentEmail
  const assessmentPlayerOptions = useMemo(() => {
    const activeTeamId = String(user?.activeTeamId ?? '').trim()
    const activeTeamName = String(user?.activeTeamName ?? '').trim()

    return savedPlayers.filter((player) => {
      const playerTeamId = String(player.teamId ?? '').trim()
      const playerTeamName = String(player.team ?? '').trim()

      if (activeTeamId) {
        return playerTeamId ? playerTeamId === activeTeamId : !activeTeamName || playerTeamName === activeTeamName
      }

      if (activeTeamName) {
        return playerTeamName === activeTeamName
      }

      return true
    })
  }, [savedPlayers, user?.activeTeamId, user?.activeTeamName])
  const normalizedContactType = normalizePlayerContactType(formData.contactType)
  const contactAudiences = getContactTemplateAudiences(normalizedContactType)
  const contactAudience = normalizedContactType === PLAYER_CONTACT_TYPES.self ? EMAIL_TEMPLATE_AUDIENCES.player : EMAIL_TEMPLATE_AUDIENCES.parent
  const { contactLabel, contactNoun, contactNounPlural } = getContactCopy(normalizedContactType)
  const selectedResponseItems = useMemo(
    () => getSelectedEvaluationResponses(responseItems, selectedExportLabels),
    [responseItems, selectedExportLabels],
  )
  const normalizedCurrentPlayerName = useMemo(() => normalizePlayerName(formData.playerName), [formData.playerName])
  const hasSavedExportSelection = Array.isArray(selectedExportLabels)
  const readableSession = useMemo(() => formatSessionForDisplay(formData.session), [formData.session])
  const availableEmailTemplates = useMemo(
    () =>
      emailTemplates.filter(
        (template) => {
          const sectionAvailability = Array.isArray(template.sectionAvailability)
            ? template.sectionAvailability
            : EVALUATION_SECTIONS

          return (
            normalizeEmailTemplateAudience(template.audience) === contactAudience &&
            sectionAvailability.includes(formData.section) &&
            template.isEnabled !== false
          )
        },
      ),
    [contactAudience, emailTemplates, formData.section],
  )
  const selectedEmailTemplateKey = availableEmailTemplates.some((template) => template.key === emailTemplateKey)
    ? emailTemplateKey
    : availableEmailTemplates[0]?.key || ''
  const selectedEmailTemplate = availableEmailTemplates.find((template) => template.key === selectedEmailTemplateKey) ?? null
  const isNoPlaceOfferedTemplate = selectedEmailTemplateKey === 'decline'
  const archiveCandidatePlayer = useMemo(
    () => findSavedPlayerForEvaluation(savedPlayers, normalizedCurrentPlayerName, formData.team, user?.activeTeamId),
    [formData.team, normalizedCurrentPlayerName, savedPlayers, user?.activeTeamId],
  )
  const useLinkedParentRecipients = normalizedContactType !== PLAYER_CONTACT_TYPES.self
  const showDevelopmentPdfOption = hasDevelopmentPdfAccess && useLinkedParentRecipients
  const developmentRecipientTeamId = String(
    archiveCandidatePlayer?.teamId ||
    availableTeams.find((team) => team.name === formData.team)?.id ||
    '',
  ).trim()
  const developmentRecipientContextKey = [
    user?.clubId,
    developmentRecipientTeamId,
    archiveCandidatePlayer?.id,
  ].map((value) => String(value ?? '').trim()).join(':')
  const loadDevelopmentParentRecipients = useCallback(async ({ preserveSelected = false } = {}) => {
    if (
      !useLinkedParentRecipients ||
      !user?.clubId ||
      !developmentRecipientTeamId ||
      !archiveCandidatePlayer?.id
    ) {
      developmentRecipientContextKeyRef.current = ''
      setDevelopmentParentRecipients([])
      setSelectedDevelopmentParentLinkIds([])
      setDevelopmentParentRecipientLoadError('')
      setDevelopmentPdfServerAvailable(null)
      return []
    }

    setIsLoadingDevelopmentParentRecipients(true)
    setDevelopmentParentRecipientLoadError('')

    try {
      const result = await getDevelopmentParentEmailRecipientCandidates({
        user,
        player: archiveCandidatePlayer,
        teamId: developmentRecipientTeamId,
      })
      const candidates = result.recipients
      const eligibleCandidates = candidates.filter((candidate) => candidate.eligible)
      const eligibleIds = new Set(eligibleCandidates.map((candidate) => candidate.linkId))
      const isNewContext =
        developmentRecipientContextKeyRef.current !== developmentRecipientContextKey

      developmentRecipientContextKeyRef.current = developmentRecipientContextKey
      setDevelopmentPdfServerAvailable(result.pdfAttachmentAvailable)
      setDevelopmentParentRecipients(eligibleCandidates)
      setSelectedDevelopmentParentLinkIds((current) =>
        isNewContext && !preserveSelected
          ? eligibleCandidates.map((candidate) => candidate.linkId)
          : current.filter((linkId) => eligibleIds.has(linkId)),
      )

      return candidates
    } catch (error) {
      console.error('Development parent recipients could not be loaded', error)
      setDevelopmentPdfServerAvailable(null)
      setDevelopmentParentRecipientLoadError(
        'Linked parent recipients could not be refreshed. Current selections are retained.',
      )
      return null
    } finally {
      setIsLoadingDevelopmentParentRecipients(false)
    }
  }, [
    archiveCandidatePlayer,
    developmentRecipientContextKey,
    developmentRecipientTeamId,
    useLinkedParentRecipients,
    user,
  ])

  useEffect(() => {
    void loadDevelopmentParentRecipients()
  }, [loadDevelopmentParentRecipients])
  const canArchiveAfterNoPlace = isNoPlaceOfferedTemplate &&
    canDeletePlayer(user) &&
    Boolean(archiveCandidatePlayer?.id || editingEvaluation?.playerId)
  const shouldShowInviteDate = previewMode === 'email' && isInviteEmailTemplate(selectedEmailTemplateKey)
  const parentContacts = useMemo(
    () =>
      normalizeParentContacts(formData.parentContacts, {
        parentName: formData.parentName,
        parentEmail: formData.parentEmail,
        contactType: normalizedContactType,
      }),
    [formData.parentContacts, formData.parentEmail, formData.parentName, normalizedContactType],
  )
  const savedParentContacts = useMemo(
    () => normalizeParentContacts(formData.parentContacts, { contactType: normalizedContactType }),
    [formData.parentContacts, normalizedContactType],
  )
  const savedSelfContacts = useMemo(
    () => savedParentContacts
      .map((contact, legacyIndex) => ({ ...contact, legacyIndex }))
      .filter((contact) => contact.type === PLAYER_CONTACT_TYPES.self),
    [savedParentContacts],
  )
  const displayedParentContacts = useMemo(
    () => useLinkedParentRecipients
      ? [
          ...developmentParentRecipients,
          ...(normalizedContactType === PLAYER_CONTACT_TYPES.both ? savedSelfContacts : []),
        ]
      : savedParentContacts,
    [
      developmentParentRecipients,
      normalizedContactType,
      savedParentContacts,
      savedSelfContacts,
      useLinkedParentRecipients,
    ],
  )
  const selectedParentContacts = useMemo(() => {
    if (useLinkedParentRecipients) {
      return displayedParentContacts.filter((contact) =>
        contact.linkId
          ? selectedDevelopmentParentLinkIds.includes(contact.linkId)
          : selectedParentContactIndexes.includes(contact.legacyIndex))
    }

    const selectedContacts = parentContacts.filter((_, index) => selectedParentContactIndexes.includes(index))
    return selectedContacts.length > 0 ? selectedContacts : parentContacts.slice(0, 1)
  }, [
    displayedParentContacts,
    parentContacts,
    selectedDevelopmentParentLinkIds,
    selectedParentContactIndexes,
    useLinkedParentRecipients,
  ])
  const developmentPdfUnavailableReason = !showDevelopmentPdfOption
    ? ''
    : !archiveCandidatePlayer?.id || !developmentRecipientTeamId
      ? 'Select a saved player and team before attaching a PDF report.'
      : isLoadingDevelopmentParentRecipients
        ? 'Checking PDF attachment availability...'
        : developmentParentRecipientLoadError
          ? 'PDF attachment availability could not be confirmed. Refresh the parent contacts and try again.'
          : selectedParentContacts.length === 0
            ? 'Add or select a parent contact before sending this report.'
            : developmentPdfServerAvailable !== true
              ? 'PDF attachment is unavailable for this report type.'
              : ''
  const canUseDevelopmentPdf =
    showDevelopmentPdfOption &&
    developmentPdfUnavailableReason === ''
  const isDemoAccount = isDemoUser(user)
  const noTeamsMessage = canManageUsers(user)
    ? 'No teams exist for this club yet. Create a team first, then development records can be assigned correctly.'
    : 'No teams exist for this club yet. Ask a manager to create a team before adding development records.'
  const finalSubmissionActionLabel = getDevelopmentSubmissionActionLabel({
    emailSendMode,
    previewMode,
  })
  const finalSubmissionReviewItems = buildDevelopmentSubmissionReviewItems({
    emailSendMode,
    includeAttendanceSummary,
    isPdfAttachmentApproved,
    nextAssessmentReminderChoice,
    nextAssessmentReminderDate,
    playerName: formData.playerName,
    previewMode,
    recordDate: formatSessionForDisplay(formData.reportDate || formData.session),
    recipients: selectedParentContacts,
    selectedResponseCount: selectedResponseItems.length,
    teamName: formData.team,
  })

  const getCompletionModalForOutcome = ({
    outcome,
    playerName,
    reminderCreated = false,
    reminderDate = '',
    reminderFailed = false,
    requestedPdf = false,
  }) => {
    const outputFailed = ['no_recipient', 'recipient_review', 'schedule_failed', 'send_failed'].includes(outcome)
    return {
      title: outputFailed
        ? 'Development record saved with output action needed'
        : editingEvaluation
          ? 'Development record updated'
          : 'Development record saved',
      message: outputFailed
        ? outcome === 'recipient_review'
          ? `${playerName} was saved, but the parent email was not sent because the recipient list needs reviewing. Review recipients and retry without creating another record.`
        : requestedPdf
          ? `${playerName} was saved, but the requested PDF failed and the parent email was not sent. Retry is available without creating another record.`
          : `${playerName} was saved, but the requested parent email did not complete. Retry is available without creating another record.`
        : `The final Development submission for ${playerName} completed.`,
      items: buildDevelopmentCompletionItems({
        emailOutcome: outcome,
        isPdfAttachmentApproved: requestedPdf,
        previewMode,
        reminderCreated,
        reminderDate,
        reminderFailed,
      }),
    }
  }

  const handleCompletionContinue = () => {
    const nextUrl = completionNavigationUrl
    setCompletionModal(null)
    setCompletionNavigationUrl('')

    if (nextUrl) {
      navigate(nextUrl)
    }
  }

  const handleSaveDraft = async () => {
    if (manualDraftSavePromiseRef.current) {
      return manualDraftSavePromiseRef.current
    }

    const saveTask = (async () => {
      const draftContext = buildCurrentPrivateDraftContext(formData)
      const hasRequiredContext = Boolean(
        user?.id &&
        user?.clubId &&
        (draftContext.teamId || draftContext.teamName) &&
        (draftContext.playerId || draftContext.playerName) &&
        draftContext.formId &&
        normalizeSessionValue(formData.session),
      )

      if (!hasRequiredContext) {
        setActionErrorMessage('Select a team, player, form and report date before saving the draft.')
        setPrivateDraftStatus('error')
        return null
      }

      const draftRestoreKey = `${draftContext.clubId}:${draftContext.createdByUserId}:${getEvaluationDraftContextKey(draftContext)}`

      if (
        isLoadingDraft ||
        serverDraftRestoreCompleteKeyRef.current !== draftRestoreKey
      ) {
        setActionErrorMessage('Wait for saved drafts to finish loading before saving this draft.')
        return null
      }

      const saveVersion = Number(privateDraftInfoRef.current?.clientSaveVersion || 0) + 1
      const payload = buildCurrentPrivateDraftPayload(saveVersion)

      if (!hasPrivateEvaluationDraftContent(payload)) {
        setActionErrorMessage('Enter Development Record details before saving the draft.')
        setPrivateDraftStatus('error')
        return null
      }

      setIsSavingDraft(true)
      setActionErrorMessage('')
      setPrivateDraftStatus('saving')

      try {
        const serverDraft = await saveServerEvaluationDraft({
          context: draftContext,
          existingDraftId: privateDraftInfoRef.current?.id || '',
          payload,
          skipExistingLookup: !privateDraftInfoRef.current?.id,
          user,
        })

        if (!serverDraft?.id) {
          throw new Error('The server did not confirm the Development Record draft.')
        }

        const nextInfo = {
          clientSaveVersion: saveVersion,
          id: serverDraft.id,
          lastSavedAt: serverDraft.lastSavedAt || new Date().toISOString(),
          restoredAt: privateDraftInfoRef.current?.restoredAt || '',
          source: 'server',
        }
        privateDraftInfoRef.current = nextInfo
        serverDraftRestoreCompleteKeyRef.current = draftRestoreKey
        setPrivateDraftInfo(nextInfo)
        clearDraftBaseline('saved')
        showToast({
          title: 'Draft saved',
          message: 'This Development Record draft is saved privately for your Coach account.',
        })
        return serverDraft
      } catch (error) {
        console.error(error)
        setPrivateDraftStatus('error')
        setActionErrorMessage('Draft could not be saved. Your entered values are still on this page.')
        showToast({
          title: 'Draft could not be saved',
          message: 'Your entered values are still on this page. Try Save Draft again.',
          tone: 'error',
        })
        return null
      } finally {
        setIsSavingDraft(false)
      }
    })()

    manualDraftSavePromiseRef.current = saveTask

    try {
      return await saveTask
    } finally {
      manualDraftSavePromiseRef.current = null
    }
  }

  const handleDiscardPrivateDraft = async () => {
    const activeDraft = privateDraftInfoRef.current

    if (!activeDraft?.id || manualDraftSavePromiseRef.current) {
      return
    }

    setPrivateDraftStatus('saving')

    try {
      const didCloseServerDraft = await closeServerEvaluationDraft({
        draftId: activeDraft.id,
        status: PRIVATE_EVALUATION_DRAFT_STATUSES.discarded,
        user,
      })

      if (!didCloseServerDraft) {
        throw new Error('The saved draft is no longer active.')
      }

      privateDraftInfoRef.current = null
      setPrivateDraftInfo(null)
      setResponseValues(createEmptyResponseValues(dynamicFields))
      clearDraftBaseline('discarded')
      showToast({ title: 'Draft discarded', message: 'The saved Development Record draft has been discarded.' })
    } catch (error) {
      console.error(error)
      setPrivateDraftStatus('error')
      showToast({
        title: 'Draft not discarded',
        message: error.message || 'The Development Record draft could not be discarded.',
        tone: 'error',
      })
    }
  }

  const closeActivePrivateDraftAfterSubmit = async () => {
    const activeDraft = privateDraftInfoRef.current

    if (!activeDraft?.id) {
      clearDraftBaseline('idle')
      return true
    }

    try {
      const didCloseServerDraft = await closeServerEvaluationDraft({
        draftId: activeDraft.id,
        status: PRIVATE_EVALUATION_DRAFT_STATUSES.submitted,
        user,
      })

      if (!didCloseServerDraft) {
        throw new Error('The matching draft was not closed.')
      }

      privateDraftInfoRef.current = null
      setPrivateDraftInfo(null)
      clearDraftBaseline('idle')
      return true
    } catch (error) {
      console.error(error)
      showToast({
        title: 'Draft not closed',
        message: 'The Development Record was saved, but its matching draft could not be closed.',
        tone: 'error',
      })
      return false
    }
  }

  const requestContextChange = (action) => {
    if (!hasUnsavedChangesRef.current) {
      action()
      return
    }

    pendingContextChangeRef.current = action
    setIsContextChangePending(true)
  }

  const handleStayAndContinueEditing = () => {
    pendingContextChangeRef.current = null
    setIsContextChangePending(false)

    if (navigationBlocker.state === 'blocked') {
      navigationBlocker.reset()
    }
  }

  const handleLeaveWithoutSaving = () => {
    const pendingAction = pendingContextChangeRef.current
    pendingContextChangeRef.current = null
    flushSync(() => {
      setIsContextChangePending(false)
      clearDraftBaseline('idle')
    })

    if (navigationBlocker.state === 'blocked') {
      navigationBlocker.proceed()
      return
    }

    pendingAction?.()
  }

  useEffect(() => {
    setHasApprovedDefaultTemplate(false)
  }, [previewMode, selectedEmailTemplateKey])

  useEffect(() => {
    if (!canArchiveAfterNoPlace) {
      setArchiveAfterNoPlace(false)
    }
  }, [canArchiveAfterNoPlace])

  useEffect(() => {
    if (isDemoAccount && previewMode === 'email') {
      setPreviewMode('scored')
    }
  }, [isDemoAccount, previewMode])

  useEffect(() => {
    if (!canUseDevelopmentPdf && isPdfAttachmentApproved) {
      setIsPdfAttachmentApproved(false)
    }
  }, [canUseDevelopmentPdf, isPdfAttachmentApproved])

  useEffect(() => {
    if (restoredPrivateDraftExportLabelsRef.current) {
      setSelectedExportLabels(restoredPrivateDraftExportLabelsRef.current)
      restoredPrivateDraftExportLabelsRef.current = null
      return
    }

    const playerName = normalizePlayerName(formData.playerName)

    setSelectedExportLabels(
      getSavedEvaluationExportLabels({
        clubId: user?.clubId,
        playerName,
      }),
    )
  }, [formData.playerName, user?.clubId])

  const buildEvaluationPayload = useCallback((id = evaluationClientId) => {
    const assessmentSessionId = String(searchParams.get('sessionId') ?? '').trim()

    return createEvaluationPayload({
      assessmentSessionId,
      availableTeams,
      averageScore,
      comments,
      editingEvaluation,
      feedbackForm: selectedFeedbackForm,
      feedbackFormSnapshot,
      formData,
      formResponses,
      id,
      normalizedContactType,
      parentContacts,
      savedPlayers,
      scores,
      user,
    })
  }, [
    averageScore,
    availableTeams,
    comments,
    editingEvaluation,
    feedbackFormSnapshot,
    formData,
    formResponses,
    normalizedContactType,
    evaluationClientId,
    parentContacts,
    savedPlayers,
    scores,
    selectedFeedbackForm,
    searchParams,
    user,
  ])

  const clearAssessmentLinkState = () => {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('section')
    nextSearchParams.delete('sessionId')
    setSearchParams(nextSearchParams)
  }

  const resetDraftForNewContext = () => {
    persistedEvaluationForRetryRef.current = null
    evaluationContentRevisionRef.current += 1
    serverDraftRestoreCompleteKeyRef.current = ''
    serverDraftRestoreKeyRef.current = ''
    setIsLoadingDraft(false)
    privateDraftInfoRef.current = null
    setPrivateDraftInfo(null)
    setResponseValues(createEmptyResponseValues(dynamicFields))
    setIsPdfAttachmentApproved(false)
    setNextAssessmentReminderChoice('skip')
    setNextAssessmentReminderDate('')
    setIsFinalReviewOpen(false)
    clearDraftBaseline('idle')
  }

  const handleAssessmentPlayerSelect = (player) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('choosePlayer')
    nextSearchParams.set('player', player.playerName || '')
    nextSearchParams.set('team', player.team || user?.activeTeamName || '')
    nextSearchParams.set('section', EVALUATION_SECTIONS.includes(player.section) ? player.section : 'Squad')

    if (player.id) {
      nextSearchParams.set('playerId', player.id)
    } else {
      nextSearchParams.delete('playerId')
    }

    requestContextChange(() => {
      resetDraftForNewContext()
      navigate(`/assess-player/new?${nextSearchParams.toString()}`)
    })
  }

  const handleFieldChange = (event) => {
    const { name, value } = event.target
    setIsSaved(false)
    setActionErrorMessage('')

    if (name === 'session') {
      const nextSessionValue = normalizeSessionValue(value)

      if (nextSessionValue === normalizeSessionValue(formData.session)) {
        return
      }

      setFormData((current) => ({
        ...current,
        session: nextSessionValue,
      }))
      setLastUsedSession(nextSessionValue)
      evaluationContentRevisionRef.current += 1
      markDraftUnsaved()
      return
    }

    if (name === 'playerName' || name === 'team') {
      if (String(formData[name] ?? '') === value) {
        return
      }

      requestContextChange(() => {
        const { matchingParentContacts, nextFormData } = getMatchedPlayerFieldUpdate({
          fieldName: name,
          formData,
          normalizeParentContacts,
          normalizePlayerContactType,
          savedPlayers,
          value,
        })
        resetDraftForNewContext()
        setFormData(nextFormData)
        setSelectedParentContactIndexes(getSelectedContactIndexes(matchingParentContacts))
      })
      return
    }

    if (name === 'section') {
      if (String(formData.section ?? '') === value) {
        return
      }

      requestContextChange(() => {
        const currentPlayerName = normalizePlayerName(formData.playerName)
        const currentTeam = String(formData.team ?? '').trim()
        const matchingPlayer = savedPlayers.find(
          (player) =>
            normalizePlayerName(player.playerName) === currentPlayerName &&
            player.section === value &&
            (!currentTeam || player.team === currentTeam),
        )

        resetDraftForNewContext()

        if (matchingPlayer) {
          setFormData((current) => ({
            ...current,
            section: value,
          }))
        } else {
          setSelectedParentContactIndexes([0])
          setFormData((current) => ({
            ...current,
            section: value,
            playerName: '',
            parentName: '',
            parentEmail: '',
            parentContacts: [],
          }))
        }
      })
      return
    }

    if (String(formData[name] ?? '') === value) {
      return
    }

    setFormData((current) => ({
      ...current,
      [name]: value,
    }))
    evaluationContentRevisionRef.current += 1
    markDraftUnsaved()
  }

  const handleResponseChange = (fieldId, value) => {
    if (responseValues[fieldId] === value) {
      return
    }

    setIsSaved(false)
    setActionErrorMessage('')
    setResponseValues((current) => ({
      ...current,
      [fieldId]: value,
    }))
    evaluationContentRevisionRef.current += 1
    markDraftUnsaved()
  }

  const handleFeedbackFormChange = (nextFeedbackFormId) => {
    if (String(selectedFeedbackFormId) === String(nextFeedbackFormId)) {
      return
    }

    requestContextChange(() => {
      resetDraftForNewContext()
      setSelectedFeedbackFormId(String(nextFeedbackFormId ?? '').trim())
    })
  }

  const handleToggleParentContact = (index) => {
    if (useLinkedParentRecipients) {
      const linkId = displayedParentContacts[index]?.linkId

      if (!linkId) {
        const legacyIndex = displayedParentContacts[index]?.legacyIndex

        if (Number.isInteger(legacyIndex)) {
          setSelectedParentContactIndexes((current) =>
            getNextSelectedContactIndexes(current, legacyIndex),
          )
          markDraftUnsaved()
        }

        return
      }

      setSelectedDevelopmentParentLinkIds((current) =>
        current.includes(linkId)
          ? current.filter((item) => item !== linkId)
          : [...current, linkId],
      )
      markDraftUnsaved()
      return
    }

    setSelectedParentContactIndexes((current) => getNextSelectedContactIndexes(current, index))
    markDraftUnsaved()
  }

  const saveExportSelection = (labels) => {
    const playerName = normalizePlayerName(formData.playerName)

    setSelectedExportLabels(labels)
    markDraftUnsaved()
    saveEvaluationExportLabels({
      clubId: user?.clubId,
      playerName,
      labels,
    })
  }

  const handleToggleExportField = (label) => {
    saveExportSelection(getNextExportLabels({ label, responseItems, selectedExportLabels }))
  }

  const handleReorderExportField = (sourceLabel, targetLabel, currentResponseItems) => {
    saveExportSelection(
      reorderEvaluationExportLabels({
        sourceLabel,
        targetLabel,
        responseItems: currentResponseItems,
        selectedLabels: selectedExportLabels,
      }),
    )
  }

  const handleSetAllExportFields = () => {
    saveExportSelection(responseItems.map((item) => item.label))
  }

  const handleClearExportFields = () => {
    saveExportSelection([])
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!user?.clubId && !isPlatformOwner) {
      console.error('Development record submit failed: missing club ID for current user.')
      setActionErrorMessage('Your account is missing a club assignment.')
      return
    }

    if (!String(formData.team ?? '').trim()) {
      console.error('Development record submit failed: no team selected.')
      setActionErrorMessage('Select a team before submitting the development record.')
      return
    }

    if (!editingEvaluation && !hasFeedbackFormSelection) {
      setActionErrorMessage('Choose the default development form or a saved feedback form before submitting the development record.')
      return
    }

    if (previewMode === 'email' && selectedEmailTemplate?.isDefaultTemplate && !hasApprovedDefaultTemplate) {
      setIsDefaultTemplateConfirmOpen(true)
      return
    }

    if (previewMode === 'email') {
      if (!canUseParentEmail) {
        setActionErrorMessage(createUiFeatureUnavailableMessage(user, CAPABILITIES.parentEmails))
        return
      }

      if (selectedParentContacts.length === 0) {
        setActionErrorMessage(`Select at least one eligible ${contactNoun} before continuing.`)
        return
      }

      if (isPdfAttachmentApproved && !canUseDevelopmentPdf) {
        setActionErrorMessage(createUiFeatureUnavailableMessage(user, CAPABILITIES.pdfReports))
        return
      }

      if (
        emailSendMode === 'scheduled' &&
        (!scheduledEmailDateTime || Number.isNaN(new Date(scheduledEmailDateTime).getTime()))
      ) {
        setActionErrorMessage('Choose a valid scheduled send date and time.')
        return
      }
    }

    if (
      !isNoPlaceOfferedTemplate &&
      nextAssessmentReminderChoice === 'set' &&
      !nextAssessmentReminderDate
    ) {
      setActionErrorMessage('Choose a reminder date or select Skip reminder before continuing.')
      return
    }

    if (isNoPlaceOfferedTemplate) {
      setNextAssessmentReminderChoice('skip')
      setNextAssessmentReminderDate('')
    }

    setActionErrorMessage('')
    setIsFinalReviewOpen(true)
  }

  const executeDevelopmentSubmission = async () => {
    if (submissionPromiseRef.current) {
      return
    }

    submissionPromiseRef.current = true
    setIsSubmitting(true)
    setActionErrorMessage('')
    let completionOutcome = 'saved'
    let reminderCreated = false
    let reminderFailed = false

    try {
      const normalizedPlayerName = normalizePlayerName(formData.playerName)
      const priorPersistedEvaluation = persistedEvaluationForRetryRef.current
      const existingEvaluationId = String(
        editingEvaluation?.id || priorPersistedEvaluation?.evaluation?.id || '',
      ).trim()
      const evaluationPayloadId = existingEvaluationId || evaluationClientId
      const evaluation = buildEvaluationPayload(evaluationPayloadId)
      const evaluationFingerprint = createEvaluationPersistenceFingerprint(evaluation)
      const submissionOperationId = existingEvaluationId || evaluation.id
      const canReusePersistedEvaluation =
        Boolean(priorPersistedEvaluation?.evaluation?.id) &&
        priorPersistedEvaluation.contentRevision === evaluationContentRevisionRef.current &&
        (
          !priorPersistedEvaluation.fingerprint ||
          priorPersistedEvaluation.fingerprint === evaluationFingerprint
        )

      const isScheduledSend = previewMode === 'email' && emailSendMode === 'scheduled'
      const scheduledAt = isScheduledSend ? new Date(scheduledEmailDateTime).toISOString() : ''

      if (!existingEvaluationId && user?.clubId) {
        const allEvaluations = await getEvaluations({ user })
        const monthlyEvaluationCount = getCurrentMonthEvaluationCount(allEvaluations)

        if (!isWithinPlanLimit(user, 'monthlyEvaluations', monthlyEvaluationCount)) {
          throw new Error(createLimitUpgradeMessage(user, 'monthlyEvaluations', 'Monthly development records'))
        }
      }

      const savedEvaluation = canReusePersistedEvaluation
        ? priorPersistedEvaluation.evaluation
        : existingEvaluationId
          ? await updateEvaluation(existingEvaluationId, evaluation, user?.clubId)
          : await createEvaluation(evaluation)

      persistedEvaluationForRetryRef.current = {
        contentRevision: evaluationContentRevisionRef.current,
        evaluation: savedEvaluation,
        fingerprint: evaluationFingerprint,
      }

      let reportResult
      try {
        reportResult = await finalizeDevelopmentParentReport({
          clubId: user?.clubId,
          teamId: savedEvaluation?.teamId || evaluation.teamId || developmentRecipientTeamId,
          playerId: savedEvaluation?.playerId || evaluation.playerId || '',
          evaluationId: savedEvaluation?.id || editingEvaluation?.id || evaluation.id,
          selectedParentLinkIds: useLinkedParentRecipients
            ? selectedDevelopmentParentLinkIds
            : [],
          responses: selectedResponseItems,
          includeAttendance: includeAttendanceSummary,
          includeProgression: true,
        })
      } catch (reportError) {
        throw Object.assign(reportError, {
          code: 'DEVELOPMENT_PARENT_REPORT_FINALIZE_FAILED',
          savedEvaluation,
        })
      }
      let confirmationResult
      try {
        confirmationResult = await confirmDevelopmentSubmission({
          operationId: submissionOperationId,
          evaluationId: savedEvaluation?.id || submissionOperationId,
          clubId: user?.clubId,
          teamId: savedEvaluation?.teamId || evaluation.teamId || developmentRecipientTeamId,
          playerId: savedEvaluation?.playerId || evaluation.playerId || archiveCandidatePlayer?.id || '',
          outputContext: normalizedContactType === PLAYER_CONTACT_TYPES.parent
            ? DEVELOPMENT_PARENT_OUTPUT_CONTEXT
            : DEVELOPMENT_RECIPIENT_OUTPUT_CONTEXT,
          sendMode: previewMode === 'email'
            ? isScheduledSend ? 'scheduled' : 'now'
            : 'none',
          scheduledAt,
          attachPdf: previewMode === 'email' && isPdfAttachmentApproved,
          includeAttendance: previewMode === 'email' && includeAttendanceSummary,
          selectedParentLinkIds: previewMode === 'email' && useLinkedParentRecipients
            ? selectedDevelopmentParentLinkIds
            : [],
          selectedResponseCount: selectedResponseItems.length,
          reminderDate: nextAssessmentReminderChoice === 'set'
            ? nextAssessmentReminderDate
            : '',
        })
      } catch (confirmationError) {
        throw Object.assign(confirmationError, {
          savedEvaluation,
        })
      }

      if (String(confirmationResult.operationId ?? '') !== submissionOperationId) {
        throw Object.assign(
          new Error('The final Development submission confirmation could not be verified.'),
          {
            code: 'DEVELOPMENT_SUBMISSION_CONFIRMATION_FAILED',
            savedEvaluation,
          },
        )
      }

      clearViewCaches()

      if (editingEvaluation) {
        setEditingEvaluation(savedEvaluation)
      } else {
        setEvaluationClientId(createLocalId())
      }

      const recipientReviewRequired =
        previewMode === 'email' &&
        useLinkedParentRecipients &&
        reportResult?.recipientReviewRequired === true

      if (recipientReviewRequired) {
        await loadDevelopmentParentRecipients({
          preserveSelected: true,
        })
        completionOutcome = 'recipient_review'
      }

      if (previewMode === 'email' && !recipientReviewRequired) {
        try {
          if (!canUseParentEmail) {
            throw new Error(createUiFeatureUnavailableMessage(user, CAPABILITIES.parentEmails))
          }

          if (isPdfAttachmentApproved && !canUseDevelopmentPdf) {
            throw new Error(createUiFeatureUnavailableMessage(user, CAPABILITIES.pdfReports))
          }

          setIsSendingParentEmail(true)
          const progressionSourceEvaluations = [savedEvaluation, ...previousEvaluations]
            .filter(Boolean)
            .filter((item, index, items) => items.findIndex((candidate) => String(candidate.id ?? '') === String(item.id ?? '')) === index)
            .filter((item) => normalizePlayerName(item.playerName) === normalizedPlayerName)
            .filter((item) => !formData.team || item.team === formData.team)
          const progressionData = buildPlayerProgressionData({
            evaluations: progressionSourceEvaluations,
            staffNotes: [],
            fields: dynamicFields,
          })
          const assessmentEmailSections = buildProgressionEmailSections({
            progressionData,
            sections: {
              latestSessionNotes: false,
              attendanceSummary: includeAttendanceSummary,
              progressionChart: true,
              coachComments: false,
              matchNotes: false,
              nextFocusAreas: false,
            },
          })

          const emailJobs = buildParentEmailJobs({
            allowServerRecipientResolution: true,
            attachPdf: isPdfAttachmentApproved,
            contactAudiences,
            emailSections: assessmentEmailSections,
            emailTemplates,
            evaluation: {
              id: savedEvaluation?.id || editingEvaluation?.id || evaluation.id,
            },
            formData,
            inviteDate,
            normalizedPlayerName,
            playerContactTypes: PLAYER_CONTACT_TYPES,
            selectedEmailTemplateKey,
            selectedParentContacts,
            selectedResponseItems,
            submissionOperationId,
            includeAttendance: includeAttendanceSummary,
            user,
          })

          if (emailJobs.length === 0) {
            throw new Error(`Add a ${contactNoun} email before sending.`)
          }

          const emailResults = await Promise.all(emailJobs.map((emailJob) => sendParentEmail({
            ...emailJob.payload,
            teamId: savedEvaluation?.teamId || evaluation.teamId || developmentRecipientTeamId,
            playerId: savedEvaluation?.playerId || evaluation.playerId || '',
            scheduledAt,
            communicationLog: {
              clubId: user?.clubId || '',
              playerId: savedEvaluation?.playerId || evaluation.playerId || null,
              evaluationId: savedEvaluation?.id || editingEvaluation?.id || evaluation.id,
              userId: user?.id || '',
              userName: user?.displayName || user?.username || user?.name || user?.email || '',
              userEmail: user?.email || '',
              recipientEmail: emailJob.recipientEmail,
              metadata: {
                subject: emailJob.payload?.subject || '',
                body: emailJob.payload?.emailBody || '',
                templateName: emailJob.templateName || '',
                team: emailJob.payload?.team || '',
                club: emailJob.payload?.club || '',
                playerName: normalizedPlayerName,
                hasAttachment: emailJob.payload?.attachPdf === true,
                scheduledAt,
                assessmentFields: selectedResponseItems,
                submissionOperationId,
              },
            },
          })))
          const completedEmailJobs = emailJobs
            .map((emailJob, index) => ({
              emailJob,
              result: emailResults[index] || {},
            }))
            .filter(({ result }) => result.outcome !== 'no_recipient')
          const unavailableEmailJobs = emailJobs
            .map((emailJob, index) => ({
              emailJob,
              result: emailResults[index] || {},
            }))
            .filter(({ result }) => result.outcome === 'no_recipient')
          const clientLoggedEmailJobs = completedEmailJobs.filter(
            ({ result }) => !result.communicationLogId && result.duplicate !== true,
          )

          if (completedEmailJobs.length > 0) {
            let communicationLog = null

            if (clientLoggedEmailJobs.length > 0) {
              communicationLog = await createCommunicationLog({
                user,
                playerId: savedEvaluation?.playerId || evaluation.playerId,
                evaluationId: savedEvaluation?.id || editingEvaluation?.id || evaluation.id,
                channel: 'email',
                action: isScheduledSend ? 'parent_email_scheduled' : 'parent_email_sent',
                recipientEmail: clientLoggedEmailJobs
                  .map(({ emailJob, result }) => result.recipientEmail || emailJob.recipientEmail)
                  .filter(Boolean)
                  .join(','),
                metadata: {
                  subject: clientLoggedEmailJobs[0]?.emailJob?.payload?.subject || '',
                  body: clientLoggedEmailJobs[0]?.emailJob?.payload?.emailBody || '',
                  templateName: clientLoggedEmailJobs.map(({ emailJob }) => emailJob.templateName).join(', '),
                  team: clientLoggedEmailJobs[0]?.emailJob?.payload?.team || '',
                  club: clientLoggedEmailJobs[0]?.emailJob?.payload?.club || '',
                  playerName: normalizedPlayerName,
                  hasAttachment: clientLoggedEmailJobs.some(
                    ({ emailJob }) => emailJob.payload?.attachPdf === true,
                  ),
                  scheduledAt,
                  assessmentFields: selectedResponseItems,
                  submissionOperationId,
                },
              })
            }

            if (!isScheduledSend) {
              const communicationLogIds = [
                communicationLog?.id,
                ...completedEmailJobs
                  .filter(({ result }) => result.communicationLogDuplicate !== true)
                  .map(({ result }) => result.communicationLogId),
              ].filter(Boolean)

              await Promise.all(communicationLogIds.map((id) =>
                sendParentMobilePushNotification({
                  id,
                  type: 'parent_message',
                }),
              ))
            }

            completionOutcome = unavailableEmailJobs.length > 0
              ? isScheduledSend ? 'schedule_failed' : 'send_failed'
              : isScheduledSend ? 'scheduled' : 'sent'
          } else if (unavailableEmailJobs.length > 0) {
            const refreshedRecipients = await loadDevelopmentParentRecipients({
              preserveSelected: true,
            })
            completionOutcome = Array.isArray(refreshedRecipients) &&
              refreshedRecipients.some((recipient) => recipient.eligible)
              ? isScheduledSend ? 'schedule_failed' : 'send_failed'
              : 'no_recipient'
          }
        } catch (emailError) {
          console.error('Email failed', emailError)
          completionOutcome = emailSendMode === 'scheduled' ? 'schedule_failed' : 'send_failed'
        }
      }

      const savedPlayerId = savedEvaluation?.playerId || evaluation.playerId || archiveCandidatePlayer?.id || ''

      if (archiveAfterNoPlace && isNoPlaceOfferedTemplate && canDeletePlayer(user)) {
        if (!savedPlayerId) {
          showToast({
            title: 'Player not archived',
            message: 'The development record was saved, but no saved player record was found to archive.',
            tone: 'error',
          })
        } else {
          try {
            await archivePlayer({
              user,
              playerId: savedPlayerId,
              reason: 'No Place Offered assessment outcome',
            })
            showToast({
              title: 'Player archived',
              message: `${normalizedPlayerName} has been moved to the player archive.`,
            })
          } catch (archiveError) {
            console.error('No Place Offered archive failed', archiveError)
            showToast({
              title: 'Player not archived',
              message: archiveError.message || 'The development record was saved, but the player could not be archived.',
              tone: 'error',
            })
          }
        }
      }

      if (
        !isNoPlaceOfferedTemplate &&
        nextAssessmentReminderChoice === 'set' &&
        nextAssessmentReminderDate
      ) {
        try {
          await createAssessmentReminderOnce({
            user,
            playerId: savedEvaluation?.playerId || evaluation.playerId,
            evaluationId: savedEvaluation?.id || editingEvaluation?.id || evaluation.id,
            dueDate: nextAssessmentReminderDate,
            metadata: {
              playerName: normalizedPlayerName,
              team: formData.team,
              section: formData.section,
              submissionOperationId,
            },
          })
          reminderCreated = true
        } catch (reminderError) {
          reminderFailed = true
          console.error('Next Development reminder failed', reminderError)
        }
      }

      const assessmentSessionId = String(searchParams.get('sessionId') ?? '').trim()

      writeSessionAssessmentProgress({
        assessmentSessionId,
        playerName: normalizedPlayerName,
        user,
      })

      await closeActivePrivateDraftAfterSubmit()

      const postAssessmentNavigation = getPostAssessmentNavigation({
        assessmentSessionId,
        availableTeams,
        editingEvaluation,
        formData,
        lastUsedSession,
        normalizedPlayerName,
        searchParams,
      })

      setCompletionNavigationUrl(postAssessmentNavigation.url || '')

      setLastSavedPlayerName(normalizedPlayerName)
      const shouldPreserveSavedRecordForRetry = [
        'no_recipient',
        'recipient_review',
        'schedule_failed',
        'send_failed',
      ].includes(completionOutcome)

      if (!shouldPreserveSavedRecordForRetry && !editingEvaluation && !postAssessmentNavigation.url) {
        setFormData(
          createPostAssessmentFormData({
            currentSection: formData.section,
            evaluationSections: EVALUATION_SECTIONS,
            postAssessmentNavigation,
            user,
          }),
        )
        setResponseValues(createEmptyResponseValues(dynamicFields))
      }
      setLastUsedSession(postAssessmentNavigation.nextSessionValue)
      setIsSaved(true)
      setCompletionModal(getCompletionModalForOutcome({
        outcome: completionOutcome,
        playerName: normalizedPlayerName,
        reminderCreated,
        reminderDate: nextAssessmentReminderDate,
        reminderFailed,
        requestedPdf: isPdfAttachmentApproved,
      }))
      if (!shouldPreserveSavedRecordForRetry) {
        persistedEvaluationForRetryRef.current = null
        setIsPdfAttachmentApproved(false)
      }
      setArchiveAfterNoPlace(false)
      if (!shouldPreserveSavedRecordForRetry) {
        setNextAssessmentReminderChoice('skip')
        setNextAssessmentReminderDate('')
      }
    } catch (error) {
      console.error('Development record submit failed', error)
      const reportFinalizeFailed = error?.code === 'DEVELOPMENT_PARENT_REPORT_FINALIZE_FAILED'
      const recordAlreadySaved = reportFinalizeFailed || Boolean(error?.savedEvaluation?.id)
      setIsSaved(recordAlreadySaved)
      setActionErrorMessage(
        reportFinalizeFailed
          ? 'The Development record was saved, but its parent report could not be finalized. Submit again to retry without creating a duplicate record.'
          : recordAlreadySaved
            ? 'The Development record and parent report were saved, but optional output could not be completed. Retry without creating a duplicate record.'
            : getDevelopmentRecordSaveFailureMessage(error),
      )
    } finally {
      setIsSendingParentEmail(false)
      setIsSubmitting(false)
      submissionPromiseRef.current = null
    }
  }

  const handleContinueWithDefaultTemplate = () => {
    setHasApprovedDefaultTemplate(true)
    setIsDefaultTemplateConfirmOpen(false)
    window.setTimeout(() => formRef.current?.requestSubmit(), 0)
  }

  const handleEmailAfterSaveChange = (shouldEmail) => {
    setPreviewMode(shouldEmail ? 'email' : 'scored')
    setHasApprovedDefaultTemplate(false)
    markDraftUnsaved()

    if (!shouldEmail) {
      setIsPdfAttachmentApproved(false)
      setEmailSendMode('now')
      setScheduledEmailDateTime('')
    }
  }

  const handleShowPreviousScores = () => {
    promptedPreviousScoresKeyRef.current = previousScoresPromptKey
    setShowPreviousAssessments(true)
    setIsPreviousScoresConfirmOpen(false)
  }

  const handleHidePreviousScores = () => {
    promptedPreviousScoresKeyRef.current = previousScoresPromptKey
    setShowPreviousAssessments(false)
    setIsPreviousScoresConfirmOpen(false)
  }

  const privateDraftBanner = getPrivateDraftBannerCopy(privateDraftStatus, privateDraftInfo)

  return (
    <div className="space-y-5 sm:space-y-6">
      {shouldChooseAssessmentPlayer ? (
        <>
          <PageHeader
            eyebrow="Development record"
            title="Select a player to assess."
            description="Choose the player first so the development record is saved against the right person."
          />

          <AssessmentPlayerPicker
            activeTeamName={user?.activeTeamName}
            isLoading={isLoadingPlayers}
            onSearchChange={setAssessmentPlayerSearch}
            onSelectPlayer={handleAssessmentPlayerSelect}
            players={assessmentPlayerOptions}
            searchValue={assessmentPlayerSearch}
          />
        </>
      ) : (
        <>
      <BlankPrintForm
        clubName={user?.clubName || 'Club Form'}
        logoUrl={user?.clubLogoUrl || fallbackLogo}
        fields={enabledFields}
      />

      <ConfirmModal
        isOpen={isContextChangePending || navigationBlocker.state === 'blocked'}
        title="Unsaved changes"
        message="You have unsaved changes. Leave without saving?"
        cancelLabel="Stay and continue editing"
        confirmLabel="Leave without saving"
        onCancel={handleStayAndContinueEditing}
        onClose={handleStayAndContinueEditing}
        onConfirm={handleLeaveWithoutSaving}
      />

      <ConfirmModal
        isOpen={isDefaultTemplateConfirmOpen}
        title="Default template"
        message={canConfigureEmailTemplates ? 'Review this default message or open Templates to customise it. Choosing the template proceeds to final submission review and does not send anything yet.' : 'Review this default message. Choosing the template proceeds to final submission review and does not send anything yet.'}
        itemsTitle="Email choices"
        items={[
          `Template: ${selectedEmailTemplate?.label || 'Default template'}`,
          `Recipients: ${selectedParentContacts.map((contact) => contact.name || contact.email).filter(Boolean).join(', ') || contactNounPlural}`,
          `PDF: ${isPdfAttachmentApproved ? 'Attach' : 'Not attached'}`,
        ]}
        confirmLabel="Use template and review submission"
        cancelLabel={canConfigureEmailTemplates ? 'Configure Email Templates' : 'Cancel'}
        onCancel={() => {
          if (canConfigureEmailTemplates) {
            navigate('/parent-email-templates')
            return
          }

          setIsDefaultTemplateConfirmOpen(false)
        }}
        onClose={() => setIsDefaultTemplateConfirmOpen(false)}
        onConfirm={handleContinueWithDefaultTemplate}
      />

      <ConfirmModal
        isOpen={isPreviousScoresConfirmOpen}
        title="Previous development record found"
        message="This player already has development history. Do you want to open the previous scores while completing this record?"
        cancelLabel="Keep Closed"
        confirmLabel="Show Previous Scores"
        onCancel={handleHidePreviousScores}
        onClose={handleHidePreviousScores}
        onConfirm={handleShowPreviousScores}
      />

      <ConfirmModal
        isOpen={isFinalReviewOpen}
        isBusy={isSubmitting}
        title="Final Development submission review"
        message="Nothing has been saved, queued, generated, or sent yet. Check every choice, then use the final action below."
        itemsTitle="Final choices"
        items={finalSubmissionReviewItems}
        cancelLabel="Back to editing"
        confirmLabel={finalSubmissionActionLabel}
        confirmDisabled={
          nextAssessmentReminderChoice === 'set' &&
          !nextAssessmentReminderDate
        }
        onCancel={() => setIsFinalReviewOpen(false)}
        onClose={() => setIsFinalReviewOpen(false)}
        onConfirm={async () => {
          setIsFinalReviewOpen(false)
          await executeDevelopmentSubmission()
        }}
      >
        {!isNoPlaceOfferedTemplate ? (
          <fieldset>
            <legend className="mb-2 block text-sm font-black text-[#101828]">
              Next review reminder
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-sm font-black text-[#101828]">
                <input
                  type="radio"
                  name="next-development-reminder-choice"
                  checked={nextAssessmentReminderChoice === 'skip'}
                  onChange={() => {
                    setNextAssessmentReminderChoice('skip')
                    setNextAssessmentReminderDate('')
                    markDraftUnsaved()
                  }}
                  className="h-4 w-4 accent-[#047857]"
                />
                Skip reminder
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-sm font-black text-[#101828]">
                <input
                  type="radio"
                  name="next-development-reminder-choice"
                  checked={nextAssessmentReminderChoice === 'set'}
                  onChange={() => {
                    setNextAssessmentReminderChoice('set')
                    markDraftUnsaved()
                  }}
                  className="h-4 w-4 accent-[#047857]"
                />
                Set reminder
              </label>
            </div>
            {nextAssessmentReminderChoice === 'set' ? (
              <label className="mt-3 block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Reminder date</span>
                <input
                  type="date"
                  value={nextAssessmentReminderDate}
                  onChange={(event) => {
                    setNextAssessmentReminderDate(event.target.value)
                    markDraftUnsaved()
                  }}
                  className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]"
                />
              </label>
            ) : null}
          </fieldset>
        ) : (
          <p className="text-sm font-semibold leading-6 text-[#4b5f55]">
            No next review reminder will be created for this outcome.
          </p>
        )}
      </ConfirmModal>

      <ConfirmModal
        isOpen={Boolean(completionModal)}
        title={completionModal?.title || 'Development Record saved'}
        message={completionModal?.message || ''}
        itemsTitle="Completion status"
        items={completionModal?.items || []}
        confirmLabel="Continue"
        hideCancel
        onCancel={handleCompletionContinue}
        onClose={handleCompletionContinue}
        onConfirm={handleCompletionContinue}
      />

      <div className={isPrintingBlankView ? 'no-print' : ''}>
        <PageHeader
          eyebrow="Development record"
          title="Record the development detail while it is still fresh."
          description="Select the player, score only the useful fields, and decide whether this stays internal or goes to parents after saving."
        />

        {isSaved ? (
          <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#047857] shadow-sm shadow-[#047857]/10">
            Development Record saved
          </div>
        ) : null}

        {actionErrorMessage ? (
          <NoticeBanner
            title="Action not completed"
            message={actionErrorMessage}
          />
        ) : null}

        {privateDraftStatus !== 'idle' && privateDraftStatus !== 'discarded' ? (
          <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-bold text-[#065f46] shadow-sm shadow-[#047857]/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-black">
                  {privateDraftBanner.title}
                </p>
                <p className="mt-1 leading-6">
                  {privateDraftBanner.message}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {privateDraftInfo?.id ? (
                  <button
                    type="button"
                    onClick={() => void handleDiscardPrivateDraft()}
                    disabled={isSavingDraft}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#86efac] bg-white px-4 py-3 text-sm font-black text-[#065f46] transition hover:border-[#047857] hover:bg-[#f7faf8] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Discard Draft
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {dataRefreshNotice ? <NoticeBanner title="Using available club data" message={dataRefreshNotice} tone="info" /> : null}
        {hasInvalidAssessmentSection || hasIncompleteSessionAssessmentLink ? (
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 text-sm text-[#101828] shadow-sm shadow-[#047857]/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-black">Development link was adjusted</p>
                <p className="mt-1 font-semibold leading-6 text-[#4b5f55]">
                  The link had missing or unknown development details, so the form is using the nearest valid options.
                </p>
              </div>
              <button
                type="button"
                onClick={clearAssessmentLinkState}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5]"
              >
                Clear link details
              </button>
            </div>
          </div>
        ) : null}

        <DevelopmentRecordCommandPanel
          contactNounPlural={contactNounPlural}
          enabledFieldCount={enabledFields.length}
          formData={formData}
          isEmailEnabled={previewMode === 'email'}
          isPdfAttachmentApproved={isPdfAttachmentApproved}
          previousEvaluationCount={previousEvaluations.length}
          selectedContactCount={selectedParentContacts.length}
          selectedResponseCount={selectedResponseItems.length}
        />

        <EvaluationAvailabilityState
          availableTeams={availableTeams}
          isLoadingFields={isLoadingFields}
          isLoadingTeams={isLoadingTeams}
          noTeamsMessage={noTeamsMessage}
          teamsLoadErrorMessage={teamsLoadErrorMessage}
          user={user}
        >
            <form ref={formRef} className="space-y-5 sm:space-y-6 no-print" onSubmit={handleSubmit}>
              <EvaluationPlayerDetailsSection
                availableTeams={availableTeams}
                contactLabel={contactLabel}
                contactNoun={contactNoun}
                contactNounPlural={contactNounPlural}
                evaluationSections={EVALUATION_SECTIONS}
                formData={formData}
                onFieldChange={handleFieldChange}
                onToggleParentContact={handleToggleParentContact}
                parentContacts={displayedParentContacts}
                parentRecipientLoadError={developmentParentRecipientLoadError}
                parentRecipientsLoading={isLoadingDevelopmentParentRecipients}
                readableSession={readableSession}
                savedPlayers={savedPlayers}
                selectedParentLinkIds={selectedDevelopmentParentLinkIds}
                selectedParentContactIndexes={selectedParentContactIndexes}
                useLinkedParentRecipients={useLinkedParentRecipients}
                user={user}
              />

              <PreviousAssessmentsSection
                isOpen={showPreviousAssessments}
                onToggle={() => setShowPreviousAssessments((current) => !current)}
                previousEvaluations={previousEvaluations}
              />

              <FeedbackFormSelectionSection
                feedbackForms={feedbackForms}
                hasUnavailableSelectedForm={hasUnavailableSelectedForm}
                isEditingHistoricalForm={hasHistoricalFeedbackFormSnapshot}
                isDefaultFeedbackFormSelected={isDefaultFeedbackFormSelected}
                isLoadingFeedbackForms={isLoadingFeedbackForms}
                onSelectFeedbackForm={handleFeedbackFormChange}
                selectedFeedbackForm={selectedFeedbackForm || {
                  name: editingEvaluation?.feedbackFormName,
                }}
                selectedFeedbackFormId={selectedFeedbackFormId}
              />

              <ConfiguredFieldsSection
                enabledFields={enabledFields}
                emptyMessage={!hasFeedbackFormSelection && !hasHistoricalFeedbackFormSnapshot
                  ? 'Choose the default development form or a saved feedback form before completing the development fields.'
                  : hasUnavailableSelectedForm
                    ? 'The selected saved form is not available. Choose another form before completing the development fields.'
                    : 'No development fields are enabled for this club. Enable fields in Development Form first.'}
                isFallbackFields={isFallbackFields && isDefaultFeedbackFormSelected}
                onResponseChange={handleResponseChange}
                previousFieldValues={previousFieldValues}
                responseValues={responseValues}
              />

              <SubmitExportSection
                availableEmailTemplates={availableEmailTemplates}
                archiveAfterNoPlace={archiveAfterNoPlace}
                averageScore={averageScore}
                canArchiveAfterNoPlace={canArchiveAfterNoPlace}
                canSaveDraft={!editingEvaluation}
                canSubmitEvaluation={canSubmitEvaluation}
                canUseDevelopmentPdf={canUseDevelopmentPdf}
                contactNoun={contactNoun}
                developmentPdfUnavailableReason={developmentPdfUnavailableReason}
                hasSavedExportSelection={hasSavedExportSelection}
                includeAttendanceSummary={includeAttendanceSummary}
                inviteDate={inviteDate}
                isDemoAccount={isDemoAccount}
                isLoadingEmailTemplates={isLoadingEmailTemplates}
                isLoadingDraft={isLoadingDraft}
                isNoPlaceOfferedTemplate={isNoPlaceOfferedTemplate}
                isPdfAttachmentApproved={isPdfAttachmentApproved}
                isSaved={isSaved}
                isSendingParentEmail={isSendingParentEmail}
                isSavingDraft={isSavingDraft}
                isSubmitting={isSubmitting}
                lastSavedPlayerName={lastSavedPlayerName}
                onArchiveAfterNoPlaceChange={(value) => {
                  setArchiveAfterNoPlace(value)
                  markDraftUnsaved()
                }}
                onClearExportFields={handleClearExportFields}
                emailSendMode={emailSendMode}
                onEmailTemplateChange={(value) => {
                  setEmailTemplateKey(value)
                  markDraftUnsaved()
                }}
                onIncludeAttendanceSummaryChange={(value) => {
                  setIncludeAttendanceSummary(value)
                  markDraftUnsaved()
                }}
                onPdfAttachmentApprovedChange={(value) => {
                  setIsPdfAttachmentApproved(Boolean(value) && canUseDevelopmentPdf)
                  markDraftUnsaved()
                }}
                onEmailSendModeChange={(value) => {
                  setEmailSendMode(value)
                  markDraftUnsaved()
                }}
                onGoToPlayer={() => navigate(`/player/${encodeURIComponent(lastSavedPlayerName)}`)}
                onInviteDateChange={(value) => {
                  setInviteDate(value)
                  markDraftUnsaved()
                }}
                onSaveDraft={() => void handleSaveDraft()}
                onScheduledEmailDateTimeChange={(value) => {
                  setScheduledEmailDateTime(value)
                  markDraftUnsaved()
                }}
                onEmailAfterSaveChange={handleEmailAfterSaveChange}
                onPrintBlankForm={() => setIsPrintingBlankView(true)}
                onReorderExportField={handleReorderExportField}
                onSelectAllExportFields={handleSetAllExportFields}
                onToggleExportField={handleToggleExportField}
                previewMode={previewMode}
                responseItems={responseItems}
                selectedEmailTemplateKey={selectedEmailTemplateKey}
                selectedExportLabels={selectedExportLabels}
                selectedResponseItems={selectedResponseItems}
                scheduledEmailDateTime={scheduledEmailDateTime}
                showDevelopmentPdfOption={showDevelopmentPdfOption}
                shouldShowInviteDate={shouldShowInviteDate}
              />
            </form>
        </EvaluationAvailabilityState>
      </div>
        </>
      )}
    </div>
  )
}
