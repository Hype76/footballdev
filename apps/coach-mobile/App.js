import 'react-native-url-polyfill/auto'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppState, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useMobileActionRunner } from '../mobile-core/src/actions'
import { createAssessmentFieldValues, getAssessmentFieldMax, isAssessmentScoreField, resetAssessmentFieldValues } from '../mobile-core/src/assessment'
import { AuthProvider, useMobileAuth } from '../mobile-core/src/auth'
import { getMobileRuntimeConfig } from '../mobile-core/src/config'
import {
  addCoachMatchGoal,
  getCoachAssessmentFields,
  getCoachHomeSummary,
  getCoachMatchDays,
  getCoachPlayers,
  getCoachSessions,
  submitCoachAssessment,
  undoCoachLastMatchGoal,
  updateCoachMatchStatus,
} from '../mobile-core/src/data'
import { useMobileDeviceControls } from '../mobile-core/src/deviceControls'
import { getTabForNotificationRoute } from '../mobile-core/src/routes'
import { colors } from '../mobile-core/src/theme'
import { AccessScreen, ChoiceGroup, EmptyState, HintText, LegalFooter, ListStack, LoadingRow, LoadingScreen, LockedScreen, MatchCard, MobileLoginScreen, MobileScreen, MobileSettingsPanel, OverviewPanel, Panel, PlayerCard, PrimaryButton, RecoveryPanel, ScoreStepper, ScreenHeader, SegmentedControl, SessionCard, StatusBanner, TabRail, TextField } from '../mobile-core/src/ui'

const config = getMobileRuntimeConfig('coach')

function LoginScreen() {
  const { authError, signIn } = useMobileAuth()

  return (
    <MobileLoginScreen
      authError={authError}
      copy="Use the same staff login you use on the website."
      emailPlaceholder="coach@example.com"
      kicker="Coach App"
      logoSource={require('./assets/football-player-logo.png')}
      meta="Restricted club access."
      signIn={signIn}
      title="Log in to your club."
    />
  )
}

