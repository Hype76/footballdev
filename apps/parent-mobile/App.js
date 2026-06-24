import 'react-native-url-polyfill/auto'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppState, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useMobileActionRunner } from '../mobile-core/src/actions'
import { AuthProvider, useMobileAuth } from '../mobile-core/src/auth'
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
import { useMobileDeviceControls } from '../mobile-core/src/deviceControls'
import { getParentPortalLinks, getSelectedParentLink, withSelectedParentLink } from '../mobile-core/src/parentLinks'
import { getTabForNotificationRoute } from '../mobile-core/src/routes'
import { colors } from '../mobile-core/src/theme'
import { AccessScreen, ChoiceGroup, EmptyState, LegalFooter, ListStack, LoadingRow, LoadingScreen, LockedScreen, MatchCard, MessageCard, MobileLoginScreen, MobileScreen, MobileSettingsPanel, OverviewPanel, Panel, PollCard, PrimaryButton, RecoveryPanel, ScreenHeader, StatusBanner, TabRail } from '../mobile-core/src/ui'

const config = getMobileRuntimeConfig('parent')

function LoginScreen() {
  const { authError, signIn } = useMobileAuth()

  return (
    <MobileLoginScreen
      authError={authError}
      copy="Use the parent login linked by your club."
      emailPlaceholder="parent@example.com"
      kicker="Parent App"
      logoSource={require('./assets/football-player-logo.png')}
      meta="Restricted parent access."
      signIn={signIn}
      title="Log in for child updates."
    />
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
  const [loadError, setLoadError] = useState('')
  const [activeActionId, setActiveActionId] = useState('')
  const [isLoadingSummary, setIsLoadingSummary] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState('')
  const [showOverview, setShowOverview] = useState(false)
  const runAction = useMobileActionRunner({ setActiveActionId, setStatusMessage })
  const parentLinks = useMemo(
    () => getParentPortalLinks(user),
    [user],
  )
  const selectedLink = useMemo(
    () => getSelectedParentLink(user, selectedLinkId),
    [selectedLinkId, user],
  )
  const selectedMobileUser = useMemo(
    () => withSelectedParentLink(user, selectedLink),
    [selectedLink, user],
  )
  const unreadMessageCount = messages.filter((message) => !message.readAt).length
  const unansweredPollCount = polls.filter((poll) => {
    const selectedOptionIds = Array.isArray(poll.currentOptionIds) ? poll.currentOptionIds : []
    return poll.status === 'open' && !poll.currentOptionId && selectedOptionIds.length === 0
  }).length
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
    appRole: 'parent',
    easProjectId: config.easProjectId,
    notificationDisabledMessage: 'Parent notifications are disabled on this device.',
    notificationEnabledMessage: 'Parent notifications are enabled on this device.',
    onStatusMessage: setStatusMessage,
    parentLinkId: selectedLink?.id || '',
  })

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
    setLoadError('')
  }, [selectedMobileUser])

  useEffect(() => {
    let isMounted = true

    async function loadSummary() {
      if (!selectedMobileUser?.id) {
        setIsLoadingSummary(false)
        return
      }

      setIsLoadingSummary(true)
      setStatusMessage('')
      setLoadError('')
      setSummary(null)
      setMatches([])
      setMessages([])
      setPolls([])

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
          const message = error.message || 'Parent summary could not be loaded.'
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
  }, [refreshParentData, selectedMobileUser])

  useEffect(() => {
    if (selectedLink?.id && selectedLinkId !== selectedLink.id) {
      setSelectedLinkId(selectedLink.id)
    }
  }, [selectedLink?.id, selectedLinkId])

  useEffect(() => {
    const route = lastNotificationResponse?.notification?.request?.content?.data?.route
    const targetTab = getTabForNotificationRoute('parent', route)

    if (targetTab) {
      setActiveTab(targetTab)
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

  async function handleManualRefresh() {
    await runAction('refresh:parent', async () => {
      await refreshParentData()
    }, {
      errorMessage: 'Latest updates could not be loaded.',
      successMessage: 'Latest updates loaded.',
    })
  }

  async function handleRefresh() {
    if (!selectedMobileUser?.id) {
      return
    }

    setIsRefreshing(true)
    setStatusMessage('')
    setLoadError('')

    try {
      await refreshParentData()
      setStatusMessage('Latest updates loaded.')
    } catch (error) {
      console.error(error)
      const message = error.message || 'Latest updates could not be loaded.'
      setStatusMessage(message)
      setLoadError(message)
    } finally {
      setIsRefreshing(false)
    }
  }

  async function handleVolunteerScorer(match) {
    await runAction(`scorer:${match.id}`, async () => {
      await volunteerAsMatchScorer(selectedMobileUser, match.id)
      await refreshParentData()
    }, {
      errorMessage: 'Scorer interest could not be sent.',
      successMessage: 'Your scorer interest has been sent.',
    })
  }

  async function handleMarkMessageRead(message) {
    await runAction(`message:${message.id}`, async () => {
      await markParentMessageRead(selectedMobileUser, message.id)
      await refreshParentData()
    }, {
      errorMessage: 'Message could not be marked as read.',
      successMessage: 'Message marked as read.',
    })
  }

  async function handlePollVote(poll, option) {
    await runAction(`poll:${poll.id}:${option.id}`, async () => {
      await submitParentPollVote(selectedMobileUser, poll.id, option.id)
      await refreshParentData()
    }, {
      errorMessage: 'Poll answer could not be saved.',
      successMessage: 'Your poll answer has been saved.',
    })
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
        copy="Live match alerts, messages, and polls will appear here."
        kicker={selectedLink?.clubName || user.clubName}
        logoSource={require('./assets/football-player-logo.png')}
        title={`${selectedLink?.playerName || 'Child'} updates.`}
      />

          <TabRail
            activeTab={activeTab}
            onChange={setActiveTab}
            tabBasis="42%"
            tabs={[
              { key: 'matchday', label: 'Matchday' },
              { key: 'messages', label: 'Messages', count: unreadMessageCount },
              { key: 'polls', label: 'Polls', count: unansweredPollCount },
              { key: 'settings', label: 'Settings' },
            ]}
          />

          <StatusBanner message={statusMessage} onDismiss={() => setStatusMessage('')} />

          {loadError ? (
            <RecoveryPanel
              isRetrying={isRefreshing}
              message={loadError}
              onRetry={handleRefresh}
              title="Could not load parent data"
            />
          ) : null}

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
            <MobileSettingsPanel
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
              notificationNeedsRefresh={Boolean(notificationState?.requiresContextRefresh)}
              onDisableNotifications={disableNotifications}
              onEnableNotifications={enableNotifications}
              onSignOut={signOut}
              onToggleBiometrics={toggleBiometrics}
            />
          ) : null}

          <Panel>
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
          </Panel>

          {isLoadingSummary ? (
            <LoadingRow message="Loading parent summary..." />
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
          <LegalFooter />
    </MobileScreen>
  )
}

function ChildSelector({ links, onSelect, selectedLinkId }) {
  return (
    <ChoiceGroup
      onChange={onSelect}
      options={links.map((link) => ({
        label: link.playerName,
        meta: link.teamName || '',
        value: link.id,
      }))}
      selectedValue={selectedLinkId}
    />
  )
}

function MatchdayPanel({ activeActionId, matches, onRefresh, onVolunteerScorer }) {
  return matches.length > 0 ? (
    <ListStack>
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
    </ListStack>
  ) : (
    <EmptyState message="No matchday updates are available right now." />
  )
}

function MessagesPanel({ activeActionId, messages, onMarkRead }) {
  return messages.length > 0 ? (
    <ListStack>
      {messages.map((message) => (
        <MessageCard
          isBusy={activeActionId === `message:${message.id}`}
          key={message.id}
          message={message}
          onMarkRead={onMarkRead}
        />
      ))}
    </ListStack>
  ) : (
    <EmptyState message="No messages have been shared yet." />
  )
}

function PollsPanel({ activeActionId, onVote, polls }) {
  return polls.length > 0 ? (
    <ListStack>
      {polls.map((poll) => (
        <PollCard
          activeOptionId={poll.currentOptionId || poll.currentOptionIds?.[0] || ''}
          isBusy={activeActionId.startsWith(`poll:${poll.id}:`)}
          key={poll.id}
          onVote={onVote}
          poll={poll}
        />
      ))}
    </ListStack>
  ) : (
    <EmptyState message="No parent polls are open right now." />
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
    return <LockedScreen errorMessage={authError} logoSource={require('./assets/football-player-logo.png')} onUnlock={unlockWithBiometrics} />
  }

  return <ParentHome />
}

export default function App() {
  return (
    <AuthProvider appRole="parent">
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
  item: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
})
