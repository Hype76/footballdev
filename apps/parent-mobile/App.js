import 'react-native-url-polyfill/auto'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, AppState, Image, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { AuthProvider, useMobileAuth } from '../mobile-core/src/auth'
import { getBiometricAvailability, getBiometricEnabled, setBiometricEnabled } from '../mobile-core/src/biometrics'
import { getMobileRuntimeConfig } from '../mobile-core/src/config'
import {
  getParentHomeSummary,
  getParentMatchDays,
  getParentMessages,
  getParentPolls,
  markParentMessageRead,
  submitParentPollVote,
  volunteerAsMatchScorer,
} from '../mobile-core/src/data'
import { getNativeNotificationDeviceState, initializeMobileNotifications, registerNativePushDevice, revokeNativePushDevice } from '../mobile-core/src/notifications'
import { getAccessToken } from '../mobile-core/src/supabase'
import { colors, screen } from '../mobile-core/src/theme'
import { LegalFooter, MatchCard, MessageCard, PollCard, PrimaryButton, StatCard, StatusBanner, TextField } from '../mobile-core/src/ui'

const config = getMobileRuntimeConfig('parent')

function LoginScreen() {
  const { authError, signIn } = useMobileAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const canSubmit = Boolean(email.trim() && password)

  async function handleLogin() {
    if (!canSubmit || isSubmitting) {
      return
    }

    setIsSubmitting(true)

    try {
      await signIn(email.trim(), password)
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
          <Text style={styles.kicker}>Parent App</Text>
          <Text style={styles.title}>Log in for child updates.</Text>
          <Text style={styles.copy}>Use the parent login linked by your club.</Text>

          <View style={styles.card}>
            <TextField
              autoComplete="email"
              keyboardType="email-address"
              label="Email"
              onChangeText={setEmail}
              placeholder="parent@example.com"
              returnKeyType="next"
              textContentType="username"
              value={email}
            />
            <TextField
              autoComplete="current-password"
              label="Password"
              onChangeText={setPassword}
              onSubmitEditing={handleLogin}
              placeholder="Password"
              returnKeyType="done"
              secureTextEntry
              textContentType="password"
              value={password}
            />
            {authError ? <Text style={styles.error}>{authError}</Text> : null}
            <PrimaryButton disabled={!canSubmit} loading={isSubmitting} onPress={handleLogin}>Log in</PrimaryButton>
          </View>

          <Text style={styles.meta}>Restricted parent access.</Text>
          <LegalFooter />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ParentHome() {
  const { authError, isProfileLoading, signOut, user } = useMobileAuth()
  const lastNotificationResponse = Notifications.useLastNotificationResponse()
  const [activeTab, setActiveTab] = useState('matchday')
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [messages, setMessages] = useState([])
  const [polls, setPolls] = useState([])
  const [summary, setSummary] = useState(null)
  const [matches, setMatches] = useState([])
  const [statusMessage, setStatusMessage] = useState('')
  const [activeActionId, setActiveActionId] = useState('')
  const [isLoadingSummary, setIsLoadingSummary] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState('')
  const [showOverview, setShowOverview] = useState(false)
  const [biometricEnabled, setBiometricEnabledState] = useState(false)
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [isUpdatingBiometrics, setIsUpdatingBiometrics] = useState(false)
  const [isRegisteringPush, setIsRegisteringPush] = useState(false)
  const [notificationState, setNotificationState] = useState(null)
  const parentLinks = useMemo(
    () => (Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []),
    [user?.parentPortalLinks],
  )
  const selectedLink = parentLinks.find((link) => link.id === selectedLinkId)
    || parentLinks.find((link) => link.id === user?.selectedParentLinkId)
    || parentLinks[0]
    || null
  const selectedMobileUser = useMemo(
    () => (user ? { ...user, selectedParentLinkId: selectedLink?.id || '' } : user),
    [selectedLink?.id, user],
  )
  const unreadMessageCount = messages.filter((message) => !message.readAt).length
  const unansweredPollCount = polls.filter((poll) => {
    const selectedOptionIds = Array.isArray(poll.currentOptionIds) ? poll.currentOptionIds : []
    return poll.status === 'open' && !poll.currentOptionId && selectedOptionIds.length === 0
  }).length

  const refreshParentData = useCallback(async () => {
    const [nextSummary, nextMatches, nextMessages, nextPolls] = await Promise.all([
      getParentHomeSummary(selectedMobileUser),
      getParentMatchDays(selectedMobileUser),
      getParentMessages(selectedMobileUser),
      getParentPolls(selectedMobileUser),
    ])

    setSummary(nextSummary)
    setMatches(nextMatches)
    setMessages(nextMessages)
    setPolls(nextPolls)
    setLastUpdatedAt(new Date().toISOString())
  }, [selectedMobileUser])

  useEffect(() => {
    void initializeMobileNotifications()
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadSummary() {
      if (!selectedMobileUser?.id) {
        setIsLoadingSummary(false)
        return
      }

      setIsLoadingSummary(true)
      setStatusMessage('')

      try {
        const [nextSummary, nextMatches, nextMessages, nextPolls] = await Promise.all([
          getParentHomeSummary(selectedMobileUser),
          getParentMatchDays(selectedMobileUser),
          getParentMessages(selectedMobileUser),
          getParentPolls(selectedMobileUser),
        ])

        if (isMounted) {
          setSummary(nextSummary)
          setMatches(nextMatches)
          setMessages(nextMessages)
          setPolls(nextPolls)
          setLastUpdatedAt(new Date().toISOString())
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setStatusMessage(error.message || 'Parent summary could not be loaded.')
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
  }, [refreshParentData, selectedMobileUser])

  useEffect(() => {
    if (selectedLink?.id && selectedLinkId !== selectedLink.id) {
      setSelectedLinkId(selectedLink.id)
    }
  }, [selectedLink?.id, selectedLinkId])

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

    if (route === 'messages') {
      setActiveTab('messages')
      return
    }

    if (route === 'polls') {
      setActiveTab('polls')
      return
    }

    if (route === 'parent-portal' || route === 'matchday') {
      setActiveTab('matchday')
    }
  }, [lastNotificationResponse])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && selectedMobileUser?.id) {
        void refreshParentData().catch((error) => {
          console.error(error)
        })
      }
    })

    return () => {
      subscription.remove()
    }
  }, [refreshParentData, selectedMobileUser?.id])

  async function enableNotifications() {
    setIsRegisteringPush(true)
    setStatusMessage('')

    try {
      const accessToken = await getAccessToken()
      await registerNativePushDevice({
        accessToken,
        apiBaseUrl: config.apiBaseUrl,
        appRole: 'parent',
        easProjectId: config.easProjectId,
        parentLinkId: selectedLink?.id || '',
      })
      setNotificationState(await getNativeNotificationDeviceState())
      setStatusMessage('Parent notifications are enabled on this device.')
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
      setStatusMessage('Parent notifications are disabled on this device.')
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

  async function handleManualRefresh() {
    setActiveActionId('refresh:parent')
    setStatusMessage('')

    try {
      await refreshParentData()
      setStatusMessage('Latest updates loaded.')
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || 'Latest updates could not be loaded.')
    } finally {
      setActiveActionId('')
    }
  }

  async function handleRefresh() {
    if (!selectedMobileUser?.id) {
      return
    }

    setIsRefreshing(true)
    setStatusMessage('')

    try {
      await refreshParentData()
      setStatusMessage('Latest updates loaded.')
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || 'Latest updates could not be loaded.')
    } finally {
      setIsRefreshing(false)
    }
  }

  async function handleVolunteerScorer(match) {
    setActiveActionId(`scorer:${match.id}`)
    setStatusMessage('')

    try {
      await volunteerAsMatchScorer(selectedMobileUser, match.id)
      await refreshParentData()
      setStatusMessage('Your scorer interest has been sent.')
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || 'Scorer interest could not be sent.')
    } finally {
      setActiveActionId('')
    }
  }

  async function handleMarkMessageRead(message) {
    setActiveActionId(`message:${message.id}`)
    setStatusMessage('')

    try {
      await markParentMessageRead(selectedMobileUser, message.id)
      await refreshParentData()
      setStatusMessage('Message marked as read.')
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || 'Message could not be marked as read.')
    } finally {
      setActiveActionId('')
    }
  }

  async function handlePollVote(poll, option) {
    setActiveActionId(`poll:${poll.id}:${option.id}`)
    setStatusMessage('')

    try {
      await submitParentPollVote(selectedMobileUser, poll.id, option.id)
      await refreshParentData()
      setStatusMessage('Your poll answer has been saved.')
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || 'Poll answer could not be saved.')
    } finally {
      setActiveActionId('')
    }
  }

  if (isProfileLoading) {
    return <LoadingScreen message="Loading parent access..." />
  }

  if (!user) {
    return (
      <AccessScreen
        message={authError || 'This login could not open the parent app.'}
        onSignOut={signOut}
        title="Parent access unavailable"
      />
    )
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={(
          <RefreshControl
            colors={[colors.accent]}
            onRefresh={handleRefresh}
            refreshing={isRefreshing}
            tintColor={colors.accent}
          />
        )}
      >
        <View style={styles.shell}>
          <Image source={require('./assets/football-player-logo.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.kicker}>{selectedLink?.clubName || user.clubName}</Text>
          <Text style={styles.title}>{selectedLink?.playerName || 'Child'} updates.</Text>
          <Text style={styles.copy}>Live match alerts, messages, and polls will appear here.</Text>

          <TabRail
            activeTab={activeTab}
            onChange={setActiveTab}
            tabs={[
              { key: 'matchday', label: 'Matchday' },
              { key: 'messages', label: 'Messages', count: unreadMessageCount },
              { key: 'polls', label: 'Polls', count: unansweredPollCount },
              { key: 'settings', label: 'Settings' },
            ]}
          />

          <StatusBanner message={statusMessage} onDismiss={() => setStatusMessage('')} />

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Linked child</Text>
            <Text style={styles.item}>{selectedLink?.playerName || 'No child selected'}</Text>
            <Text style={styles.item}>{selectedLink?.teamName || 'Team not set'}</Text>
            {parentLinks.length > 1 ? (
              <ChildSelector
                links={parentLinks}
                onSelect={setSelectedLinkId}
                selectedLinkId={selectedLink?.id || ''}
              />
            ) : null}
          </View>

          {isLoadingSummary ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.item}>Loading parent summary...</Text>
            </View>
          ) : (
            <OverviewPanel
              isOpen={showOverview}
              onToggle={() => setShowOverview((currentValue) => !currentValue)}
              stats={[
                { label: 'Children', value: summary?.linkedChildren || 0 },
                { label: 'Matches', value: summary?.upcomingMatches || 0 },
                { label: 'Unread', value: unreadMessageCount },
                { label: 'To answer', value: unansweredPollCount },
              ]}
              summary={`${unreadMessageCount} unread | ${unansweredPollCount} to answer`}
            />
          )}

          {activeTab === 'matchday' ? (
            <MatchdayPanel
              activeActionId={activeActionId}
              matches={matches}
              onRefresh={handleManualRefresh}
              onVolunteerScorer={handleVolunteerScorer}
            />
          ) : null}
          {activeTab === 'messages' ? (
            <MessagesPanel activeActionId={activeActionId} messages={messages} onMarkRead={handleMarkMessageRead} />
          ) : null}
          {activeTab === 'polls' ? (
            <PollsPanel activeActionId={activeActionId} onVote={handlePollVote} polls={polls} />
          ) : null}
          {activeTab === 'settings' ? (
            <SettingsPanel
              biometricAvailable={biometricAvailable}
              biometricEnabled={biometricEnabled}
              config={config}
              isRegisteringPush={isRegisteringPush}
              isUpdatingBiometrics={isUpdatingBiometrics}
              lastUpdatedAt={lastUpdatedAt}
              notificationCopy={notificationState?.isRegistered
                ? 'Alerts are enabled on this device for the selected child.'
                : notificationState?.message || 'Enable alerts for matchday goals, full time, messages, and polls.'}
              notificationEnabled={Boolean(notificationState?.isRegistered)}
              onDisableNotifications={disableNotifications}
              onEnableNotifications={enableNotifications}
              onSignOut={signOut}
              onToggleBiometrics={toggleBiometrics}
            />
          ) : null}
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
          <View style={styles.tabContent}>
            <Text style={[styles.tabText, activeTab === tab.key ? styles.activeTabText : null]}>{tab.label}</Text>
            {tab.count > 0 ? (
              <Text style={[styles.tabBadge, activeTab === tab.key ? styles.activeTabBadge : null]}>{tab.count}</Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  )
}

function ChildSelector({ links, onSelect, selectedLinkId }) {
  return (
    <View style={styles.childSelector}>
      {links.map((link) => {
        const isActive = link.id === selectedLinkId

        return (
          <Pressable
            key={link.id}
            onPress={() => onSelect(link.id)}
            style={[styles.childButton, isActive ? styles.childButtonActive : null]}
          >
            <Text style={[styles.childName, isActive ? styles.childNameActive : null]}>{link.playerName}</Text>
            {link.teamName ? (
              <Text style={[styles.childMeta, isActive ? styles.childMetaActive : null]}>{link.teamName}</Text>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

function MatchdayPanel({ activeActionId, matches, onRefresh, onVolunteerScorer }) {
  return matches.length > 0 ? (
    <View style={styles.list}>
      <PrimaryButton loading={activeActionId === 'refresh:parent'} onPress={onRefresh} variant="secondary">
        Refresh Matchday
      </PrimaryButton>
      {matches.map((match) => (
        <MatchCard
          isBusy={activeActionId === `scorer:${match.id}`}
          key={match.id}
          match={match}
          onVolunteerScorer={onVolunteerScorer}
        />
      ))}
    </View>
  ) : (
    <View style={styles.card}>
      <Text style={styles.item}>No matchday updates are available right now.</Text>
    </View>
  )
}

function MessagesPanel({ activeActionId, messages, onMarkRead }) {
  return messages.length > 0 ? (
    <View style={styles.list}>
      {messages.map((message) => (
        <MessageCard
          isBusy={activeActionId === `message:${message.id}`}
          key={message.id}
          message={message}
          onMarkRead={onMarkRead}
        />
      ))}
    </View>
  ) : (
    <View style={styles.card}>
      <Text style={styles.item}>No messages have been shared yet.</Text>
    </View>
  )
}

function PollsPanel({ activeActionId, onVote, polls }) {
  return polls.length > 0 ? (
    <View style={styles.list}>
      {polls.map((poll) => (
        <PollCard
          activeOptionId={poll.currentOptionId || poll.currentOptionIds?.[0] || ''}
          isBusy={activeActionId.startsWith(`poll:${poll.id}:`)}
          key={poll.id}
          onVote={onVote}
          poll={poll}
        />
      ))}
    </View>
  ) : (
    <View style={styles.card}>
      <Text style={styles.item}>No parent polls are open right now.</Text>
    </View>
  )
}

function OverviewPanel({ isOpen, onToggle, stats, summary }) {
  return (
    <View style={styles.overviewPanel}>
      <Pressable onPress={onToggle} style={styles.overviewButton}>
        <View>
          <Text style={styles.overviewLabel}>Overview</Text>
          <Text style={styles.overviewSummary}>{summary}</Text>
        </View>
        <Text style={styles.overviewAction}>{isOpen ? 'Hide' : 'Show'}</Text>
      </Pressable>
      {isOpen ? (
        <View style={styles.statGrid}>
          {stats.map((stat) => <StatCard key={stat.label} label={stat.label} value={stat.value} />)}
        </View>
      ) : null}
    </View>
  )
}

function SettingsPanel({
  biometricAvailable,
  biometricEnabled,
  config,
  isRegisteringPush,
  isUpdatingBiometrics,
  lastUpdatedAt,
  notificationCopy,
  notificationEnabled,
  onDisableNotifications,
  onEnableNotifications,
  onSignOut,
  onToggleBiometrics,
}) {
  return (
    <View style={styles.list}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Notifications</Text>
        <Text style={styles.item}>{notificationCopy}</Text>
        <PrimaryButton loading={isRegisteringPush} onPress={onEnableNotifications}>
          {notificationEnabled ? 'Refresh notifications' : 'Enable notifications'}
        </PrimaryButton>
        {notificationEnabled ? (
          <PrimaryButton loading={isRegisteringPush} onPress={onDisableNotifications} variant="secondary">
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
          onPress={onToggleBiometrics}
          variant="secondary"
        >
          {biometricEnabled ? 'Disable biometric unlock' : 'Enable biometric unlock'}
        </PrimaryButton>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>App access</Text>
        <Text style={styles.item}>{config.isUsable ? 'Connection ready' : 'Connection needs setup'}</Text>
        {lastUpdatedAt ? <Text style={styles.item}>Updated {formatLastUpdated(lastUpdatedAt)}</Text> : null}
        <PrimaryButton onPress={onSignOut} variant="secondary">Sign out</PrimaryButton>
      </View>
    </View>
  )
}

function formatLastUpdated(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
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
    return <LoadingScreen message="Loading Football Player Parents..." />
  }

  if (!session?.user) {
    return <LoginScreen />
  }

  if (isLocked) {
    return <LockedScreen errorMessage={authError} onUnlock={unlockWithBiometrics} />
  }

  return <ParentHome />
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
    <AuthProvider appRole="parent">
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
  childButton: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 3,
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  childButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  childMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  childMetaActive: {
    color: '#000000',
  },
  childName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  childNameActive: {
    color: '#000000',
  },
  childSelector: {
    gap: 8,
    marginTop: 4,
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
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  list: {
    gap: 12,
  },
  overviewAction: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
  },
  overviewButton: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  overviewLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  overviewPanel: {
    gap: 12,
  },
  overviewSummary: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
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
  activeTabButton: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  activeTabText: {
    color: '#000000',
  },
  tabButton: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexBasis: '42%',
    flexGrow: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  tabContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  tabRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tabBadge: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    color: '#000000',
    fontSize: 11,
    fontWeight: '900',
    minWidth: 20,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    textAlign: 'center',
  },
  activeTabBadge: {
    backgroundColor: '#000000',
    color: colors.accent,
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