function CoachHome() {
  const { authError, isProfileLoading, signOut, user } = useMobileAuth()
  const lastNotificationResponse = Notifications.useLastNotificationResponse()
  const [activeTab, setActiveTab] = useState('matchday')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [players, setPlayers] = useState([])
  const [sessions, setSessions] = useState([])
  const [assessmentFields, setAssessmentFields] = useState([])
  const [summary, setSummary] = useState(null)
  const [matches, setMatches] = useState([])
  const [statusMessage, setStatusMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const [activeActionId, setActiveActionId] = useState('')
  const [isLoadingSummary, setIsLoadingSummary] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState('')
  const [showOverview, setShowOverview] = useState(false)
  const runAction = useMobileActionRunner({ setActiveActionId, setStatusMessage })
  const teamOptions = useMemo(
    () => (Array.isArray(user?.teamOptions) ? user.teamOptions : []),
    [user?.teamOptions],
  )
  const canUseAllTeams = Number(user?.roleRank || 0) >= 50
  const selectedTeam = teamOptions.find((team) => team.id === selectedTeamId)
    || teamOptions.find((team) => team.id === user?.activeTeamId)
    || (!canUseAllTeams ? teamOptions[0] : null)
    || null
  const selectedMobileUser = useMemo(
    () => user
      ? {
          ...user,
          activeTeamId: selectedTeam?.id || '',
          activeTeamName: selectedTeam?.name || '',
        }
      : user,
    [selectedTeam?.id, selectedTeam?.name, user],
  )
  const {
    biometricAvailable,
    biometricEnabled,
    disableNotifications,
    enableNotifications,
    isRegisteringPush,
    isUpdatingBiometrics,
    notificationState,
    toggleBiometrics,
  } = useMobileDeviceControls({
    apiBaseUrl: config.apiBaseUrl,
    appRole: 'coach',
    easProjectId: config.easProjectId,
    notificationDisabledMessage: 'Coach notifications are disabled on this device.',
    notificationEnabledMessage: 'Coach notifications are enabled on this device.',
    onStatusMessage: setStatusMessage,
    teamId: selectedMobileUser?.activeTeamId || '',
  })

  const refreshCoachData = useCallback(async () => {
    const [nextSummary, nextMatches, nextPlayers, nextSessions, nextFields] = await Promise.all([
      getCoachHomeSummary(selectedMobileUser),
      getCoachMatchDays(selectedMobileUser),
      getCoachPlayers(selectedMobileUser),
      getCoachSessions(selectedMobileUser),
      getCoachAssessmentFields(selectedMobileUser),
    ])

    setSummary(nextSummary)
    setMatches(nextMatches)
    setPlayers(nextPlayers)
    setSessions(nextSessions)
    setAssessmentFields(nextFields)
    setLastUpdatedAt(new Date().toISOString())
    setLoadError('')
  }, [selectedMobileUser])

  useEffect(() => {
    let isMounted = true

    async function loadSummary() {
      if (!selectedMobileUser?.clubId) {
        setIsLoadingSummary(false)
        return
      }

      setIsLoadingSummary(true)
      setStatusMessage('')
      setLoadError('')
      setSummary(null)
      setMatches([])
      setPlayers([])
      setSessions([])
      setAssessmentFields([])

      try {
        const [nextSummary, nextMatches, nextPlayers, nextSessions, nextFields] = await Promise.all([
          getCoachHomeSummary(selectedMobileUser),
          getCoachMatchDays(selectedMobileUser),
          getCoachPlayers(selectedMobileUser),
          getCoachSessions(selectedMobileUser),
          getCoachAssessmentFields(selectedMobileUser),
        ])

        if (isMounted) {
          setSummary(nextSummary)
          setMatches(nextMatches)
          setPlayers(nextPlayers)
          setSessions(nextSessions)
          setAssessmentFields(nextFields)
          setLastUpdatedAt(new Date().toISOString())
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          const message = error.message || 'Coach summary could not be loaded.'
          setStatusMessage(message)
          setLoadError(message)
        }
      } finally {
        if (isMounted) {
          setIsLoadingSummary(false)
        }
      }
    }

    void loadSummary()

    return () => {
      isMounted = false
    }
  }, [refreshCoachData, selectedMobileUser])

  useEffect(() => {
    if (selectedTeam?.id && selectedTeamId !== selectedTeam.id) {
      setSelectedTeamId(selectedTeam.id)
    }
  }, [selectedTeam?.id, selectedTeamId])

  useEffect(() => {
    const route = lastNotificationResponse?.notification?.request?.content?.data?.route
    const targetTab = getTabForNotificationRoute('coach', route)

    if (targetTab) {
      setActiveTab(targetTab)
    }
  }, [lastNotificationResponse])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && selectedMobileUser?.clubId) {
        void refreshCoachData().catch((error) => {
          console.error(error)
        })
      }
    })

    return () => {
      subscription.remove()
    }
  }, [refreshCoachData, selectedMobileUser?.clubId])

  async function handleRefresh() {
    if (!selectedMobileUser?.clubId) {
      return
    }

    setIsRefreshing(true)
    setStatusMessage('')
    setLoadError('')

    try {
      await refreshCoachData()
      setStatusMessage('Latest coach updates loaded.')
    } catch (error) {
      console.error(error)
      const message = error.message || 'Latest coach updates could not be loaded.'
      setStatusMessage(message)
      setLoadError(message)
    } finally {
      setIsRefreshing(false)
    }
  }

  async function handleMatchStatus(match, status) {
    await runAction(`status:${match.id}:${status}`, async () => {
      await updateCoachMatchStatus(selectedMobileUser, match, status)
      await refreshCoachData()
    }, {
      errorMessage: 'Match status could not be updated.',
      successMessage: `Match changed to ${status.replace(/_/g, ' ')}.`,
    })
  }

  async function handleAddGoal(match, teamSide) {
    await runAction(`goal:${match.id}:${teamSide}`, async () => {
      await addCoachMatchGoal(selectedMobileUser, match, teamSide)
      await refreshCoachData()
    }, {
      errorMessage: 'Goal could not be added.',
      successMessage: teamSide === 'club' ? 'Goal added for your team.' : 'Goal added for opponent.',
    })
  }

  async function handleAddDetailedGoal(match, teamSide, goalDetails) {
    await runAction(`goal-details:${match.id}:${teamSide}`, async () => {
      await addCoachMatchGoal(selectedMobileUser, match, teamSide, goalDetails)
      await refreshCoachData()
    }, {
      errorMessage: 'Goal details could not be saved.',
      successMessage: teamSide === 'club' ? 'Goal details saved for your team.' : 'Opponent goal details saved.',
    })
  }

  async function handleUndoGoal(match) {
    await runAction(`undo-goal:${match.id}`, async () => {
      await undoCoachLastMatchGoal(selectedMobileUser, match)
      await refreshCoachData()
    }, {
      errorMessage: 'Last goal could not be undone.',
      successMessage: 'Last goal undone and score corrected.',
    })
  }

  if (isProfileLoading) {
    return <LoadingScreen message="Loading club access..." />
  }

  if (!user) {
    return (
      <AccessScreen
        message={authError || 'This login could not open the coach app.'}
        onSignOut={signOut}
        title="Coach access unavailable"
      />
    )
  }

  if (user.accountStatus === 'suspended' || user.clubStatus === 'suspended' || !user.hasActivePlanAccess) {
    return (
      <AccessScreen
        message="This account does not currently have coach app access."
        onSignOut={signOut}
        title="Access unavailable"
      />
    )
  }

  return (
    <MobileScreen
      refreshControl={(
        <RefreshControl
          colors={[colors.accent]}
          onRefresh={handleRefresh}
          refreshing={isRefreshing}
          tintColor={colors.accent}
        />
      )}
    >
      <StatusBar style="light" />
      <ScreenHeader
        copy={selectedMobileUser.activeTeamName ? `${selectedMobileUser.activeTeamName} is selected.` : 'All available teams are selected.'}
        kicker={user.clubName}
        logoSource={require('./assets/football-player-logo.png')}
        title={`Hi ${user.displayName || user.name}.`}
      />

          {teamOptions.length > 1 ? (
            <TeamSelector
              canUseAllTeams={canUseAllTeams}
              onSelect={setSelectedTeamId}
              selectedTeamId={selectedMobileUser.activeTeamId || ''}
              teams={teamOptions}
            />
          ) : null}

          <TabRail
            activeTab={activeTab}
            onChange={setActiveTab}
            tabs={[
              { key: 'matchday', label: 'Matchday' },
              { key: 'players', label: 'Players' },
              { key: 'assess', label: 'Assess' },
              { key: 'sessions', label: 'Sessions' },
              { key: 'settings', label: 'Settings' },
            ]}
          />

          <StatusBanner message={statusMessage} onDismiss={() => setStatusMessage('')} />

          {loadError ? (
            <RecoveryPanel
              isRetrying={isRefreshing}
              message={loadError}
              onRetry={handleRefresh}
              title="Could not load coach data"
            />
          ) : null}

          {isLoadingSummary ? (
            <LoadingRow message="Loading workspace summary..." />
          ) : (
            <OverviewPanel
              isOpen={showOverview}
              onToggle={() => setShowOverview((currentValue) => !currentValue)}
              stats={[
                { label: 'Players', value: summary?.activePlayers || 0 },
                { label: 'Sessions', value: summary?.sessions || 0 },
                { label: 'Teams', value: summary?.teams || 0 },
                { label: 'Matches', value: summary?.matches || 0 },
              ]}
              summary={`${summary?.activePlayers || 0} players | ${summary?.matches || 0} matches`}
            />
          )}

          {activeTab === 'matchday' ? (
            <MatchdayPanel
              activeActionId={activeActionId}
              matches={matches}
              onAddGoal={handleAddGoal}
              onAddDetailedGoal={handleAddDetailedGoal}
              onStatusChange={handleMatchStatus}
              onUndoGoal={handleUndoGoal}
            />
          ) : null}
          {activeTab === 'players' ? <PlayersPanel players={players} /> : null}
          {activeTab === 'assess' ? (
            <AssessPanel
              onRefresh={refreshCoachData}
              onStatusMessage={setStatusMessage}
              fields={assessmentFields}
              players={players}
              user={selectedMobileUser}
            />
          ) : null}
          {activeTab === 'sessions' ? <SessionsPanel sessions={sessions} /> : null}
          {activeTab === 'settings' ? (
            <MobileSettingsPanel
              biometricAvailable={biometricAvailable}
              biometricEnabled={biometricEnabled}
              config={config}
              isRegisteringPush={isRegisteringPush}
              isUpdatingBiometrics={isUpdatingBiometrics}
              lastUpdatedAt={lastUpdatedAt}
              notificationCopy={notificationState?.isRegistered
                ? 'Coach alerts are enabled on this device.'
                : notificationState?.message || 'Enable coach alerts for this device.'}
              notificationEnabled={Boolean(notificationState?.isRegistered)}
              notificationNeedsRefresh={Boolean(notificationState?.requiresContextRefresh)}
              onDisableNotifications={disableNotifications}
              onEnableNotifications={enableNotifications}
              onSignOut={signOut}
              onToggleBiometrics={toggleBiometrics}
            />
          ) : null}
          <LegalFooter />
    </MobileScreen>
  )
}

