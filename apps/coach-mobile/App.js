import 'react-native-url-polyfill/auto'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { AuthProvider, useMobileAuth } from '../mobile-core/src/auth'
import { getBiometricAvailability, getBiometricEnabled, setBiometricEnabled } from '../mobile-core/src/biometrics'
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
import { getNativeNotificationDeviceState, initializeMobileNotifications, registerNativePushDevice, revokeNativePushDevice } from '../mobile-core/src/notifications'
import { getAccessToken } from '../mobile-core/src/supabase'
import { colors, screen } from '../mobile-core/src/theme'
import { LegalFooter, MatchCard, PlayerCard, PrimaryButton, ScoreStepper, SessionCard, StatCard, TextField } from '../mobile-core/src/ui'

const config = getMobileRuntimeConfig('coach')

function LoginScreen() {
  const { authError, signIn } = useMobileAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleLogin() {
    setIsSubmitting(true)

    try {
      await signIn(email, password)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.shell}>
          <Image source={require('./assets/football-player-logo.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.kicker}>Coach App</Text>
          <Text style={styles.title}>Log in to your club.</Text>
          <Text style={styles.copy}>Use the same staff login you use on the website.</Text>

          <View style={styles.card}>
            <TextField label="Email" onChangeText={setEmail} placeholder="coach@example.com" value={email} />
            <TextField label="Password" onChangeText={setPassword} placeholder="Password" secureTextEntry value={password} />
            {authError ? <Text style={styles.error}>{authError}</Text> : null}
            <PrimaryButton loading={isSubmitting} onPress={handleLogin}>Log in</PrimaryButton>
          </View>

          <Text style={styles.meta}>Restricted club access.</Text>
          <LegalFooter />
        </View>
      </ScrollView>
    </SafeAreaView>
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
  const [activeActionId, setActiveActionId] = useState('')
  const [isLoadingSummary, setIsLoadingSummary] = useState(true)
  const [biometricEnabled, setBiometricEnabledState] = useState(false)
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [isUpdatingBiometrics, setIsUpdatingBiometrics] = useState(false)
  const [isRegisteringPush, setIsRegisteringPush] = useState(false)
  const [notificationState, setNotificationState] = useState(null)
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

  useEffect(() => {
    void initializeMobileNotifications()
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadSummary() {
      if (!selectedMobileUser?.clubId) {
        setIsLoadingSummary(false)
        return
      }

      setIsLoadingSummary(true)
      setStatusMessage('')

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
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setStatusMessage(error.message || 'Coach summary could not be loaded.')
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
  }, [selectedMobileUser])

  useEffect(() => {
    if (selectedTeam?.id && selectedTeamId !== selectedTeam.id) {
      setSelectedTeamId(selectedTeam.id)
    }
  }, [selectedTeam?.id, selectedTeamId])

  useEffect(() => {
    let isMounted = true

    async function loadDeviceSettings() {
      try {
        const [availability, enabled, nextNotificationState] = await Promise.all([
          getBiometricAvailability(),
          getBiometricEnabled(),
          getNativeNotificationDeviceState(),
        ])

        if (isMounted) {
          setBiometricAvailable(availability.available)
          setBiometricEnabledState(enabled)
          setNotificationState(nextNotificationState)
        }
      } catch (error) {
        console.error(error)
      }
    }

    void loadDeviceSettings()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    const route = lastNotificationResponse?.notification?.request?.content?.data?.route

    if (route === 'matchday') {
      setActiveTab('matchday')
    }
  }, [lastNotificationResponse])

  async function enableNotifications() {
    setIsRegisteringPush(true)
    setStatusMessage('')

    try {
      const accessToken = await getAccessToken()
      await registerNativePushDevice({
        accessToken,
        apiBaseUrl: config.apiBaseUrl,
        appRole: 'coach',
        easProjectId: config.easProjectId,
        teamId: selectedMobileUser?.activeTeamId || '',
      })
      setNotificationState(await getNativeNotificationDeviceState())
      setStatusMessage('Coach notifications are enabled on this device.')
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || 'Notifications could not be enabled.')
    } finally {
      setIsRegisteringPush(false)
    }
  }

  async function disableNotifications() {
    setIsRegisteringPush(true)
    setStatusMessage('')

    try {
      const accessToken = await getAccessToken()
      await revokeNativePushDevice({
        accessToken,
        apiBaseUrl: config.apiBaseUrl,
      })
      setNotificationState(await getNativeNotificationDeviceState())
      setStatusMessage('Coach notifications are disabled on this device.')
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || 'Notifications could not be disabled.')
    } finally {
      setIsRegisteringPush(false)
    }
  }

  async function toggleBiometrics() {
    setIsUpdatingBiometrics(true)
    setStatusMessage('')

    try {
      const nextEnabled = await setBiometricEnabled(!biometricEnabled)
      setBiometricEnabledState(nextEnabled)
      setStatusMessage(nextEnabled ? 'Biometric unlock is enabled.' : 'Biometric unlock is disabled.')
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || 'Biometric setting could not be updated.')
    } finally {
      setIsUpdatingBiometrics(false)
    }
  }

  async function refreshCoachData() {
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
  }

  async function handleMatchStatus(match, status) {
    setActiveActionId(`status:${match.id}:${status}`)
    setStatusMessage('')

    try {
      await updateCoachMatchStatus(selectedMobileUser, match, status)
      await refreshCoachData()
      setStatusMessage(`Match changed to ${status.replace(/_/g, ' ')}.`)
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || 'Match status could not be updated.')
    } finally {
      setActiveActionId('')
    }
  }

  async function handleAddGoal(match, teamSide) {
    setActiveActionId(`goal:${match.id}:${teamSide}`)
    setStatusMessage('')

    try {
      await addCoachMatchGoal(selectedMobileUser, match, teamSide)
      await refreshCoachData()
      setStatusMessage(teamSide === 'club' ? 'Goal added for your team.' : 'Goal added for opponent.')
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || 'Goal could not be added.')
    } finally {
      setActiveActionId('')
    }
  }

  async function handleAddDetailedGoal(match, teamSide, goalDetails) {
    setActiveActionId(`goal-details:${match.id}:${teamSide}`)
    setStatusMessage('')

    try {
      await addCoachMatchGoal(selectedMobileUser, match, teamSide, goalDetails)
      await refreshCoachData()
      setStatusMessage(teamSide === 'club' ? 'Goal details saved for your team.' : 'Opponent goal details saved.')
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || 'Goal details could not be saved.')
    } finally {
      setActiveActionId('')
    }
  }

  async function handleUndoGoal(match) {
    setActiveActionId(`undo-goal:${match.id}`)
    setStatusMessage('')

    try {
      await undoCoachLastMatchGoal(selectedMobileUser, match)
      await refreshCoachData()
      setStatusMessage('Last goal undone and score corrected.')
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || 'Last goal could not be undone.')
    } finally {
      setActiveActionId('')
    }
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
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.shell}>
          <Image source={require('./assets/football-player-logo.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.kicker}>{user.clubName}</Text>
          <Text style={styles.title}>Hi {user.displayName || user.name}.</Text>
          <Text style={styles.copy}>
            {selectedMobileUser.activeTeamName ? `${selectedMobileUser.activeTeamName} is selected.` : 'All available teams are selected.'}
          </Text>

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
            ]}
          />

          {isLoadingSummary ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.item}>Loading workspace summary...</Text>
            </View>
          ) : (
            <View style={styles.statGrid}>
              <StatCard label="Players" value={summary?.activePlayers || 0} />
              <StatCard label="Sessions" value={summary?.sessions || 0} />
              <StatCard label="Teams" value={summary?.teams || 0} />
              <StatCard label="Matches" value={summary?.matches || 0} />
            </View>
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

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Notifications</Text>
            <Text style={styles.item}>
              {notificationState?.isRegistered
                ? 'Coach alerts are enabled on this device.'
                : notificationState?.message || 'Enable coach alerts for this device.'}
            </Text>
            <PrimaryButton loading={isRegisteringPush} onPress={enableNotifications}>
              {notificationState?.isRegistered ? 'Refresh notifications' : 'Enable notifications'}
            </PrimaryButton>
            {notificationState?.isRegistered ? (
              <PrimaryButton loading={isRegisteringPush} onPress={disableNotifications} variant="secondary">
                Disable notifications
              </PrimaryButton>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Biometric unlock</Text>
            <Text style={styles.item}>
              {biometricAvailable ? 'Use your device security when reopening the app.' : 'No enrolled biometric security is available on this device.'}
            </Text>
            <PrimaryButton
              disabled={!biometricAvailable}
              loading={isUpdatingBiometrics}
              onPress={toggleBiometrics}
              variant="secondary"
            >
              {biometricEnabled ? 'Disable biometric unlock' : 'Enable biometric unlock'}
            </PrimaryButton>
          </View>

          {statusMessage ? <Text style={styles.notice}>{statusMessage}</Text> : null}

          <PrimaryButton onPress={signOut} variant="secondary">Sign out</PrimaryButton>
          <Text style={styles.meta}>{config.isUsable ? 'Connection ready' : 'Connection needs setup'}</Text>
          <LegalFooter />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function TabRail({ activeTab, onChange, tabs }) {
  return (
    <View style={styles.tabRail}>
      {tabs.map((tab) => (
        <Pressable
          key={tab.key}
          onPress={() => onChange(tab.key)}
          style={[styles.tabButton, activeTab === tab.key ? styles.activeTabButton : null]}
        >
          <Text style={[styles.tabText, activeTab === tab.key ? styles.activeTabText : null]}>{tab.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function TeamSelector({ canUseAllTeams, onSelect, selectedTeamId, teams }) {
  return (
    <View style={styles.teamSelectorCard}>
      <Text style={styles.cardTitle}>Team view</Text>
      <View style={styles.teamSelector}>
        {canUseAllTeams ? (
          <Pressable
            onPress={() => onSelect('')}
            style={[styles.teamButton, !selectedTeamId ? styles.teamButtonActive : null]}
          >
            <Text style={[styles.teamButtonText, !selectedTeamId ? styles.teamButtonTextActive : null]}>All Teams</Text>
          </Pressable>
        ) : null}
        {teams.map((team) => {
          const isActive = team.id === selectedTeamId

          return (
            <Pressable
              key={team.id}
              onPress={() => onSelect(team.id)}
              style={[styles.teamButton, isActive ? styles.teamButtonActive : null]}
            >
              <Text style={[styles.teamButtonText, isActive ? styles.teamButtonTextActive : null]}>{team.name}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function MatchdayPanel({ activeActionId, matches, onAddDetailedGoal, onAddGoal, onStatusChange, onUndoGoal }) {
  return matches.length > 0 ? (
    <View style={styles.list}>
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
    </View>
  ) : (
    <View style={styles.card}>
      <Text style={styles.item}>No matchday fixtures are available yet.</Text>
    </View>
  )
}

function CoachMatchActions({ activeActionId, match, onAddDetailedGoal, onAddGoal, onStatusChange, onUndoGoal }) {
  const isFullTime = match.status === 'full_time'
  const canStart = ['scheduled', 'scorer_request'].includes(match.status)
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
    <View style={styles.actionCard}>
      <View style={styles.actionGrid}>
        {canStart ? (
          <PrimaryButton
            loading={activeActionId === `status:${match.id}:live`}
            onPress={() => onStatusChange(match, 'live')}
          >
            Start
          </PrimaryButton>
        ) : null}
        <PrimaryButton
          disabled={isFullTime}
          loading={activeActionId === `goal:${match.id}:club`}
          onPress={() => onAddGoal(match, 'club')}
        >
          Goal For
        </PrimaryButton>
        <PrimaryButton
          disabled={isFullTime}
          loading={activeActionId === `goal:${match.id}:opponent`}
          onPress={() => onAddGoal(match, 'opponent')}
          variant="secondary"
        >
          Goal Against
        </PrimaryButton>
      </View>
      <View style={styles.phaseGrid}>
        <PhaseButton activeActionId={activeActionId} label="Half Time" match={match} onStatusChange={onStatusChange} status="half_time" />
        <PhaseButton activeActionId={activeActionId} label="Second Half" match={match} onStatusChange={onStatusChange} status="second_half" />
        <PhaseButton activeActionId={activeActionId} label="Full Time" match={match} onStatusChange={onStatusChange} status="full_time" />
      </View>
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
        <Text style={styles.correctionHint}>
          Latest event: {latestEvent.eventType === 'goal' ? 'goal' : 'score correction'}
        </Text>
      ) : null}
      {isDetailsOpen ? (
        <View style={styles.goalDetailsPanel}>
          <View style={styles.segmentedControl}>
            {[
              { label: 'For', value: 'club' },
              { label: 'Against', value: 'opponent' },
            ].map((option) => (
              <Pressable
                key={option.value}
                onPress={() => updateGoalDetails('teamSide', option.value)}
                style={[styles.segmentButton, goalDetails.teamSide === option.value ? styles.segmentButtonActive : null]}
              >
                <Text style={[styles.segmentText, goalDetails.teamSide === option.value ? styles.segmentTextActive : null]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
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
            disabled={isFullTime}
            loading={activeActionId === `goal-details:${match.id}:${goalDetails.teamSide}`}
            onPress={submitDetailedGoal}
          >
            Save Goal
          </PrimaryButton>
        </View>
      ) : null}
    </View>
  )
}

function PhaseButton({ activeActionId, label, match, onStatusChange, status }) {
  return (
    <PrimaryButton
      disabled={match.status === status}
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
    <View style={styles.list}>
      {players.map((player) => <PlayerCard key={player.id} player={player} />)}
    </View>
  ) : (
    <View style={styles.card}>
      <Text style={styles.item}>No players are available yet.</Text>
    </View>
  )
}

function SessionsPanel({ sessions }) {
  return sessions.length > 0 ? (
    <View style={styles.list}>
      {sessions.map((session) => <SessionCard key={session.id} session={session} />)}
    </View>
  ) : (
    <View style={styles.card}>
      <Text style={styles.item}>No sessions are available yet.</Text>
    </View>
  )
}

function AssessPanel({ fields, onRefresh, onStatusMessage, players, user }) {
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [fieldValues, setFieldValues] = useState({})
  const [isSaving, setIsSaving] = useState(false)
  const selectedPlayer = players.find((player) => player.id === selectedPlayerId) || players[0]

  useEffect(() => {
    if (!selectedPlayerId && players[0]?.id) {
      setSelectedPlayerId(players[0].id)
    }
  }, [players, selectedPlayerId])

  useEffect(() => {
    setFieldValues((currentValues) => {
      const nextValues = { ...currentValues }

      fields.forEach((field) => {
        if (nextValues[field.id] === undefined) {
          nextValues[field.id] = isScoreField(field.type) ? 3 : ''
        }
      })

      return nextValues
    })
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
      setFieldValues((currentValues) => {
        const nextValues = {}
        fields.forEach((field) => {
          nextValues[field.id] = isScoreField(field.type) ? currentValues[field.id] || 3 : ''
        })
        return nextValues
      })
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
      <View style={styles.card}>
        <Text style={styles.item}>No players are available for assessment yet.</Text>
      </View>
    )
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Quick Assessment</Text>
      <Text style={styles.item}>{selectedPlayer?.playerName || 'Choose player'}</Text>
      <View style={styles.playerPicker}>
        {players.slice(0, 8).map((player) => (
          <Pressable
            key={player.id}
            onPress={() => setSelectedPlayerId(player.id)}
            style={[styles.pickerButton, selectedPlayer?.id === player.id ? styles.pickerButtonActive : null]}
          >
            <Text style={[styles.pickerText, selectedPlayer?.id === player.id ? styles.pickerTextActive : null]}>
              {player.playerName}
            </Text>
          </Pressable>
        ))}
      </View>
      {fields.map((field) => isScoreField(field.type) ? (
        <ScoreStepper
          key={field.id}
          label={field.label}
          max={field.type === 'score_1_10' ? 10 : 5}
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
    </View>
  )
}

function isScoreField(type) {
  return ['score_1_5', 'score_1_10', 'number'].includes(String(type || '').trim())
}

function LoadingScreen({ message }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.item}>{message}</Text>
      </View>
    </SafeAreaView>
  )
}

function AccessScreen({ message, onSignOut, title }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centered}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.copy}>{message}</Text>
        <PrimaryButton onPress={onSignOut} variant="secondary">Sign out</PrimaryButton>
      </View>
    </SafeAreaView>
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
    return <LockedScreen errorMessage={authError} onUnlock={unlockWithBiometrics} />
  }

  return <CoachHome />
}

function LockedScreen({ errorMessage, onUnlock }) {
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [message, setMessage] = useState(errorMessage || '')

  async function handleUnlock() {
    setIsUnlocking(true)
    setMessage('')

    try {
      await onUnlock()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Unlock failed.')
    } finally {
      setIsUnlocking(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centered}>
        <Image source={require('./assets/football-player-logo.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>Unlock app.</Text>
        <Text style={styles.copy}>Use your device security to continue.</Text>
        {message ? <Text style={styles.error}>{message}</Text> : null}
        <PrimaryButton loading={isUnlocking} onPress={handleUnlock}>Unlock</PrimaryButton>
      </View>
    </SafeAreaView>
  )
}

export default function App() {
  return (
    <AuthProvider appRole="coach">
      <AppContent />
    </AuthProvider>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 16,
    width: '100%',
  },
  actionCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  actionGrid: {
    gap: 10,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 18,
    justifyContent: 'center',
    padding: screen.padding,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  goalDetailsPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  error: {
    color: '#ffb4b4',
    fontSize: 14,
    fontWeight: '800',
  },
  copy: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  correctionHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  list: {
    gap: 12,
  },
  matchBlock: {
    gap: 10,
  },
  item: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  notice: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '800',
  },
  kicker: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  phaseGrid: {
    gap: 10,
  },
  pickerButton: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickerButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  pickerText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  pickerTextActive: {
    color: '#000000',
  },
  playerPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  segmentButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  segmentButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  segmentTextActive: {
    color: '#000000',
  },
  activeTabButton: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  activeTabText: {
    color: '#000000',
  },
  teamButton: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  teamButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  teamButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  teamButtonTextActive: {
    color: '#000000',
  },
  teamSelector: {
    gap: 8,
  },
  teamSelectorCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 14,
    width: '100%',
  },
  tabButton: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  tabRail: {
    flexDirection: 'row',
    gap: 8,
  },
  tabText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  logo: {
    height: 70,
    width: 70,
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    padding: screen.padding,
  },
  shell: {
    alignSelf: 'center',
    gap: 18,
    maxWidth: screen.maxWidth,
    width: '100%',
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 38,
  },
})
