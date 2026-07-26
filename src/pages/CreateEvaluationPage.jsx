import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { sendParentEmail } from '../lib/email-builder.js'
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
import { removeDraft, saveDraft } from '../lib/offline-drafts.js'
import {
  buildPrivateEvaluationDraftContext,
  canRecoverPrivateEvaluationDraft,
  canAutosavePrivateEvaluationDraft,
  choosePrivateEvaluationDraftServerAcknowledgement,
  chooseLatestPrivateEvaluationDraft,
  clearPrivateEvaluationDraft,
  closeServerEvaluationDraft,
  createPrivateEvaluationDraftRequestCoordinator,
  createPrivateEvaluationDraftSingleFlight,
  createPrivateEvaluationDraftPayload,
  findPrivateEvaluationDraft,
  findServerEvaluationDraft,
  getPrivateEvaluationDraftPayloadFingerprint,
  getPrivateEvaluationDraftRecoveryDelay,
  getPrivateEvaluationDraftRequestIdentity,
  getPrivateEvaluationDraftSaveResponseDisposition,
  getPrivateEvaluationDraftSaveVersion,
  hasPrivateEvaluationDraftContent,
  isPrivateEvaluationDraftOffline,
  isSamePrivateEvaluationDraftSave,
  PRIVATE_EVALUATION_DRAFT_LIFECYCLE,
  PRIVATE_EVALUATION_DRAFT_STATUSES,
  savePrivateEvaluationDraft,
  saveServerEvaluationDraft,
} from '../lib/evaluation-drafts.js'
import {
  buildComments,
  buildFormResponses,
  buildParentEmailJobs,
  buildPreviousFieldValueMap,
  buildScores,
  createEvaluationPayload,
  createOfflineEvaluationDraft,
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
  getDevelopmentRecordCompletionCopy,
  getDevelopmentRecordSaveFailureMessage,
  getMatchedPlayerFieldUpdate,
  getNextExportLabels,
  getNextSelectedContactIndexes,
  getPostAssessmentNavigation,
  getSelectedContactIndexes,
  getDraftStorageKey,
  isNetworkError,
  mapEvaluationResponsesToFieldValues,
  normalizePlayerName,
  normalizeSessionValue,
  parseStoredDraft,
  writeSessionAssessmentProgress,
} from '../hooks/evaluations/evaluationFormUtils.js'
import {
  EVALUATION_SECTIONS,
  PLAYER_CONTACT_TYPES,
  archivePlayer,
  buildFeedbackFormSnapshot,
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
  formatParentContactEmails,
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
  const source = draftInfo?.source === 'server' ? 'database' : 'browser'
  const savedAt = formatPrivateDraftSavedAt(draftInfo?.lastSavedAt || draftInfo?.restoredAt)
  const lastSavedMessage = savedAt ? ` Last saved: ${savedAt}.` : ''

  if (
    status === PRIVATE_EVALUATION_DRAFT_LIFECYCLE.initialising ||
    status === PRIVATE_EVALUATION_DRAFT_LIFECYCLE.loadingExistingDraft
  ) {
    return {
      title: 'Loading draft...',
      message: 'Saved Development values are being loaded before draft saving is enabled.',
    }
  }

  if (status === PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated) {
    return {
      title: draftInfo?.id ? `Private ${source} draft loaded` : 'Draft ready',
      message: draftInfo?.id
        ? `Continue editing this unfinished Development Record, or discard it.${lastSavedMessage}`
        : 'Draft saving will start after you make a change.',
    }
  }

  if (status === PRIVATE_EVALUATION_DRAFT_LIFECYCLE.dirty) {
    return {
      title: 'Unsaved changes',
      message: 'The newest Development changes are waiting to be saved.',
    }
  }

  if (status === PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saving) {
    return {
      title: 'Saving draft...',
      message: 'This unfinished Development Record is being saved privately.',
    }
  }

  if (status === PRIVATE_EVALUATION_DRAFT_LIFECYCLE.retrying) {
    return {
      title: 'Retrying...',
      message: 'The newest private draft revision is being retried safely.',
    }
  }

  if (status === PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline) {
    return {
      title: 'Working offline',
      message: `The newest draft is held in this browser and will retry when the connection returns.${lastSavedMessage}`,
    }
  }

  if (status === PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed) {
    return {
      title: 'Draft could not be saved',
      message: 'The server did not confirm the latest draft revision. Your entered values remain on this page and a browser copy is kept where possible.',
    }
  }

  if (status === PRIVATE_EVALUATION_DRAFT_LIFECYCLE.submitting) {
    return {
      title: 'Saving Development Record...',
      message: 'Draft autosave is paused while the final Development Record is saved.',
    }
  }

  return {
    title: 'Draft saved',
    message: `This unfinished record is available only to this signed-in staff profile.${lastSavedMessage}`,
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
  const hasShareChoice = isEmailEnabled || isPdfAttachmentApproved
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
          Output: <span className="font-black text-[#101828]">{hasShareChoice ? `${isEmailEnabled ? 'Email' : ''}${isEmailEnabled && isPdfAttachmentApproved ? ' and ' : ''}${isPdfAttachmentApproved ? 'PDF' : ''}` : 'Internal only'}</span>
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
  const submitLockRef = useRef(false)
  const hasInitializedRef = useRef(false)
  const privateDraftHydrationReadyRef = useRef(false)
  const privateDraftHasGenuineEditRef = useRef(false)
  const privateDraftHydrationCycleRef = useRef(0)
  const privateDraftHydrationExpectedFingerprintRef = useRef(null)
  const privateDraftHydrationBaselineFingerprintRef = useRef('')
  const privateDraftActiveFingerprintRef = useRef('')
  const privateDraftHydrationFinalStatusRef = useRef(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated)
  const privateDraftHydrationNeedsServerSyncRef = useRef(false)
  const privateDraftLifecycleRef = useRef(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.initialising)
  const privateDraftRequestCoordinatorRef = useRef(createPrivateEvaluationDraftRequestCoordinator())
  const privateDraftRecoveryInFlightRef = useRef(false)
  const privateDraftRetryAttemptRef = useRef(0)
  const privateDraftRetryTimerRef = useRef(null)
  const privateDraftSaveTimerRef = useRef(null)
  const privateDraftInfoRef = useRef(null)
  const privateDraftSingleFlightRef = useRef(createPrivateEvaluationDraftSingleFlight())
  const privateDraftSaveVersionRef = useRef(0)
  const privateDraftServerConfirmationRef = useRef(null)
  const latestPrivateDraftSaveRef = useRef(null)
  const isPrivateDraftClosingRef = useRef(false)
  const shouldWarnPrivateDraftRef = useRef(false)
  const restoredPrivateDraftExportLabelsRef = useRef(null)
  const serverDraftRestoreKeyRef = useRef('')
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const userScopeKey = user ? `${user.id}:${user.clubId || 'platform'}:${user.role}:${user.roleRank}` : ''
  const canUseParentEmail = canUseUiFeature(user, CAPABILITIES.parentEmails)
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
  const [isLoadingFeedbackForms, setIsLoadingFeedbackForms] = useState(() => !isPlatformOwner)
  const [availableTeams, setAvailableTeams] = useState(() => (Array.isArray(cachedTeams) ? cachedTeams : []))
  const [savedPlayers, setSavedPlayers] = useState([])
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(() => !isPlatformOwner)
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
  const [inviteDate, setInviteDate] = useState('')
  const [selectedExportLabels, setSelectedExportLabels] = useState(null)
  const [actionErrorMessage, setActionErrorMessage] = useState('')
  const [dataRefreshNotice, setDataRefreshNotice] = useState('')
  const [teamsLoadErrorMessage, setTeamsLoadErrorMessage] = useState('')
  const [offlineDraftId, setOfflineDraftId] = useState(createLocalId)
  const [offlineStatusMessage, setOfflineStatusMessage] = useState('')
  const [nextAssessmentReminderTarget, setNextAssessmentReminderTarget] = useState(null)
  const [nextAssessmentReminderDate, setNextAssessmentReminderDate] = useState('')
  const [isSavingNextAssessmentReminder, setIsSavingNextAssessmentReminder] = useState(false)
  const [completionModal, setCompletionModal] = useState(null)
  const [completionNavigationUrl, setCompletionNavigationUrl] = useState('')
  const [archiveAfterNoPlace, setArchiveAfterNoPlace] = useState(false)
  const [privateDraftInfo, setPrivateDraftInfo] = useState(null)
  const [privateDraftStatus, setPrivateDraftStatus] = useState(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.initialising)
  const [privateDraftHydrationCommit, setPrivateDraftHydrationCommit] = useState(0)

  const draftStorageKey = getDraftStorageKey(user)
  const setPrivateDraftLifecycle = useCallback((nextStatus) => {
    privateDraftLifecycleRef.current = nextStatus
    setPrivateDraftStatus(nextStatus)
  }, [])
  const clearPrivateDraftRetryTimer = useCallback(() => {
    if (privateDraftRetryTimerRef.current) {
      window.clearTimeout(privateDraftRetryTimerRef.current)
      privateDraftRetryTimerRef.current = null
    }
  }, [])
  const buildCurrentPrivateDraftContext = useCallback((currentFormData = formData) => {
    const playerName = normalizePlayerName(currentFormData.playerName)
    const matchingPlayer = findSavedPlayerForEvaluation(
      savedPlayers,
      playerName,
      currentFormData.team,
      user?.activeTeamId,
    )

    const selectedDraftForm = feedbackForms.find(
      (form) => String(form.selectionId || form.id) === String(selectedFeedbackFormId),
    )

    return buildPrivateEvaluationDraftContext({
      editingEvaluationId,
      formId: selectedFeedbackFormId,
      formVersion: selectedDraftForm?.version,
      formData: {
        ...currentFormData,
        playerId: matchingPlayer?.id || currentFormData.playerId || '',
      },
      user,
    })
  }, [editingEvaluationId, feedbackForms, formData, savedPlayers, selectedFeedbackFormId, user])

  useEffect(() => {
    privateDraftInfoRef.current = privateDraftInfo
  }, [privateDraftInfo])

  useEffect(() => {
    shouldWarnPrivateDraftRef.current = [
      PRIVATE_EVALUATION_DRAFT_LIFECYCLE.dirty,
      PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saving,
      PRIVATE_EVALUATION_DRAFT_LIFECYCLE.retrying,
      PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed,
      PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline,
    ].includes(privateDraftStatus) &&
      Boolean(latestPrivateDraftSaveRef.current?.payload && hasPrivateEvaluationDraftContent(latestPrivateDraftSaveRef.current.payload))
  }, [privateDraftStatus])

  const buildCurrentPrivateDraftPayload = useCallback((saveVersion = privateDraftSaveVersionRef.current) => (
    createPrivateEvaluationDraftPayload({
      archiveAfterNoPlace,
      emailSendMode,
      emailTemplateKey,
      formData,
      includeAttendanceSummary,
      inviteDate,
      isPdfAttachmentApproved,
      lastUsedSession,
      offlineDraftId,
      previewMode,
      responseValues,
      saveVersion,
      scheduledEmailDateTime,
      selectedFeedbackFormId,
      selectedExportLabels,
      selectedParentContactIndexes,
    })
  ), [
    archiveAfterNoPlace,
    emailSendMode,
    emailTemplateKey,
    formData,
    includeAttendanceSummary,
    inviteDate,
    isPdfAttachmentApproved,
    lastUsedSession,
    offlineDraftId,
    previewMode,
    responseValues,
    scheduledEmailDateTime,
    selectedFeedbackFormId,
    selectedExportLabels,
    selectedParentContactIndexes,
  ])
  privateDraftActiveFingerprintRef.current = getPrivateEvaluationDraftPayloadFingerprint(
    buildCurrentPrivateDraftPayload(privateDraftSaveVersionRef.current),
  )

  const restorePrivateDraftPayload = useCallback((draft, source = 'local') => {
    const payload = draft?.payload || draft

    if (!payload || !hasPrivateEvaluationDraftContent(payload)) {
      return false
    }

    const restoredFormData =
      payload.formData && typeof payload.formData === 'object'
        ? payload.formData
        : {}
    const restoredOfflineDraftId = String(payload.offlineDraftId ?? '').trim()
    const restoredSession = normalizeSessionValue(restoredFormData.session)
    const rememberedSession = normalizeSessionValue(payload.lastUsedSession)
    const nextSessionValue = restoredSession || rememberedSession || formData.session
    const restoredContext = buildPrivateEvaluationDraftContext({
      editingEvaluationId,
      formData: restoredFormData,
      formId: payload.selectedFeedbackFormId,
      user,
    })
    const requestIdentity = getPrivateEvaluationDraftRequestIdentity({
      context: restoredContext,
      payload,
    })
    const coordinatorState = privateDraftRequestCoordinatorRef.current.beginContext(
      requestIdentity,
      getPrivateEvaluationDraftSaveVersion(draft),
    )
    privateDraftSaveVersionRef.current = coordinatorState.revision

    setFormData(createInitialFormData(user, {
      ...restoredFormData,
      coachName: user.name || '',
      session: nextSessionValue,
    }))
    setPreviewMode(['scored', 'email'].includes(String(payload.previewMode))
      ? String(payload.previewMode)
      : 'scored')
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
    setOfflineDraftId(restoredOfflineDraftId || createLocalId())
    setIsPdfAttachmentApproved(Boolean(payload.isPdfAttachmentApproved))
    setIncludeAttendanceSummary(payload.includeAttendanceSummary !== false)
    setEmailSendMode(payload.emailSendMode === 'scheduled' ? 'scheduled' : 'now')
    setScheduledEmailDateTime(String(payload.scheduledEmailDateTime ?? ''))
    restoredPrivateDraftExportLabelsRef.current = Array.isArray(payload.selectedExportLabels)
      ? payload.selectedExportLabels
      : null
    setSelectedExportLabels(restoredPrivateDraftExportLabelsRef.current)
    setArchiveAfterNoPlace(Boolean(payload.archiveAfterNoPlace))

    if (draft?.id) {
      const nextInfo = {
        id: draft.id,
        contextKey: draft.contextKey || '',
        lastSavedAt: draft.lastSavedAt || draft.updatedAt || '',
        localDraftId: source === 'server' ? privateDraftInfoRef.current?.localDraftId || '' : draft.id,
        requestIdentity,
        restoredAt: draft.lastSavedAt || draft.updatedAt || '',
        source,
      }

      privateDraftInfoRef.current = nextInfo
      setPrivateDraftInfo(nextInfo)
    }

    privateDraftHasGenuineEditRef.current = false
    privateDraftHydrationExpectedFingerprintRef.current = getPrivateEvaluationDraftPayloadFingerprint(payload)
    return true
  }, [editingEvaluationId, formData.session, user])

  const savePrivateDraftLocalCopy = useCallback(({ context, payload, request }) => {
    if (!payload || !hasPrivateEvaluationDraftContent(payload)) {
      return null
    }

    try {
      if (draftStorageKey) {
        sessionStorage.setItem(draftStorageKey, JSON.stringify(payload))
      }
    } catch (error) {
      console.error(error)
    }

    const currentInfo = privateDraftInfoRef.current
    const savedDraft = savePrivateEvaluationDraft({
      context,
      existingDraftId: currentInfo?.requestIdentity === request.contextIdentity && currentInfo?.source === 'local'
        ? currentInfo.id
        : currentInfo?.requestIdentity === request.contextIdentity
          ? currentInfo?.localDraftId || ''
          : '',
      payload,
      user,
    })

    if (savedDraft?.id) {
      const nextInfo = currentInfo?.source === 'server' && currentInfo?.requestIdentity === request.contextIdentity
        ? {
            ...currentInfo,
            lastSavedAt: currentInfo.lastSavedAt || savedDraft.updatedAt,
            localDraftId: savedDraft.id,
            requestIdentity: request.contextIdentity,
          }
        : {
            id: savedDraft.id,
            lastSavedAt: savedDraft.updatedAt,
            requestIdentity: request.contextIdentity,
            restoredAt: currentInfo?.restoredAt || '',
            source: 'local',
          }

      privateDraftInfoRef.current = nextInfo
      setPrivateDraftInfo(nextInfo)
      latestPrivateDraftSaveRef.current = {
        context,
        localDraft: savedDraft,
        payload,
        request,
        saveEpoch: request.epoch,
        version: request.revision,
      }
      return savedDraft
    }

    latestPrivateDraftSaveRef.current = {
      context,
      localDraft: null,
      payload,
      request,
      saveEpoch: request.epoch,
      version: request.revision,
    }
    return null
  }, [draftStorageKey, user])

  const saveServerDraftWithRetry = useCallback(async ({ context, localDraft, payload, request }) => {
    const isCurrentRequest = () => (
      !isPrivateDraftClosingRef.current &&
      privateDraftRequestCoordinatorRef.current.isCurrent(request) &&
      request.fingerprint === privateDraftActiveFingerprintRef.current
    )

    if (!isCurrentRequest()) {
      return localDraft?.id ? { localSaved: true, serverSaved: false } : { localSaved: false, serverSaved: false }
    }

    if (isDemoUser(user)) {
      setPrivateDraftLifecycle(
        localDraft?.id
          ? PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline
          : PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed,
      )
      return localDraft?.id ? { localSaved: true, serverSaved: false } : { localSaved: false, serverSaved: false }
    }

    if (isPrivateEvaluationDraftOffline()) {
      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline)
      return {
        localSaved: Boolean(localDraft?.id),
        offline: true,
        serverSaved: false,
      }
    }

    try {
      if (!isCurrentRequest()) {
        return { localSaved: Boolean(localDraft?.id), serverSaved: false, stale: true }
      }

      const currentInfo = privateDraftInfoRef.current
      const serverDraft = await saveServerEvaluationDraft({
        context,
        existingDraftContextKey: currentInfo?.requestIdentity === request.contextIdentity
          ? currentInfo.contextKey || ''
          : '',
        existingDraftId: currentInfo?.requestIdentity === request.contextIdentity && currentInfo?.source === 'server'
          ? currentInfo.id
          : '',
        payload,
        user,
      })
      const coordinatorState = privateDraftRequestCoordinatorRef.current.snapshot()

      if (
        request.contextIdentity === coordinatorState.contextIdentity &&
        Number(request.epoch) === Number(coordinatorState.epoch)
      ) {
        privateDraftServerConfirmationRef.current = choosePrivateEvaluationDraftServerAcknowledgement({
          currentAcknowledgement: privateDraftServerConfirmationRef.current,
          request,
          serverDraft,
        })
      }

      if (!isCurrentRequest()) {
        return { localSaved: Boolean(localDraft?.id), serverSaved: Boolean(serverDraft?.id), stale: true }
      }

      const responseDisposition = getPrivateEvaluationDraftSaveResponseDisposition({
        activeFingerprint: privateDraftActiveFingerprintRef.current,
        request,
        requestIsCurrent: isCurrentRequest(),
        serverDraft,
      })

      if (!responseDisposition.ownsVisibleStatus) {
        return {
          localSaved: Boolean(localDraft?.id),
          serverSaved: Boolean(serverDraft?.id),
          stale: true,
        }
      }

      if (responseDisposition.retryable) {
        setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed)
        return {
          conflict: Boolean(serverDraft?.id),
          localSaved: Boolean(localDraft?.id),
          serverSaved: false,
        }
      }

      const requestFingerprint = request.fingerprint || getPrivateEvaluationDraftPayloadFingerprint(payload)

      privateDraftRequestCoordinatorRef.current.hydrateRevision(serverDraft.clientSaveVersion)
      privateDraftSaveVersionRef.current = Math.max(
        privateDraftSaveVersionRef.current,
        serverDraft.clientSaveVersion,
      )
      const nextInfo = {
        id: serverDraft.id,
        contextKey: serverDraft.contextKey || '',
        lastSavedAt: serverDraft.lastSavedAt,
        localDraftId: localDraft?.id || currentInfo?.localDraftId || '',
        requestIdentity: request.contextIdentity,
        restoredAt: currentInfo?.restoredAt || '',
        source: 'server',
      }

      privateDraftInfoRef.current = nextInfo
      setPrivateDraftInfo(nextInfo)
      privateDraftHydrationBaselineFingerprintRef.current = requestFingerprint
      privateDraftHasGenuineEditRef.current = false
      latestPrivateDraftSaveRef.current = null
      privateDraftRetryAttemptRef.current = 0
      clearPrivateDraftRetryTimer()

      if (privateDraftSaveTimerRef.current) {
        window.clearTimeout(privateDraftSaveTimerRef.current)
        privateDraftSaveTimerRef.current = null
      }

      setOfflineStatusMessage('')
      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saved)
      return { localSaved: Boolean(localDraft?.id), serverSaved: true }
    } catch (error) {
      if (!isCurrentRequest()) {
        return {
          error,
          localSaved: Boolean(localDraft?.id),
          serverSaved: false,
          stale: true,
        }
      }

      if (isPrivateEvaluationDraftOffline()) {
        setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline)
        return {
          error,
          localSaved: Boolean(localDraft?.id),
          offline: true,
          serverSaved: false,
        }
      }

      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed)
      return {
        error,
        localSaved: Boolean(localDraft?.id),
        serverSaved: false,
      }
    }
  }, [clearPrivateDraftRetryTimer, setPrivateDraftLifecycle, user])

  const enqueueServerDraftSave = useCallback((request) => {
    return privateDraftSingleFlightRef.current.enqueue(
      request,
      saveServerDraftWithRetry,
    )
  }, [saveServerDraftWithRetry])

  const stagePrivateDraftSave = useCallback(({ explicit = false, reason = 'manual' } = {}) => {
    const payloadWithoutRevision = buildCurrentPrivateDraftPayload(privateDraftSaveVersionRef.current)

    if (!hasPrivateEvaluationDraftContent(payloadWithoutRevision)) {
      return null
    }

    const context = buildCurrentPrivateDraftContext(payloadWithoutRevision.formData || formData)
    const contextIdentity = getPrivateEvaluationDraftRequestIdentity({
      context,
      payload: payloadWithoutRevision,
    })
    const fingerprint = getPrivateEvaluationDraftPayloadFingerprint(payloadWithoutRevision)
    const pendingSave = latestPrivateDraftSaveRef.current

    if (
      pendingSave?.request?.contextIdentity === contextIdentity &&
      pendingSave?.request?.fingerprint === fingerprint &&
      privateDraftRequestCoordinatorRef.current.isCurrent(pendingSave.request)
    ) {
      return pendingSave
    }

    if (
      fingerprint === privateDraftHydrationBaselineFingerprintRef.current &&
      !pendingSave &&
      !explicit
    ) {
      return null
    }

    clearPrivateDraftRetryTimer()
    privateDraftRetryAttemptRef.current = 0
    const requestState = privateDraftRequestCoordinatorRef.current.nextRequest(contextIdentity)
    const request = {
      ...requestState,
      fingerprint,
    }
    privateDraftSaveVersionRef.current = request.revision
    const payload = buildCurrentPrivateDraftPayload(request.revision)
    const localDraft = savePrivateDraftLocalCopy({
      context,
      payload,
      request,
    })
    const stagedSave = {
      context,
      localDraft,
      payload,
      reason,
      request,
      saveEpoch: request.epoch,
      version: request.revision,
    }

    latestPrivateDraftSaveRef.current = stagedSave
    return stagedSave
  }, [
    buildCurrentPrivateDraftContext,
    buildCurrentPrivateDraftPayload,
    clearPrivateDraftRetryTimer,
    formData,
    savePrivateDraftLocalCopy,
  ])

  const flushPrivateDraftSave = useCallback(async ({ explicit = false, reason = 'manual' } = {}) => {
    if (privateDraftSaveTimerRef.current) {
      window.clearTimeout(privateDraftSaveTimerRef.current)
      privateDraftSaveTimerRef.current = null
    }

    if (
      !hasInitializedRef.current ||
      !privateDraftHydrationReadyRef.current ||
      isPlatformOwner ||
      editingEvaluationId ||
      isPrivateDraftClosingRef.current ||
      [
        PRIVATE_EVALUATION_DRAFT_LIFECYCLE.initialising,
        PRIVATE_EVALUATION_DRAFT_LIFECYCLE.loadingExistingDraft,
        PRIVATE_EVALUATION_DRAFT_LIFECYCLE.submitting,
        PRIVATE_EVALUATION_DRAFT_LIFECYCLE.discarding,
      ].includes(privateDraftLifecycleRef.current)
    ) {
      return { skipped: true }
    }

    const currentSave = stagePrivateDraftSave({ explicit, reason })

    if (!currentSave?.request || !privateDraftRequestCoordinatorRef.current.isCurrent(currentSave.request)) {
      return { skipped: true }
    }

    if (isPrivateEvaluationDraftOffline()) {
      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline)
      return {
        localSaved: Boolean(currentSave.localDraft?.id),
        offline: true,
        serverSaved: false,
      }
    }

    setPrivateDraftLifecycle(
      ['online-retry', 'backoff-retry', 'manual-retry'].includes(reason)
        ? PRIVATE_EVALUATION_DRAFT_LIFECYCLE.retrying
        : PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saving,
    )
    return enqueueServerDraftSave(currentSave)
  }, [
    editingEvaluationId,
    enqueueServerDraftSave,
    isPlatformOwner,
    setPrivateDraftLifecycle,
    stagePrivateDraftSave,
  ])

  useEffect(() => {
    if (!user) {
      return
    }

    privateDraftHydrationCycleRef.current += 1
    privateDraftHydrationReadyRef.current = false
    privateDraftHydrationExpectedFingerprintRef.current = null
    privateDraftHydrationBaselineFingerprintRef.current = ''
    privateDraftHydrationFinalStatusRef.current = PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated
    privateDraftHydrationNeedsServerSyncRef.current = false
    privateDraftRequestCoordinatorRef.current.invalidate()
    privateDraftSingleFlightRef.current.invalidate()
    privateDraftHasGenuineEditRef.current = false
    latestPrivateDraftSaveRef.current = null
    serverDraftRestoreKeyRef.current = ''
    hasInitializedRef.current = false
    privateDraftRecoveryInFlightRef.current = false
    privateDraftRetryAttemptRef.current = 0
    clearPrivateDraftRetryTimer()

    if (privateDraftSaveTimerRef.current) {
      window.clearTimeout(privateDraftSaveTimerRef.current)
      privateDraftSaveTimerRef.current = null
    }

    setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.initialising)

    const requestedPlayerName = String(searchParams.get('player') ?? '').trim()
    const requestedTeam = String(searchParams.get('team') ?? '').trim()
    const requestedSession = normalizeSessionValue(searchParams.get('session'))
    const requestedSection = String(searchParams.get('section') ?? '').trim()
    const requestedFeedbackForm = String(searchParams.get('feedbackForm') ?? '').trim()
    const privateDraftContext = buildPrivateEvaluationDraftContext({
      formId: requestedFeedbackForm,
      formData: {
        playerName: requestedPlayerName,
        section: requestedSection,
        session: requestedSession,
        team: requestedTeam,
      },
      user,
    })
    const privateDraft = editingEvaluationId || shouldChooseAssessmentPlayer
      ? null
      : findPrivateEvaluationDraft({ context: privateDraftContext, user })
    const storedDraft = editingEvaluationId || shouldChooseAssessmentPlayer
      ? null
      : parseStoredDraft(draftStorageKey)
    const latestDraft = chooseLatestPrivateEvaluationDraft([
      privateDraft ? { ...privateDraft, source: 'local' } : null,
      storedDraft ? {
        id: privateDraft?.id || '',
        lastSavedAt: storedDraft.draftMeta?.clientSavedAt || '',
        payload: storedDraft,
        source: 'local',
        updatedAt: storedDraft.draftMeta?.clientSavedAt || '',
      } : null,
    ])
    const latestPayload = latestDraft?.payload || null
    const restoredFormData =
      latestPayload?.formData && typeof latestPayload.formData === 'object' ? latestPayload.formData : {}
    const restoredOfflineDraftId = String(latestPayload?.offlineDraftId ?? '').trim()
    const restoredSession = normalizeSessionValue(restoredFormData.session)
    const rememberedSession = normalizeSessionValue(latestPayload?.lastUsedSession)
    const nextSessionValue = requestedSession || restoredSession || rememberedSession
    const nextFormData = createInitialFormData(user, {
      ...restoredFormData,
      playerName: requestedPlayerName || String(restoredFormData.playerName ?? '').trim(),
      team: requestedTeam || String(restoredFormData.team ?? '').trim(),
      section: EVALUATION_SECTIONS.includes(requestedSection)
        ? requestedSection
        : String(restoredFormData.section ?? 'Trial'),
      session: nextSessionValue,
      coachName: user.name || '',
    })

    setFormData(nextFormData)
    setPreviewMode(['scored', 'email'].includes(String(latestPayload?.previewMode)) ? String(latestPayload.previewMode) : 'scored')
    setEmailTemplateKey(String(latestPayload?.emailTemplateKey ?? ''))
    setSelectedParentContactIndexes(
      Array.isArray(latestPayload?.selectedParentContactIndexes) && latestPayload.selectedParentContactIndexes.length > 0
        ? latestPayload.selectedParentContactIndexes
        : [0],
    )
    setInviteDate(normalizeSessionValue(latestPayload?.inviteDate))
    setSelectedFeedbackFormId(
      String(latestPayload?.selectedFeedbackFormId ?? requestedFeedbackForm).trim(),
    )
    setResponseValues(
      latestPayload?.responseValues && typeof latestPayload.responseValues === 'object' ? latestPayload.responseValues : {},
    )
    setLastUsedSession(nextSessionValue)
    setOfflineDraftId(restoredOfflineDraftId || createLocalId())
    setIsPdfAttachmentApproved(Boolean(latestPayload?.isPdfAttachmentApproved))
    setIncludeAttendanceSummary(latestPayload?.includeAttendanceSummary !== false)
    setEmailSendMode(latestPayload?.emailSendMode === 'scheduled' ? 'scheduled' : 'now')
    setScheduledEmailDateTime(String(latestPayload?.scheduledEmailDateTime ?? ''))
    restoredPrivateDraftExportLabelsRef.current = Array.isArray(latestPayload?.selectedExportLabels)
      ? latestPayload.selectedExportLabels
      : null
    setSelectedExportLabels(restoredPrivateDraftExportLabelsRef.current)
    setArchiveAfterNoPlace(Boolean(latestPayload?.archiveAfterNoPlace))
    const initialRequestIdentity = getPrivateEvaluationDraftRequestIdentity({
      context: {
        ...privateDraftContext,
        formId: String(latestPayload?.selectedFeedbackFormId ?? requestedFeedbackForm).trim(),
      },
      payload: latestPayload || {},
    })
    const coordinatorState = privateDraftRequestCoordinatorRef.current.beginContext(
      initialRequestIdentity,
      getPrivateEvaluationDraftSaveVersion(latestDraft || latestPayload || {}),
    )
    privateDraftSaveVersionRef.current = coordinatorState.revision
    const initialDraftInfo = latestDraft?.id ? {
      id: latestDraft.id,
      contextKey: latestDraft.contextKey || '',
      lastSavedAt: latestDraft.lastSavedAt || latestDraft.updatedAt || '',
      requestIdentity: initialRequestIdentity,
      restoredAt: latestDraft.lastSavedAt || latestDraft.updatedAt || '',
      source: 'local',
    } : null
    privateDraftInfoRef.current = initialDraftInfo
    setPrivateDraftInfo(initialDraftInfo)
    setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.loadingExistingDraft)
    hasInitializedRef.current = true
  }, [
    clearPrivateDraftRetryTimer,
    draftStorageKey,
    editingEvaluationId,
    searchParams,
    searchParamsKey,
    setPrivateDraftLifecycle,
    shouldChooseAssessmentPlayer,
    user,
    userScopeKey,
  ])

  useEffect(() => {
    if (
      !hasInitializedRef.current ||
      !user ||
      isPlatformOwner ||
      isDemoUser(user) ||
      isLoadingTeams ||
      isLoadingPlayers ||
      isLoadingFields ||
      isLoadingFeedbackForms
    ) {
      return undefined
    }

    const hydrationCycle = privateDraftHydrationCycleRef.current
    const currentPayload = buildCurrentPrivateDraftPayload(privateDraftSaveVersionRef.current)
    const draftContext = buildCurrentPrivateDraftContext(formData)
    const hasDraftContext = Boolean(draftContext.playerName || draftContext.playerId)
    const requestIdentity = getPrivateEvaluationDraftRequestIdentity({
      context: draftContext,
      payload: currentPayload,
    })

    if (editingEvaluationId || shouldChooseAssessmentPlayer || !hasDraftContext) {
      privateDraftHydrationExpectedFingerprintRef.current =
        getPrivateEvaluationDraftPayloadFingerprint(currentPayload)
      privateDraftHydrationFinalStatusRef.current = PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated
      privateDraftRequestCoordinatorRef.current.beginContext(
        requestIdentity,
        privateDraftSaveVersionRef.current,
      )
      setPrivateDraftHydrationCommit((current) => current + 1)
      return undefined
    }

    const restoreKey = `${hydrationCycle}:${requestIdentity}`

    if (serverDraftRestoreKeyRef.current === restoreKey) {
      return undefined
    }

    serverDraftRestoreKeyRef.current = restoreKey
    let isMounted = true

    const restoreServerDraft = async () => {
      try {
        const serverDraft = await findServerEvaluationDraft({
          context: draftContext,
          user,
        })
        const localDraft = findPrivateEvaluationDraft({
          context: draftContext,
          user,
        })
        const latestDraft = chooseLatestPrivateEvaluationDraft([
          serverDraft ? { ...serverDraft, source: 'server' } : null,
          localDraft ? { ...localDraft, source: 'local' } : null,
        ])

        if (!isMounted || hydrationCycle !== privateDraftHydrationCycleRef.current) {
          return
        }

        if (latestDraft?.payload && hasPrivateEvaluationDraftContent(latestDraft.payload)) {
          restorePrivateDraftPayload(latestDraft, latestDraft.source || 'server')
          privateDraftHydrationNeedsServerSyncRef.current =
            latestDraft.source === 'local' &&
            (
              !serverDraft ||
              getPrivateEvaluationDraftSaveVersion(latestDraft) >
                getPrivateEvaluationDraftSaveVersion(serverDraft)
            )
        } else {
          privateDraftHydrationExpectedFingerprintRef.current =
            getPrivateEvaluationDraftPayloadFingerprint(currentPayload)
          privateDraftRequestCoordinatorRef.current.beginContext(
            requestIdentity,
            privateDraftSaveVersionRef.current,
          )
        }

        privateDraftHydrationFinalStatusRef.current = PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated
        setPrivateDraftHydrationCommit((current) => current + 1)
      } catch (error) {
        console.error(error)

        if (!isMounted || hydrationCycle !== privateDraftHydrationCycleRef.current) {
          return
        }

        privateDraftHydrationExpectedFingerprintRef.current =
          getPrivateEvaluationDraftPayloadFingerprint(currentPayload)
        privateDraftHydrationNeedsServerSyncRef.current =
          privateDraftInfoRef.current?.source === 'local'
        privateDraftHydrationFinalStatusRef.current =
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline
            : PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed
        setPrivateDraftHydrationCommit((current) => current + 1)
      }
    }

    void restoreServerDraft()

    return () => {
      isMounted = false
    }
  }, [
    buildCurrentPrivateDraftContext,
    buildCurrentPrivateDraftPayload,
    editingEvaluationId,
    formData,
    isLoadingFeedbackForms,
    isLoadingFields,
    isLoadingPlayers,
    isLoadingTeams,
    isPlatformOwner,
    restorePrivateDraftPayload,
    shouldChooseAssessmentPlayer,
    user,
  ])

  useEffect(() => {
    if (
      !hasInitializedRef.current ||
      privateDraftHydrationExpectedFingerprintRef.current === null ||
      isLoadingTeams ||
      isLoadingPlayers ||
      isLoadingFields ||
      isLoadingFeedbackForms
    ) {
      return
    }

    const payload = buildCurrentPrivateDraftPayload(privateDraftSaveVersionRef.current)
    const context = buildCurrentPrivateDraftContext(payload.formData || formData)
    const requestIdentity = getPrivateEvaluationDraftRequestIdentity({ context, payload })
    const coordinatorState = privateDraftRequestCoordinatorRef.current.beginContext(
      requestIdentity,
      privateDraftSaveVersionRef.current,
    )

    privateDraftSaveVersionRef.current = coordinatorState.revision
    privateDraftHydrationBaselineFingerprintRef.current =
      getPrivateEvaluationDraftPayloadFingerprint(payload)
    privateDraftHydrationExpectedFingerprintRef.current = null
    privateDraftHydrationReadyRef.current = true
    privateDraftHasGenuineEditRef.current = false
    setPrivateDraftLifecycle(privateDraftHydrationFinalStatusRef.current)

    if (privateDraftHydrationNeedsServerSyncRef.current) {
      privateDraftHydrationNeedsServerSyncRef.current = false
      window.setTimeout(() => {
        void flushPrivateDraftSave({
          explicit: true,
          reason: 'hydration-retry',
        })
      }, 0)
    }
  }, [
    buildCurrentPrivateDraftContext,
    buildCurrentPrivateDraftPayload,
    formData,
    isLoadingFeedbackForms,
    isLoadingFields,
    isLoadingPlayers,
    isLoadingTeams,
    privateDraftHydrationCommit,
    flushPrivateDraftSave,
    setPrivateDraftLifecycle,
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

      setIsLoadingTeams(true)
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
        setResponseValues((current) => {
          const emptyValues = createEmptyResponseValues(fields)

          return Object.fromEntries(Object.keys(emptyValues).map((key) => [key, current[key] ?? '']))
        })
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
            setResponseValues(createEmptyResponseValues(fallbackFields))
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

  useEffect(() => {
    if (
      !hasInitializedRef.current ||
      isPlatformOwner ||
      editingEvaluationId ||
      isPrivateDraftClosingRef.current
    ) {
      return
    }

    if (privateDraftSaveTimerRef.current) {
      window.clearTimeout(privateDraftSaveTimerRef.current)
      privateDraftSaveTimerRef.current = null
    }

    const draftPayload = buildCurrentPrivateDraftPayload(privateDraftSaveVersionRef.current)

    if (!hasPrivateEvaluationDraftContent(draftPayload)) {
      return
    }

    const fingerprint = getPrivateEvaluationDraftPayloadFingerprint(draftPayload)

    if (!canAutosavePrivateEvaluationDraft({
      baselineFingerprint: privateDraftHydrationBaselineFingerprintRef.current,
      dependenciesResolved:
        Boolean(user) &&
        !isLoadingTeams &&
        !isLoadingPlayers &&
        !isLoadingFields &&
        !isLoadingFeedbackForms,
      fingerprint,
      hasContent: hasPrivateEvaluationDraftContent(draftPayload),
      hydrationReady: privateDraftHydrationReadyRef.current,
      lifecycle: privateDraftLifecycleRef.current,
      requiredContextReady:
        Boolean(normalizePlayerName(formData.playerName)) &&
        Boolean(String(formData.team ?? '').trim()) &&
        Boolean(normalizeSessionValue(formData.session)) &&
        Boolean(selectedFeedbackFormId) &&
        (
          selectedFeedbackFormId === DEFAULT_FEEDBACK_FORM_ID ||
          feedbackForms.some(
            (form) => String(form.selectionId || form.id) === String(selectedFeedbackFormId),
          )
        ),
      userEdited: privateDraftHasGenuineEditRef.current,
    })) {
      return
    }

    const stagedSave = stagePrivateDraftSave({ reason: 'change' })

    if (!stagedSave?.request) {
      return
    }

    if (isPrivateEvaluationDraftOffline()) {
      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline)
      return
    }

    const inFlightSave = privateDraftSingleFlightRef.current.snapshot()

    if (
      isSamePrivateEvaluationDraftSave(inFlightSave.active, stagedSave) ||
      isSamePrivateEvaluationDraftSave(inFlightSave.pending, stagedSave)
    ) {
      return
    }

    setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.dirty)
    privateDraftSaveTimerRef.current = window.setTimeout(() => {
      void flushPrivateDraftSave({ reason: 'debounce' })
    }, 800)

    return () => {
      if (privateDraftSaveTimerRef.current) {
        window.clearTimeout(privateDraftSaveTimerRef.current)
        privateDraftSaveTimerRef.current = null
      }
    }
  }, [
    archiveAfterNoPlace,
    buildCurrentPrivateDraftPayload,
    editingEvaluationId,
    emailSendMode,
    emailTemplateKey,
    feedbackForms,
    flushPrivateDraftSave,
    formData,
    includeAttendanceSummary,
    inviteDate,
    isPdfAttachmentApproved,
    isLoadingFeedbackForms,
    isLoadingFields,
    isLoadingPlayers,
    isLoadingTeams,
    isPlatformOwner,
    lastUsedSession,
    offlineDraftId,
    previewMode,
    responseValues,
    scheduledEmailDateTime,
    selectedFeedbackFormId,
    selectedExportLabels,
    selectedParentContactIndexes,
    setPrivateDraftLifecycle,
    stagePrivateDraftSave,
    user,
  ])

  useEffect(() => {
    const handleOnline = () => {
      if (!canRecoverPrivateEvaluationDraft({
        hasPendingRevision: Boolean(latestPrivateDraftSaveRef.current),
        lifecycle: privateDraftLifecycleRef.current,
        online: !isPrivateEvaluationDraftOffline(),
        recoveryInFlight: privateDraftRecoveryInFlightRef.current,
      })) {
        return
      }

      clearPrivateDraftRetryTimer()
      privateDraftRecoveryInFlightRef.current = true
      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.retrying)
      void flushPrivateDraftSave({
        explicit: true,
        reason: 'online-retry',
      }).finally(() => {
        privateDraftRecoveryInFlightRef.current = false
      })
    }

    const handleOffline = () => {
      if (!latestPrivateDraftSaveRef.current) {
        return
      }

      clearPrivateDraftRetryTimer()
      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [
    clearPrivateDraftRetryTimer,
    flushPrivateDraftSave,
    setPrivateDraftLifecycle,
  ])

  useEffect(() => {
    if (
      privateDraftStatus !== PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed ||
      !latestPrivateDraftSaveRef.current ||
      isPrivateEvaluationDraftOffline()
    ) {
      return undefined
    }

    clearPrivateDraftRetryTimer()
    const attempt = privateDraftRetryAttemptRef.current + 1
    privateDraftRetryAttemptRef.current = attempt
    const retryDelay = getPrivateEvaluationDraftRecoveryDelay({ attempt })

    privateDraftRetryTimerRef.current = window.setTimeout(() => {
      privateDraftRetryTimerRef.current = null

      if (!canRecoverPrivateEvaluationDraft({
        hasPendingRevision: Boolean(latestPrivateDraftSaveRef.current),
        lifecycle: privateDraftLifecycleRef.current,
        online: !isPrivateEvaluationDraftOffline(),
        recoveryInFlight: privateDraftRecoveryInFlightRef.current,
      })) {
        return
      }

      privateDraftRecoveryInFlightRef.current = true
      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.retrying)
      void flushPrivateDraftSave({
        explicit: true,
        reason: 'backoff-retry',
      }).finally(() => {
        privateDraftRecoveryInFlightRef.current = false
      })
    }, retryDelay)

    return clearPrivateDraftRetryTimer
  }, [
    clearPrivateDraftRetryTimer,
    flushPrivateDraftSave,
    privateDraftStatus,
    setPrivateDraftLifecycle,
  ])

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!shouldWarnPrivateDraftRef.current) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => () => {
    clearPrivateDraftRetryTimer()
    privateDraftRecoveryInFlightRef.current = false
    privateDraftSingleFlightRef.current.invalidate()

    if (privateDraftSaveTimerRef.current) {
      window.clearTimeout(privateDraftSaveTimerRef.current)
      privateDraftSaveTimerRef.current = null
    }
  }, [clearPrivateDraftRetryTimer])

  useEffect(() => {
    const handleInternalDraftNavigation = (event) => {
      if (!shouldWarnPrivateDraftRef.current || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }

      const anchor = event.target?.closest?.('a[href]')

      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) {
        return
      }

      const url = new URL(anchor.href, window.location.href)

      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) {
        return
      }

      event.preventDefault()
      void flushPrivateDraftSave({ reason: 'navigation' }).finally(() => {
        navigate(`${url.pathname}${url.search}${url.hash}`)
      })
    }

    document.addEventListener('click', handleInternalDraftNavigation, true)

    return () => document.removeEventListener('click', handleInternalDraftNavigation, true)
  }, [flushPrivateDraftSave, navigate])

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
    if (
      editingEvaluation ||
      !privateDraftHydrationReadyRef.current ||
      (
        selectedFeedbackFormId &&
        !isDefaultFeedbackFormSelected &&
        !selectedFeedbackForm
      )
    ) {
      return
    }

    setResponseValues((current) => {
      const emptyValues = createEmptyResponseValues(activeFields)
      return Object.fromEntries(Object.keys(emptyValues).map((key) => [key, current[key] ?? '']))
    })
  }, [
    activeFields,
    editingEvaluation,
    isDefaultFeedbackFormSelected,
    privateDraftStatus,
    selectedFeedbackForm,
    selectedFeedbackFormId,
  ])

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
  const selectedParentContacts = useMemo(() => {
    const selectedContacts = parentContacts.filter((_, index) => selectedParentContactIndexes.includes(index))
    return selectedContacts.length > 0 ? selectedContacts : parentContacts.slice(0, 1)
  }, [parentContacts, selectedParentContactIndexes])
  const selectedParentEmail = formatParentContactEmails(selectedParentContacts, formData.parentEmail)
  const isDemoAccount = isDemoUser(user)
  const noTeamsMessage = canManageUsers(user)
    ? 'No teams exist for this club yet. Create a team first, then development records can be assigned correctly.'
    : 'No teams exist for this club yet. Ask a manager to create a team before adding development records.'
  const reminderMessage = previewMode === 'email'
    ? emailSendMode === 'scheduled'
      ? 'Set the next reminder before confirming the scheduled parent update.'
      : 'Set the next reminder before confirming the parent update.'
    : 'Do you want to set a reminder for the next development record?'
  const reminderCancelLabel = previewMode === 'email'
    ? emailSendMode === 'scheduled'
      ? 'Not now, schedule email'
      : 'Not now, send email'
    : 'Not now, save only'
  const reminderConfirmLabel = previewMode === 'email'
    ? emailSendMode === 'scheduled'
      ? 'Save Reminder and Schedule Email'
      : 'Save Reminder and Send Email'
    : 'Save Reminder'

  const handleCompletionContinue = () => {
    const nextUrl = completionNavigationUrl
    setCompletionModal(null)
    setCompletionNavigationUrl('')

    if (nextUrl) {
      navigate(nextUrl)
    }
  }

  const handleResumePrivateDraft = async () => {
    setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.loadingExistingDraft)

    try {
      const draftContext = buildCurrentPrivateDraftContext(formData)
      const localDraft = findPrivateEvaluationDraft({
        context: draftContext,
        user,
      })
      const serverDraft = !isDemoUser(user)
        ? await findServerEvaluationDraft({
            context: draftContext,
            user,
          })
        : null
      const draft = chooseLatestPrivateEvaluationDraft([
        serverDraft ? { ...serverDraft, source: 'server' } : null,
        localDraft ? { ...localDraft, source: 'local' } : null,
      ])
      const source = draft?.source || 'local'

      if (!restorePrivateDraftPayload(draft, source)) {
        showToast({
          title: 'Private draft not opened',
          message: 'No active private draft was found for this record context.',
          tone: 'error',
        })
        setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated)
        return
      }

      privateDraftHydrationBaselineFingerprintRef.current =
        getPrivateEvaluationDraftPayloadFingerprint(draft.payload || draft)
      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated)
      showToast({ title: 'Private draft opened', message: 'The saved draft values have been restored.' })
    } catch (error) {
      console.error(error)
      showToast({
        title: 'Private draft not opened',
        message: error.message || 'The private draft could not be opened.',
        tone: 'error',
      })
      setPrivateDraftLifecycle(
        isNetworkError(error)
          ? PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline
          : PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed,
      )
    }
  }

  const beginPrivateDraftClose = () => {
    const draftInfo = privateDraftInfoRef.current
    const latestSave = latestPrivateDraftSaveRef.current

    isPrivateDraftClosingRef.current = true
    privateDraftRecoveryInFlightRef.current = false
    privateDraftRetryAttemptRef.current = 0
    clearPrivateDraftRetryTimer()
    privateDraftRequestCoordinatorRef.current.invalidate()
    privateDraftSingleFlightRef.current.invalidate()
    shouldWarnPrivateDraftRef.current = false

    if (privateDraftSaveTimerRef.current) {
      window.clearTimeout(privateDraftSaveTimerRef.current)
      privateDraftSaveTimerRef.current = null
    }

    latestPrivateDraftSaveRef.current = null

    return { draftInfo, latestSave }
  }

  const closeServerDraftForSnapshot = async (closeSnapshot, status) => {
    if (isDemoUser(user)) {
      return false
    }

    const currentInfo = privateDraftInfoRef.current
    const serverDraftId =
      (currentInfo?.source === 'server' && currentInfo.id) ||
      (closeSnapshot.draftInfo?.source === 'server' && closeSnapshot.draftInfo.id) ||
      ''
    const lookupContext =
      closeSnapshot.latestSave?.context ||
      latestPrivateDraftSaveRef.current?.context ||
      null
    const serverDraft = serverDraftId
      ? { id: serverDraftId }
      : lookupContext
        ? await findServerEvaluationDraft({
            context: lookupContext,
            user,
          })
        : null

    if (!serverDraft?.id) {
      return false
    }

    const didCloseServerDraft = await closeServerEvaluationDraft({
      draftId: serverDraft.id,
      status,
      user,
    })

    if (didCloseServerDraft) {
      return true
    }

    const remainingDraft = lookupContext
      ? await findServerEvaluationDraft({
          context: lookupContext,
          user,
        })
      : null

    if (remainingDraft?.id === serverDraft.id) {
      const closeError = new Error('The private Development draft was not closed.')
      closeError.code = 'DRAFT_CLOSE_ZERO_ROWS'
      throw closeError
    }

    return false
  }

  const clearLocalDraftsForSnapshot = (closeSnapshot, status) => {
    const localDraftIds = new Set([
      closeSnapshot.latestSave?.localDraft?.id,
      closeSnapshot.draftInfo?.source === 'local' ? closeSnapshot.draftInfo.id : '',
      closeSnapshot.draftInfo?.localDraftId,
      privateDraftInfoRef.current?.source === 'local' ? privateDraftInfoRef.current.id : '',
      privateDraftInfoRef.current?.localDraftId,
    ].filter(Boolean))

    localDraftIds.forEach((draftId) => {
      clearPrivateEvaluationDraft({
        draftId,
        status,
        user,
      })
    })
  }

  const handleDiscardPrivateDraft = async () => {
    const closeSnapshot = beginPrivateDraftClose()
    setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.discarding)

    try {
      await privateDraftSingleFlightRef.current.waitForIdle()
      await closeServerDraftForSnapshot(closeSnapshot, PRIVATE_EVALUATION_DRAFT_STATUSES.discarded)
      clearLocalDraftsForSnapshot(closeSnapshot, PRIVATE_EVALUATION_DRAFT_STATUSES.discarded)

      if (draftStorageKey) {
        sessionStorage.removeItem(draftStorageKey)
      }

      const requestedPlayerName = String(searchParams.get('player') ?? '').trim()
      const requestedTeam = String(searchParams.get('team') ?? '').trim()
      const requestedSession = normalizeSessionValue(searchParams.get('session'))
      const requestedSection = String(searchParams.get('section') ?? '').trim()

      latestPrivateDraftSaveRef.current = null
      privateDraftHasGenuineEditRef.current = false
      privateDraftInfoRef.current = null
      setFormData(createInitialFormData(user, {
        playerName: requestedPlayerName,
        team: requestedTeam || availableTeams[0]?.name || '',
        section: EVALUATION_SECTIONS.includes(requestedSection) ? requestedSection : 'Trial',
        session: requestedSession,
        coachName: user?.name || '',
      }))
      setResponseValues(createEmptyResponseValues(dynamicFields))
      setPrivateDraftInfo(null)
      privateDraftHydrationBaselineFingerprintRef.current = ''
      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.discarded)
      showToast({ title: 'Private draft discarded', message: 'The private Development draft has been cleared.' })
    } catch (error) {
      console.error(error)
      latestPrivateDraftSaveRef.current = closeSnapshot.latestSave
      showToast({
        title: 'Private draft not discarded',
        message: error.message || 'The private Development draft could not be closed. Try again before leaving this page.',
        tone: 'error',
      })
      setPrivateDraftLifecycle(
        isNetworkError(error)
          ? PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline
          : PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed,
      )
    } finally {
      isPrivateDraftClosingRef.current = false
    }
  }

  const closeActivePrivateDraftAfterSubmit = async () => {
    const closeSnapshot = beginPrivateDraftClose()

    try {
      await privateDraftSingleFlightRef.current.waitForIdle()

      if (draftStorageKey) {
        sessionStorage.removeItem(draftStorageKey)
      }

      await closeServerDraftForSnapshot(closeSnapshot, PRIVATE_EVALUATION_DRAFT_STATUSES.submitted)
      clearLocalDraftsForSnapshot(closeSnapshot, PRIVATE_EVALUATION_DRAFT_STATUSES.submitted)

      latestPrivateDraftSaveRef.current = null
      privateDraftHasGenuineEditRef.current = false
      privateDraftInfoRef.current = null
      setPrivateDraftInfo(null)
      privateDraftHydrationBaselineFingerprintRef.current = ''
      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.submitted)
      return true
    } catch (error) {
      console.error(error)
      latestPrivateDraftSaveRef.current = closeSnapshot.latestSave
      showToast({
        title: 'Private draft not closed',
        message: error.message || 'The Development Record was saved, but the private draft could not be closed.',
        tone: 'error',
      })
      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed)
      return false
    } finally {
      isPrivateDraftClosingRef.current = false
    }
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

  const buildEvaluationPayload = useCallback((id = offlineDraftId) => {
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
    offlineDraftId,
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

  const handleAssessmentPlayerSelect = async (player) => {
    await flushPrivateDraftSave({ reason: 'player-select' })
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

    navigate(`/assess-player/new?${nextSearchParams.toString()}`)
  }

  useEffect(() => {
    if (
      !hasInitializedRef.current ||
      !privateDraftHydrationReadyRef.current ||
      !privateDraftHasGenuineEditRef.current ||
      !user ||
      isPlatformOwner ||
      !offlineDraftId ||
      isLoadingTeams ||
      isLoadingPlayers ||
      isLoadingFields ||
      isLoadingFeedbackForms ||
      !hasFeedbackFormSelection ||
      !normalizePlayerName(formData.playerName) ||
      !String(formData.team ?? '').trim() ||
      !normalizeSessionValue(formData.session)
    ) {
      return undefined
    }

    const hasDraftContent =
      String(formData.playerName ?? '').trim() ||
      Object.values(responseValues).some((value) => String(value ?? '').trim()) ||
      parentContacts.some((contact) => contact.name || contact.email)

    if (!hasDraftContent) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      try {
        saveDraft({
          id: offlineDraftId,
          operation: editingEvaluation ? 'update' : 'create',
          evaluationId: editingEvaluation?.id || null,
          clubId: user.clubId,
          data: buildEvaluationPayload(offlineDraftId),
          createdAt: new Date().toISOString(),
          readyToSync: false,
          synced: false,
        }, { user })

        if (!navigator.onLine) {
          setOfflineStatusMessage('Offline. This development record is being saved locally.')
        }
      } catch (error) {
        console.error('Offline draft save failed', error)
      }
    }, 900)

    return () => window.clearTimeout(timeoutId)
  }, [
    averageScore,
    availableTeams,
    buildEvaluationPayload,
    comments,
    editingEvaluation,
    formData,
    formResponses,
    isPlatformOwner,
    isLoadingFeedbackForms,
    isLoadingFields,
    isLoadingPlayers,
    isLoadingTeams,
    hasFeedbackFormSelection,
    offlineDraftId,
    parentContacts,
    responseValues,
    savedPlayers,
    scores,
    user,
  ])

  const markPrivateDraftEdited = () => {
    if (!isPrivateDraftClosingRef.current) {
      privateDraftHasGenuineEditRef.current = true
    }
  }

  const applyPrivateDraftEdit = (setter, value) => {
    markPrivateDraftEdited()
    setter(value)
  }

  const handleFieldChange = (event) => {
    const { name, value } = event.target
    markPrivateDraftEdited()
    setIsSaved(false)
    setActionErrorMessage('')

    if (name === 'session') {
      const nextSessionValue = normalizeSessionValue(value)

      setFormData((current) => ({
        ...current,
        session: nextSessionValue,
      }))
      setLastUsedSession(nextSessionValue)
      return
    }

    if (name === 'team' && formData.playerName) {
      const currentPlayerName = normalizePlayerName(formData.playerName)
      const currentSection = String(formData.section ?? '').trim()
      const matchingPlayer = savedPlayers.find(
        (player) =>
          normalizePlayerName(player.playerName) === currentPlayerName &&
          player.team === value &&
          (!currentSection || player.section === currentSection),
      )

      if (!matchingPlayer) {
        setSelectedParentContactIndexes([0])
        setFormData((current) => ({
          ...current,
          team: value,
          playerName: '',
          parentName: '',
          parentEmail: '',
          parentContacts: [],
        }))
        return
      }
    }

    if (name === 'playerName' || name === 'team') {
      const { matchingParentContacts, nextFormData } = getMatchedPlayerFieldUpdate({
        fieldName: name,
        formData,
        normalizeParentContacts,
        normalizePlayerContactType,
        savedPlayers,
        value,
      })
      setFormData(nextFormData)
      setSelectedParentContactIndexes(getSelectedContactIndexes(matchingParentContacts))
      return
    }

    if (name === 'section') {
      const currentPlayerName = normalizePlayerName(formData.playerName)
      const currentTeam = String(formData.team ?? '').trim()
      const matchingPlayer = savedPlayers.find(
        (player) =>
          normalizePlayerName(player.playerName) === currentPlayerName &&
          player.section === value &&
          (!currentTeam || player.team === currentTeam),
      )

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
      return
    }

    setFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleResponseChange = (fieldId, value) => {
    markPrivateDraftEdited()
    setIsSaved(false)
    setActionErrorMessage('')
    setResponseValues((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  const handleToggleParentContact = (index) => {
    markPrivateDraftEdited()
    setSelectedParentContactIndexes((current) => getNextSelectedContactIndexes(current, index))
  }

  const saveExportSelection = (labels) => {
    const playerName = normalizePlayerName(formData.playerName)

    markPrivateDraftEdited()
    setSelectedExportLabels(labels)
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

    if (submitLockRef.current) {
      return
    }

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

    submitLockRef.current = true
    setActionErrorMessage('')
    let completionOutcome = 'saved'
    let completionEmailErrorMessage = ''

    try {
      await flushPrivateDraftSave({ reason: 'submit' })
      setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.submitting)
      setIsSubmitting(true)
      const normalizedPlayerName = normalizePlayerName(formData.playerName)
      const evaluation = buildEvaluationPayload(offlineDraftId)

      if (!editingEvaluation?.id && user?.clubId) {
        const allEvaluations = await getEvaluations({ user })
        const monthlyEvaluationCount = getCurrentMonthEvaluationCount(allEvaluations)

        if (!isWithinPlanLimit(user, 'monthlyEvaluations', monthlyEvaluationCount)) {
          throw new Error(createLimitUpgradeMessage(user, 'monthlyEvaluations', 'Monthly development records'))
        }
      }

      if (!navigator.onLine) {
        saveDraft(createOfflineEvaluationDraft({ data: evaluation, editingEvaluation, id: offlineDraftId, user }), { user })
        setOfflineStatusMessage('Saved offline. This development record will sync when the connection returns.')
        showToast({ title: 'Saved offline', message: 'This development record will sync when you are back online.' })
        setIsSaved(true)
        setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline)
        return
      }

      const savedEvaluation = editingEvaluation
        ? await updateEvaluation(editingEvaluation.id, evaluation, user?.clubId)
        : await createEvaluation(evaluation)

      clearViewCaches()

      if (editingEvaluation) {
        setEditingEvaluation(savedEvaluation)
      } else {
        setOfflineDraftId(createLocalId())
      }

      removeDraft(offlineDraftId, { user })

      if (previewMode === 'email' && selectedParentEmail) {
        try {
          if (!canUseParentEmail) {
            throw new Error(createUiFeatureUnavailableMessage(user, CAPABILITIES.parentEmails))
          }

          setIsSendingParentEmail(true)
          const isScheduledSend = emailSendMode === 'scheduled'

          if (isScheduledSend && (!scheduledEmailDateTime || Number.isNaN(new Date(scheduledEmailDateTime).getTime()))) {
            throw new Error('Choose a valid scheduled send date and time.')
          }

          const scheduledAt = isScheduledSend ? new Date(scheduledEmailDateTime).toISOString() : ''
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
            user,
          })

          if (emailJobs.length === 0) {
            throw new Error(`Add a ${contactNoun} email before sending.`)
          }

          await Promise.all(emailJobs.map((emailJob) => sendParentEmail({
            ...emailJob.payload,
            attachPdf: isPdfAttachmentApproved,
            teamId: user?.activeTeamId || '',
            playerId: savedEvaluation?.playerId || evaluation.playerId || '',
            scheduledAt,
            communicationLog: isScheduledSend
              ? {
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
                    hasAttachment: isPdfAttachmentApproved,
                    scheduledAt,
                    assessmentFields: selectedResponseItems,
                  },
                }
              : null,
          })))
          const communicationLog = await createCommunicationLog({
            user,
            playerId: savedEvaluation?.playerId || evaluation.playerId,
            evaluationId: savedEvaluation?.id || editingEvaluation?.id || evaluation.id,
            channel: 'email',
            action: isScheduledSend ? 'parent_email_scheduled' : 'parent_email_sent',
            recipientEmail: emailJobs.map((emailJob) => emailJob.recipientEmail).join(','),
            metadata: {
              subject: emailJobs[0]?.payload?.subject || '',
              body: emailJobs[0]?.payload?.emailBody || '',
              templateName: emailJobs.map((emailJob) => emailJob.templateName).join(', '),
              team: emailJobs[0]?.payload?.team || '',
              club: emailJobs[0]?.payload?.club || '',
              playerName: normalizedPlayerName,
              hasAttachment: isPdfAttachmentApproved,
              scheduledAt,
              assessmentFields: selectedResponseItems,
            },
          })
          if (!isScheduledSend && communicationLog?.id) {
            await sendParentMobilePushNotification({
              id: communicationLog.id,
              type: 'parent_message',
            })
          }
          completionOutcome = isScheduledSend ? 'scheduled' : 'sent'
        } catch (emailError) {
          console.error('Email failed', emailError)
          completionOutcome = emailSendMode === 'scheduled' ? 'schedule_failed' : 'send_failed'
          completionEmailErrorMessage = emailError.message || ''
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
      setSelectedParentContactIndexes([0])
      if (!editingEvaluation && !postAssessmentNavigation.url) {
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
      setOfflineStatusMessage('')
      setCompletionModal(getDevelopmentRecordCompletionCopy({
        editing: Boolean(editingEvaluation),
        optionalOutputErrorMessage: completionEmailErrorMessage,
        outcome: completionOutcome,
        playerName: normalizedPlayerName,
      }))
      setArchiveAfterNoPlace(false)
      if (!isNoPlaceOfferedTemplate) {
        setNextAssessmentReminderTarget({
          evaluationId: savedEvaluation?.id || editingEvaluation?.id || evaluation.id,
          playerId: savedEvaluation?.playerId || evaluation.playerId,
          playerName: normalizedPlayerName,
          team: formData.team,
          section: formData.section,
        })
      }
    } catch (error) {
      console.error('Development record submit failed', error)
      setIsSaved(false)

      if (isNetworkError(error)) {
        try {
          saveDraft(createOfflineEvaluationDraft({
            data: buildEvaluationPayload(offlineDraftId),
            editingEvaluation,
            id: offlineDraftId,
            user,
          }), { user })
          setOfflineStatusMessage('Saved offline. This development record will sync when the connection returns.')
          showToast({ title: 'Saved offline', message: 'This development record will sync when you are back online.' })
          setPrivateDraftLifecycle(PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline)
          return
        } catch (draftError) {
          console.error('Offline draft queue failed', draftError)
        }
      }

      setActionErrorMessage(getDevelopmentRecordSaveFailureMessage(error))
      setPrivateDraftLifecycle(
        privateDraftInfoRef.current?.id
          ? PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saved
          : PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated,
      )
    } finally {
      submitLockRef.current = false
      setIsSendingParentEmail(false)
      setIsSubmitting(false)
    }
  }

  const handleContinueWithDefaultTemplate = () => {
    setHasApprovedDefaultTemplate(true)
    setIsDefaultTemplateConfirmOpen(false)
    window.setTimeout(() => formRef.current?.requestSubmit(), 0)
  }

  const handleEmailAfterSaveChange = (shouldEmail) => {
    markPrivateDraftEdited()
    setPreviewMode(shouldEmail ? 'email' : 'scored')
    setHasApprovedDefaultTemplate(false)

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

  const handleSaveNextAssessmentReminder = async () => {
    if (isNoPlaceOfferedTemplate) {
      setNextAssessmentReminderTarget(null)
      setNextAssessmentReminderDate('')
      return
    }

    if (!nextAssessmentReminderTarget || !nextAssessmentReminderDate) {
      return
    }

    setIsSavingNextAssessmentReminder(true)

    try {
      await createCommunicationLog({
        user,
        playerId: nextAssessmentReminderTarget.playerId,
        evaluationId: nextAssessmentReminderTarget.evaluationId,
        channel: 'reminder',
        action: 'next_assessment_reminder_set',
        metadata: {
          dueDate: nextAssessmentReminderDate,
          playerName: nextAssessmentReminderTarget.playerName,
          team: nextAssessmentReminderTarget.team,
          section: nextAssessmentReminderTarget.section,
        },
      })
      setNextAssessmentReminderTarget(null)
      setNextAssessmentReminderDate('')
    } catch (error) {
      console.error(error)
      showToast({
        title: 'Reminder not saved',
        message: error.message || 'The development record was saved, but the reminder could not be saved.',
        tone: 'error',
      })
    } finally {
      setIsSavingNextAssessmentReminder(false)
    }
  }

  const privateDraftBanner = getPrivateDraftBannerCopy(privateDraftStatus, privateDraftInfo)
  const canResumePrivateDraft = [
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated,
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saved,
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed,
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline,
  ].includes(privateDraftStatus) && Boolean(privateDraftInfo?.id)
  const canRetryPrivateDraft = [
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed,
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline,
  ].includes(privateDraftStatus) && Boolean(latestPrivateDraftSaveRef.current)
  const canDiscardPrivateDraft = [
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated,
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.dirty,
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saving,
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saved,
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed,
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline,
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.retrying,
  ].includes(privateDraftStatus) && Boolean(
    privateDraftInfo?.id || latestPrivateDraftSaveRef.current?.payload,
  )
  const privateDraftBannerClassName = [
    PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed,
  ].includes(privateDraftStatus)
    ? 'border-[#fda29b] bg-[#fef3f2] text-[#912018] shadow-[#b42318]/10'
    : [
        PRIVATE_EVALUATION_DRAFT_LIFECYCLE.dirty,
        PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline,
        PRIVATE_EVALUATION_DRAFT_LIFECYCLE.retrying,
      ].includes(privateDraftStatus)
      ? 'border-[#fedf89] bg-[#fffaeb] text-[#93370d] shadow-[#dc6803]/10'
      : [
          PRIVATE_EVALUATION_DRAFT_LIFECYCLE.initialising,
          PRIVATE_EVALUATION_DRAFT_LIFECYCLE.loadingExistingDraft,
          PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saving,
          PRIVATE_EVALUATION_DRAFT_LIFECYCLE.submitting,
        ].includes(privateDraftStatus)
        ? 'border-[#b2ddff] bg-[#eff8ff] text-[#175cd3] shadow-[#1570ef]/10'
        : 'border-[#bbf7d0] bg-[#ecfdf5] text-[#065f46] shadow-[#047857]/10'

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
        isOpen={isDefaultTemplateConfirmOpen}
        title="Default template"
        message={canConfigureEmailTemplates ? 'You are sending a default template. You can continue now, or open Templates to customise it first.' : 'You are sending a default template. Continue only if this message is suitable for the parent update.'}
        itemsTitle="Template"
        items={[
          selectedEmailTemplate?.label || 'Default template',
          `Recipient type: ${contactNounPlural}`,
        ]}
        confirmLabel="Continue"
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
        isOpen={Boolean(nextAssessmentReminderTarget) && !isNoPlaceOfferedTemplate}
        isBusy={isSavingNextAssessmentReminder}
        title="Set next development reminder"
        message={reminderMessage}
        cancelLabel={reminderCancelLabel}
        confirmLabel={reminderConfirmLabel}
        confirmDisabled={!nextAssessmentReminderDate}
        onCancel={() => {
          setNextAssessmentReminderTarget(null)
          setNextAssessmentReminderDate('')
        }}
        onClose={() => {
          setNextAssessmentReminderTarget(null)
          setNextAssessmentReminderDate('')
        }}
        onConfirm={() => void handleSaveNextAssessmentReminder()}
      >
        <label className="block">
          <span className="mb-2 block text-sm font-black text-[#101828]">Reminder date</span>
          <input
            type="date"
            value={nextAssessmentReminderDate}
            onChange={(event) => setNextAssessmentReminderDate(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]"
          />
        </label>
      </ConfirmModal>

      <ConfirmModal
        isOpen={Boolean(completionModal) && !nextAssessmentReminderTarget}
        title={completionModal?.title || 'Development Record saved'}
        message={completionModal?.message || ''}
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

        {offlineStatusMessage ? (
          <NoticeBanner title="Working offline" message={offlineStatusMessage} tone="info" />
        ) : null}

        {![
          PRIVATE_EVALUATION_DRAFT_LIFECYCLE.submitted,
          PRIVATE_EVALUATION_DRAFT_LIFECYCLE.discarded,
        ].includes(privateDraftStatus) ? (
          <div className={`rounded-lg border px-4 py-3 text-sm font-bold shadow-sm ${privateDraftBannerClassName}`}>
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
                {canResumePrivateDraft ? (
                  <button
                    type="button"
                    onClick={() => void handleResumePrivateDraft()}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white transition hover:bg-[#065f46]"
                  >
                    Resume draft
                  </button>
                ) : null}
                {canRetryPrivateDraft ? (
                  <button
                    type="button"
                    onClick={() => void flushPrivateDraftSave({ reason: 'manual-retry' })}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white transition hover:bg-[#065f46]"
                  >
                    Retry save
                  </button>
                ) : null}
                {canDiscardPrivateDraft ? (
                  <button
                    type="button"
                    onClick={() => void handleDiscardPrivateDraft()}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#86efac] bg-white px-4 py-3 text-sm font-black text-[#065f46] transition hover:border-[#047857] hover:bg-[#f7faf8]"
                  >
                    Discard draft
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
                parentContacts={savedParentContacts}
                readableSession={readableSession}
                savedPlayers={savedPlayers}
                selectedParentContactIndexes={selectedParentContactIndexes}
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
                onSelectFeedbackForm={(value) => applyPrivateDraftEdit(setSelectedFeedbackFormId, value)}
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
                canSubmitEvaluation={canSubmitEvaluation}
                contactNoun={contactNoun}
                hasSavedExportSelection={hasSavedExportSelection}
                includeAttendanceSummary={includeAttendanceSummary}
                inviteDate={inviteDate}
                isDemoAccount={isDemoAccount}
                isLoadingEmailTemplates={isLoadingEmailTemplates}
                isNoPlaceOfferedTemplate={isNoPlaceOfferedTemplate}
                isPdfAttachmentApproved={isPdfAttachmentApproved}
                isSaved={isSaved}
                isSendingParentEmail={isSendingParentEmail}
                isSubmitting={isSubmitting}
                lastSavedPlayerName={lastSavedPlayerName}
                onArchiveAfterNoPlaceChange={(value) => applyPrivateDraftEdit(setArchiveAfterNoPlace, value)}
                onClearExportFields={handleClearExportFields}
                emailSendMode={emailSendMode}
                onEmailTemplateChange={(value) => applyPrivateDraftEdit(setEmailTemplateKey, value)}
                onIncludeAttendanceSummaryChange={(value) => applyPrivateDraftEdit(setIncludeAttendanceSummary, value)}
                onEmailSendModeChange={(value) => applyPrivateDraftEdit(setEmailSendMode, value)}
                onGoToPlayer={() => navigate(`/player/${encodeURIComponent(lastSavedPlayerName)}`)}
                onInviteDateChange={(value) => applyPrivateDraftEdit(setInviteDate, value)}
                onPdfAttachmentApprovedChange={(value) => applyPrivateDraftEdit(setIsPdfAttachmentApproved, value)}
                onScheduledEmailDateTimeChange={(value) => applyPrivateDraftEdit(setScheduledEmailDateTime, value)}
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