function TeamSelector({ canUseAllTeams, onSelect, selectedTeamId, teams }) {
  const options = [
    ...(canUseAllTeams ? [{ label: 'All Teams', value: '' }] : []),
    ...teams.map((team) => ({ label: team.name, value: team.id })),
  ]

  return <ChoiceGroup onChange={onSelect} options={options} selectedValue={selectedTeamId} title="Team view" />
}

function MatchdayPanel({ activeActionId, matches, onAddDetailedGoal, onAddGoal, onStatusChange, onUndoGoal }) {
  return matches.length > 0 ? (
    <ListStack>
      {matches.map((match) => (
        <View key={match.id} style={styles.matchBlock}>
          <MatchCard match={match} />
          <CoachMatchActions
            activeActionId={activeActionId}
            match={match}
            onAddDetailedGoal={onAddDetailedGoal}
            onAddGoal={onAddGoal}
            onStatusChange={onStatusChange}
            onUndoGoal={onUndoGoal}
          />
        </View>
      ))}
    </ListStack>
  ) : (
    <EmptyState message="No matchday fixtures are available yet." />
  )
}

function CoachMatchActions({ activeActionId, match, onAddDetailedGoal, onAddGoal, onStatusChange, onUndoGoal }) {
  const isFullTime = match.status === 'full_time'
  const canStart = ['scheduled', 'scorer_request'].includes(match.status)
  const canRecordGoal = ['live', 'second_half', 'extra_time', 'penalties'].includes(match.status)
  const latestEvent = Array.isArray(match.events) ? match.events[0] : null
  const canUndoLastGoal = latestEvent?.eventType === 'goal'
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [goalDetails, setGoalDetails] = useState({
    assistName: '',
    assistShirtNumber: '',
    minute: '',
    notes: '',
    scorerName: '',
    scorerShirtNumber: '',
    teamSide: 'club',
  })

  function updateGoalDetails(key, value) {
    setGoalDetails((currentDetails) => ({
      ...currentDetails,
      [key]: value,
    }))
  }

  async function submitDetailedGoal() {
    await onAddDetailedGoal(match, goalDetails.teamSide, goalDetails)
    setGoalDetails({
      assistName: '',
      assistShirtNumber: '',
      minute: '',
      notes: '',
      scorerName: '',
      scorerShirtNumber: '',
      teamSide: 'club',
    })
    setIsDetailsOpen(false)
  }

  return (
    <Panel variant="card">
      <ListStack>
        {canStart ? (
          <PrimaryButton
            loading={activeActionId === `status:${match.id}:live`}
            onPress={() => onStatusChange(match, 'live')}
          >
            Start
          </PrimaryButton>
        ) : null}
        <PrimaryButton
          disabled={!canRecordGoal || isFullTime}
          loading={activeActionId === `goal:${match.id}:club`}
          onPress={() => onAddGoal(match, 'club')}
        >
          Goal For
        </PrimaryButton>
        <PrimaryButton
          disabled={!canRecordGoal || isFullTime}
          loading={activeActionId === `goal:${match.id}:opponent`}
          onPress={() => onAddGoal(match, 'opponent')}
          variant="secondary"
        >
          Goal Against
        </PrimaryButton>
      </ListStack>
      {!canRecordGoal && !isFullTime ? <HintText>Start the match before adding goals.</HintText> : null}
      <ListStack>
        <PhaseButton
          activeActionId={activeActionId}
          disabled={!['live', 'second_half'].includes(match.status)}
          label="Half Time"
          match={match}
          onStatusChange={onStatusChange}
          status="half_time"
        />
        <PhaseButton
          activeActionId={activeActionId}
          disabled={!['half_time', 'live'].includes(match.status)}
          label="Second Half"
          match={match}
          onStatusChange={onStatusChange}
          status="second_half"
        />
        <PhaseButton
          activeActionId={activeActionId}
          disabled={!['live', 'half_time', 'second_half', 'extra_time', 'penalties'].includes(match.status)}
          label="Full Time"
          match={match}
          onStatusChange={onStatusChange}
          status="full_time"
        />
      </ListStack>
      <PrimaryButton
        disabled={!canUndoLastGoal}
        loading={activeActionId === `undo-goal:${match.id}`}
        onPress={() => onUndoGoal(match)}
        variant="secondary"
      >
        Undo Last Goal
      </PrimaryButton>
      <PrimaryButton onPress={() => setIsDetailsOpen((currentValue) => !currentValue)} variant="secondary">
        {isDetailsOpen ? 'Hide Goal Details' : 'Add Goal Details'}
      </PrimaryButton>
      {latestEvent ? (
        <HintText>
          Latest event: {latestEvent.eventType === 'goal' ? 'goal' : 'score correction'}
        </HintText>
      ) : null}
      {isDetailsOpen ? (
        <Panel>
          <SegmentedControl
            onChange={(value) => updateGoalDetails('teamSide', value)}
            options={[
              { label: 'For', value: 'club' },
              { label: 'Against', value: 'opponent' },
            ]}
            selectedValue={goalDetails.teamSide}
          />
          <TextField
            autoCapitalize="words"
            label="Scorer"
            onChangeText={(value) => updateGoalDetails('scorerName', value)}
            placeholder="Player name"
            value={goalDetails.scorerName}
          />
          <TextField
            keyboardType="number-pad"
            label="Scorer Number"
            onChangeText={(value) => updateGoalDetails('scorerShirtNumber', value)}
            placeholder="Optional"
            value={goalDetails.scorerShirtNumber}
          />
          <TextField
            autoCapitalize="words"
            label="Assist"
            onChangeText={(value) => updateGoalDetails('assistName', value)}
            placeholder="Optional"
            value={goalDetails.assistName}
          />
          <TextField
            keyboardType="number-pad"
            label="Assist Number"
            onChangeText={(value) => updateGoalDetails('assistShirtNumber', value)}
            placeholder="Optional"
            value={goalDetails.assistShirtNumber}
          />
          <TextField
            keyboardType="number-pad"
            label="Minute"
            onChangeText={(value) => updateGoalDetails('minute', value)}
            placeholder="Auto if left blank"
            value={goalDetails.minute}
          />
          <TextField
            autoCapitalize="sentences"
            label="Note"
            multiline
            onChangeText={(value) => updateGoalDetails('notes', value)}
            placeholder="Optional"
            value={goalDetails.notes}
          />
          <PrimaryButton
            disabled={!canRecordGoal || isFullTime}
            loading={activeActionId === `goal-details:${match.id}:${goalDetails.teamSide}`}
            onPress={submitDetailedGoal}
          >
            Save Goal
          </PrimaryButton>
        </Panel>
      ) : null}
    </Panel>
  )
}

function PhaseButton({ activeActionId, disabled = false, label, match, onStatusChange, status }) {
  return (
    <PrimaryButton
      disabled={disabled || match.status === status}
      loading={activeActionId === `status:${match.id}:${status}`}
      onPress={() => onStatusChange(match, status)}
      variant="secondary"
    >
      {label}
    </PrimaryButton>
  )
}

function PlayersPanel({ players }) {
  return players.length > 0 ? (
    <ListStack>
      {players.map((player) => <PlayerCard key={player.id} player={player} />)}
    </ListStack>
  ) : (
    <EmptyState message="No players are available yet." />
  )
}

function SessionsPanel({ sessions }) {
  return sessions.length > 0 ? (
    <ListStack>
      {sessions.map((session) => <SessionCard key={session.id} session={session} />)}
    </ListStack>
  ) : (
    <EmptyState message="No sessions are available yet." />
  )
}

function AssessPanel({ fields, onRefresh, onStatusMessage, players, user }) {
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [fieldValues, setFieldValues] = useState({})
  const [showAllPlayers, setShowAllPlayers] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const selectedPlayer = players.find((player) => player.id === selectedPlayerId) || players[0]
  const visiblePlayers = showAllPlayers ? players : players.slice(0, 8)

  useEffect(() => {
    if (!selectedPlayerId && players[0]?.id) {
      setSelectedPlayerId(players[0].id)
    }
  }, [players, selectedPlayerId])

  useEffect(() => {
    setFieldValues((currentValues) => createAssessmentFieldValues(fields, currentValues))
  }, [fields])

  async function handleSave() {
    if (!selectedPlayer) {
      onStatusMessage('Choose a player before saving an assessment.')
      return
    }

    setIsSaving(true)
    onStatusMessage('')

    try {
      await submitCoachAssessment(user, selectedPlayer, { fieldValues }, fields)
      setFieldValues((currentValues) => resetAssessmentFieldValues(fields, currentValues))
      await onRefresh()
      onStatusMessage(`Assessment saved for ${selectedPlayer.playerName}.`)
    } catch (error) {
      console.error(error)
      onStatusMessage(error.message || 'Assessment could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  if (players.length === 0) {
    return (
      <EmptyState message="No players are available for assessment yet." />
    )
  }

  return (
    <Panel>
      <Text style={styles.cardTitle}>Quick Assessment</Text>
      <Text style={styles.item}>{selectedPlayer?.playerName || 'Choose player'}</Text>
      <ChoiceGroup
        onChange={setSelectedPlayerId}
        options={visiblePlayers.map((player) => ({ label: player.playerName, value: player.id }))}
        selectedValue={selectedPlayer?.id || ''}
      />
      {players.length > 8 ? (
        <PrimaryButton onPress={() => setShowAllPlayers((currentValue) => !currentValue)} variant="secondary">
          {showAllPlayers ? 'Show fewer players' : `Show all ${players.length} players`}
        </PrimaryButton>
      ) : null}
      {fields.map((field) => isAssessmentScoreField(field.type) ? (
        <ScoreStepper
          key={field.id}
          label={field.label}
          max={getAssessmentFieldMax(field)}
          onChange={(value) => setFieldValues((currentValues) => ({ ...currentValues, [field.id]: value }))}
          value={fieldValues[field.id] ?? 0}
        />
      ) : (
        <TextField
          autoCapitalize="sentences"
          key={field.id}
          label={field.label}
          onChangeText={(value) => setFieldValues((currentValues) => ({ ...currentValues, [field.id]: value }))}
          placeholder={field.required ? 'Required' : 'Optional'}
          value={String(fieldValues[field.id] ?? '')}
        />
      ))}
      <PrimaryButton loading={isSaving} onPress={handleSave}>Save Assessment</PrimaryButton>
    </Panel>
  )
}

function AppContent() {
  const { authError, isLoading, isLocked, session, unlockWithBiometrics } = useMobileAuth()

  if (isLoading) {
    return <LoadingScreen message="Loading Football Player Coach..." />
  }

  if (!session?.user) {
    return <LoginScreen />
  }

  if (isLocked) {
    return <LockedScreen errorMessage={authError} logoSource={require('./assets/football-player-logo.png')} onUnlock={unlockWithBiometrics} />
  }

  return <CoachHome />
}

export default function App() {
  return (
    <AuthProvider appRole="coach">
      <AppContent />
    </AuthProvider>
  )
}

const styles = StyleSheet.create({
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  matchBlock: {
    gap: 10,
  },
  item: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
})
