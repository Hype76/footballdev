import 'react-native-url-polyfill/auto'
import Constants from 'expo-constants'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { AuthProvider, useMobileAuth } from '../mobile-core/src/auth'
import { getBiometricAvailability, getBiometricEnabled, setBiometricEnabled } from '../mobile-core/src/biometrics'
import { getMobileRuntimeConfig } from '../mobile-core/src/config'
import {
  getParentCalendarEvents,
  getParentMatchDays,
  getParentMessages,
  getParentPolls,
  markParentMessageRead,
  submitParentPollVote,
} from '../mobile-core/src/data'
import { getParentPortalLinks, getSelectedParentLink, withSelectedParentLink } from '../mobile-core/src/parentLinks'
import { AccessScreen, LoadingScreen, LockedScreen, MobileLoginScreen } from '../mobile-core/src/ui'
import {
  canSubmitParentPoll,
  getBuildClassification,
  getParentFriendlyError,
  getParentHomeModel,
  getPollDraftOption,
} from './src/parentExperience'

const config = getMobileRuntimeConfig('parent')
const resourceNames = ['calendar', 'matches', 'messages', 'polls']
const resourceFallbacks = {
  calendar: 'Calendar information could not be loaded.',
  matches: 'Matchday information could not be loaded.',
  messages: 'Messages could not be loaded.',
  polls: 'Polls could not be loaded.',
}

function createResourceState() {
  return Object.fromEntries(resourceNames.map((name) => [name, {
    error: '',
    items: [],
    loading: true,
  }]))
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function labelize(value) {
  const label = normalizeText(value).replaceAll('_', ' ')
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : ''
}

function formatDateOnly(value, fallback = 'Date to be confirmed') {
  const normalizedValue = normalizeText(value)
  if (!normalizedValue) return fallback
  const date = new Date(`${normalizedValue.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return fallback

  return date.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
  })
}

function formatDateTime(value, fallback = 'Time to be confirmed') {
  const normalizedValue = normalizeText(value)
  if (!normalizedValue) return fallback
  const date = new Date(normalizedValue)
  if (Number.isNaN(date.getTime())) return fallback

  return date.toLocaleString([], {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    weekday: 'short',
  })
}

function formatTime(value, isTbc = false) {
  if (isTbc) return 'Kick-off time to be confirmed'
  const normalizedValue = normalizeText(value)
  return normalizedValue ? normalizedValue.slice(0, 5) : 'Time to be confirmed'
}

function LoginScreen() {
  const { authError, signIn } = useMobileAuth()

  const handleSignIn = useCallback(async (email, password) => {
    try {
      await signIn(email, password)
    } catch {
      // AuthProvider owns the user-facing error state.
    }
  }, [signIn])

  return (
    <MobileLoginScreen
      authError={authError ? getParentFriendlyError(authError, 'Email or password not recognised.') : ''}
      copy="Use the email and password linked to your family account."
      emailPlaceholder="parent@example.com"
      kicker="Football Player Parents"
      logoSource={require('./assets/football-player-logo.png')}
      meta="Private family access. Password sign-in only."
      signIn={handleSignIn}
      title="Everything for your child, in one place."
    />
  )
}

function ParentHome() {
  const { authError, isProfileLoading, signOut, user } = useMobileAuth()
  const [activeTab, setActiveTab] = useState('home')
  const [activeActionId, setActiveActionId] = useState('')
  const [biometricAvailable, setBiometricAvailableState] = useState(false)
  const [biometricEnabled, setBiometricEnabledState] = useState(false)
  const [childSwitcherOpen, setChildSwitcherOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState('')
  const [notice, setNotice] = useState(null)
  const [pollDrafts, setPollDrafts] = useState({})
  const [resources, setResources] = useState(createResourceState)
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [selectedMessageId, setSelectedMessageId] = useState('')
  const requestIdRef = useRef(0)
  const parentLinks = useMemo(() => getParentPortalLinks(user), [user])
  const selectedLink = useMemo(
    () => getSelectedParentLink({ ...user, parentPortalLinks: parentLinks }, selectedLinkId),
    [parentLinks, selectedLinkId, user],
  )
  const selectedMobileUser = useMemo(
    () => withSelectedParentLink({ ...user, parentPortalLinks: parentLinks }, selectedLink),
    [parentLinks, selectedLink, user],
  )
  const homeModel = useMemo(() => getParentHomeModel({
    calendarEvents: resources.calendar.items,
    matches: resources.matches.items,
    messages: resources.messages.items,
    polls: resources.polls.items,
  }), [resources])

  const loadParentData = useCallback(async ({ reset = false } = {}) => {
    const requestId = ++requestIdRef.current

    if (!selectedMobileUser?.id || !selectedLink?.id) {
      setResources(Object.fromEntries(resourceNames.map((name) => [name, {
        error: '',
        items: [],
        loading: false,
      }])))
      setLastUpdatedAt('')
      return { failed: 0 }
    }

    setResources((current) => Object.fromEntries(resourceNames.map((name) => [name, {
      error: '',
      items: reset ? [] : current[name].items,
      loading: true,
    }])))

    const loaders = {
      calendar: () => getParentCalendarEvents(selectedMobileUser),
      matches: () => getParentMatchDays(selectedMobileUser),
      messages: () => getParentMessages(selectedMobileUser),
      polls: () => getParentPolls(selectedMobileUser),
    }
    const results = await Promise.allSettled(resourceNames.map((name) => loaders[name]()))

    if (requestId !== requestIdRef.current) {
      return { failed: 0, stale: true }
    }

    const failed = results.filter((result) => result.status === 'rejected').length
    setResources((current) => {
      const next = { ...current }
      results.forEach((result, index) => {
        const name = resourceNames[index]
        if (result.status === 'fulfilled') {
          next[name] = { error: '', items: result.value, loading: false }
        } else {
          next[name] = {
            error: getParentFriendlyError(result.reason, resourceFallbacks[name]),
            items: current[name].items,
            loading: false,
          }
        }
      })
      return next
    })
    setLastUpdatedAt(new Date().toISOString())
    return { failed }
  }, [selectedLink?.id, selectedMobileUser])

  useEffect(() => {
    const nextSelectedLinkId = selectedLink?.id || ''
    if (selectedLinkId !== nextSelectedLinkId) {
      setSelectedLinkId(nextSelectedLinkId)
    }
  }, [selectedLink?.id, selectedLinkId])

  useEffect(() => {
    setSelectedMatchId('')
    setSelectedMessageId('')
    setPollDrafts({})
    setNotice(null)
    void loadParentData({ reset: true })
  }, [loadParentData, selectedLink?.id])

  useEffect(() => {
    let mounted = true
    void Promise.all([getBiometricAvailability(), getBiometricEnabled()])
      .then(([availability, enabled]) => {
        if (mounted) {
          setBiometricAvailableState(availability.available)
          setBiometricEnabledState(enabled)
        }
      })
      .catch(() => {
        if (mounted) {
          setBiometricAvailableState(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && selectedLink?.id) {
        void loadParentData()
      }
    })
    return () => subscription.remove()
  }, [loadParentData, selectedLink?.id])

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedMessageId) {
        setSelectedMessageId('')
        return true
      }
      if (selectedMatchId) {
        setSelectedMatchId('')
        return true
      }
      if (childSwitcherOpen) {
        setChildSwitcherOpen(false)
        return true
      }
      if (activeTab !== 'home') {
        setActiveTab('home')
        return true
      }
      return false
    })

    return () => subscription.remove()
  }, [activeTab, childSwitcherOpen, selectedMatchId, selectedMessageId])

  async function handleRefresh() {
    if (!selectedLink?.id || isRefreshing) return
    setIsRefreshing(true)
    setNotice(null)
    try {
      const result = await loadParentData()
      setNotice(result.failed > 0
        ? { message: 'Some information could not be refreshed. Your previous view is still available.', tone: 'warning' }
        : { message: 'You are up to date.', tone: 'success' })
    } finally {
      setIsRefreshing(false)
    }
  }

  function handleTabChange(tab) {
    setSelectedMatchId('')
    setSelectedMessageId('')
    setChildSwitcherOpen(false)
    setActiveTab(tab)
  }

  function handleChildChange(linkId) {
    if (!parentLinks.some((link) => link.id === linkId)) return
    setSelectedLinkId(linkId)
    setChildSwitcherOpen(false)
    setActiveTab('home')
  }

  async function handleOpenMessage(message) {
    setSelectedMessageId(message.id)
    if (message.readAt || activeActionId) return

    setActiveActionId(`message:${message.id}`)
    try {
      const readAt = await markParentMessageRead(selectedMobileUser, message.id)
      setResources((current) => ({
        ...current,
        messages: {
          ...current.messages,
          items: current.messages.items.map((item) => item.id === message.id ? { ...item, readAt } : item),
        },
      }))
    } catch (error) {
      setNotice({
        message: getParentFriendlyError(error, 'This message could not be marked as read.'),
        tone: 'warning',
      })
    } finally {
      setActiveActionId('')
    }
  }

  async function handlePollSubmit(poll, selectedOptionId = '') {
    const optionId = normalizeText(selectedOptionId) || getPollDraftOption(poll, pollDrafts)
    if (!canSubmitParentPoll(poll, optionId) || activeActionId) return

    setActiveActionId(`poll:${poll.id}`)
    setNotice(null)
    try {
      await submitParentPollVote(selectedMobileUser, poll.id, optionId)
      setNotice({ message: 'Your response has been saved.', tone: 'success' })
      await loadParentData()
    } catch (error) {
      setNotice({
        message: getParentFriendlyError(error, 'Your poll response could not be saved.'),
        tone: 'error',
      })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleBiometricChange(enabled) {
    if (activeActionId) return
    setActiveActionId('biometrics')
    setNotice(null)
    try {
      const nextValue = await setBiometricEnabled(enabled)
      setBiometricEnabledState(nextValue)
      setNotice({
        message: nextValue ? 'Biometric app lock is enabled on this device.' : 'Biometric app lock is disabled.',
        tone: 'success',
      })
    } catch (error) {
      setNotice({
        message: getParentFriendlyError(error, 'Biometric app lock could not be changed.'),
        tone: 'warning',
      })
    } finally {
      setActiveActionId('')
    }
  }

  if (isProfileLoading) {
    return <LoadingScreen message="Opening your family account..." />
  }

  if (!user) {
    return (
      <AccessScreen
        message={getParentFriendlyError(authError, 'Your family account could not be opened.')}
        onSignOut={signOut}
        title="Parent access unavailable"
      />
    )
  }

  const selectedMessage = resources.messages.items.find((message) => message.id === selectedMessageId)
  const selectedMatch = resources.matches.items.find((match) => match.id === selectedMatchId)
  const tabs = [
    { key: 'home', label: 'Home' },
    { count: homeModel.unreadMessages, key: 'messages', label: 'Messages' },
    { count: homeModel.unansweredPolls, key: 'polls', label: 'Polls' },
    { key: 'settings', label: 'Settings' },
  ]

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardShell}
      >
        <AppHeader
          childCount={parentLinks.length}
          childSwitcherOpen={childSwitcherOpen}
          links={parentLinks}
          onChildChange={handleChildChange}
          onToggleChildSwitcher={() => setChildSwitcherOpen((open) => !open)}
          selectedLink={selectedLink}
        />

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={(
            <RefreshControl
              colors={[palette.accent]}
              onRefresh={handleRefresh}
              refreshing={isRefreshing}
              tintColor={palette.accent}
            />
          )}
        >
          <View style={styles.contentColumn}>
            {notice ? <Notice message={notice.message} onDismiss={() => setNotice(null)} tone={notice.tone} /> : null}

            {activeTab === 'home' ? (
              <HomeScreen
                calendar={resources.calendar}
                homeModel={homeModel}
                link={selectedLink}
                matches={resources.matches}
                messages={resources.messages}
                onOpenMatch={(match) => setSelectedMatchId(match.id)}
                onOpenMessages={() => handleTabChange('messages')}
                onOpenPolls={() => handleTabChange('polls')}
                onRetry={handleRefresh}
                selectedMatch={selectedMatch}
              />
            ) : null}
            {activeTab === 'messages' ? (
              <MessagesScreen
                activeActionId={activeActionId}
                link={selectedLink}
                onBack={() => setSelectedMessageId('')}
                onOpen={handleOpenMessage}
                onRetry={handleRefresh}
                resource={resources.messages}
                selectedMessage={selectedMessage}
              />
            ) : null}
            {activeTab === 'polls' ? (
              <PollsScreen
                activeActionId={activeActionId}
                drafts={pollDrafts}
                link={selectedLink}
                onDraftChange={(pollId, optionId) => setPollDrafts((current) => ({ ...current, [pollId]: optionId }))}
                onRetry={handleRefresh}
                onSubmit={handlePollSubmit}
                resource={resources.polls}
              />
            ) : null}
            {activeTab === 'settings' ? (
              <SettingsScreen
                activeActionId={activeActionId}
                biometricAvailable={biometricAvailable}
                biometricEnabled={biometricEnabled}
                lastUpdatedAt={lastUpdatedAt}
                links={parentLinks}
                onBiometricChange={handleBiometricChange}
                onSignOut={signOut}
                user={user}
              />
            ) : null}
          </View>
        </ScrollView>

        <BottomTabs activeTab={activeTab} onChange={handleTabChange} tabs={tabs} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function AppHeader({ childCount, childSwitcherOpen, links, onChildChange, onToggleChildSwitcher, selectedLink }) {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel="Football Player Parents"
          source={require('./assets/football-player-logo.png')}
          style={styles.headerLogo}
        />
        <View style={styles.brandCopy}>
          <Text style={styles.brandName}>Football Player Parents</Text>
          <Text numberOfLines={1} style={styles.brandMeta}>
            {selectedLink?.clubName || 'Private family view'}
          </Text>
        </View>
      </View>

      {childCount > 1 ? (
        <>
          <Pressable
            accessibilityHint="Shows your linked children"
            accessibilityLabel={`Active child ${selectedLink?.playerName || 'not selected'}`}
            accessibilityRole="button"
            onPress={onToggleChildSwitcher}
            style={({ pressed }) => [styles.childButton, pressed && styles.pressed]}
          >
            <View style={styles.childButtonCopy}>
              <Text style={styles.childButtonEyebrow}>Active child</Text>
              <Text numberOfLines={1} style={styles.childButtonName}>{selectedLink?.playerName || 'Choose a child'}</Text>
              <Text numberOfLines={1} style={styles.childButtonTeam}>{selectedLink?.teamName || 'No Team assigned'}</Text>
            </View>
            <Text style={styles.childButtonAction}>{childSwitcherOpen ? 'Close' : 'Switch'}</Text>
          </Pressable>
          {childSwitcherOpen ? (
            <ScrollView
              accessibilityLabel="Linked children"
              contentContainerStyle={styles.childOptions}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {links.map((link) => {
                const active = link.id === selectedLink?.id
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    key={link.id}
                    onPress={() => onChildChange(link.id)}
                    style={[styles.childOption, active && styles.childOptionActive]}
                  >
                    <Text style={[styles.childOptionName, active && styles.childOptionNameActive]}>{link.playerName}</Text>
                    <Text style={[styles.childOptionTeam, active && styles.childOptionTeamActive]}>{link.teamName || 'No Team assigned'}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

function BottomTabs({ activeTab, onChange, tabs }) {
  return (
    <View accessibilityLabel="Parent app navigation" style={styles.tabBar}>
      {tabs.map((tab) => {
        const active = activeTab === tab.key
        return (
          <Pressable
            accessibilityLabel={tab.count > 0 ? `${tab.label}, ${tab.count} new` : tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.tabButton, active && styles.tabButtonActive, pressed && styles.pressed]}
          >
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
            {tab.count > 0 ? <Text style={[styles.tabCount, active && styles.tabCountActive]}>{tab.count}</Text> : null}
          </Pressable>
        )
      })}
    </View>
  )
}

function HomeScreen({ calendar, homeModel, link, matches, messages, onOpenMatch, onOpenMessages, onOpenPolls, onRetry, selectedMatch }) {
  if (!link?.id) {
    return (
      <EmptyPanel
        message="Your account is signed in, but no active child link is available. Ask your club to check the family link."
        title="No child linked"
      />
    )
  }

  if (selectedMatch) {
    return <MatchDetail match={selectedMatch} onBack={() => onOpenMatch({ id: '' })} />
  }

  const isInitialLoading = [calendar, matches, messages].every((resource) => resource.loading && resource.items.length === 0)

  return (
    <View style={styles.screenStack}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Family home</Text>
        <Text accessibilityRole="header" style={styles.heroTitle}>{link.playerName}</Text>
        <View style={styles.identityRow}>
          <Badge label="Player" tone="accent" />
          <Text style={styles.identityValue}>{link.playerName}</Text>
        </View>
        <View style={styles.identityRow}>
          <Badge label="Team" />
          <Text style={styles.identityValue}>{link.teamName || 'No Team assigned'}</Text>
        </View>
      </View>

      {isInitialLoading ? <LoadingPanel message="Loading your family updates" /> : null}
      <ResourceError onRetry={onRetry} resource={matches} title="Matchday unavailable" />
      <ResourceError onRetry={onRetry} resource={calendar} title="Calendar unavailable" />

      {!isInitialLoading ? (
        <>
          <SectionHeading copy="The nearest Parent-visible fixture or event." title="Next up" />
          {homeModel.nextActivity?.type === 'match' ? (
            <MatchPreviewCard match={homeModel.nextActivity.item} onPress={onOpenMatch} prominent />
          ) : homeModel.nextActivity?.type === 'calendar' ? (
            <CalendarCard event={homeModel.nextActivity.item} prominent />
          ) : (
            <EmptyPanel message="There are no upcoming fixtures or shared calendar events right now." title="Nothing scheduled" />
          )}
        </>
      ) : null}

      <View style={styles.summaryGrid}>
        <SummaryButton
          count={homeModel.unreadMessages}
          detail={homeModel.latestMessage?.subject || 'Club updates appear here'}
          label="Unread messages"
          onPress={onOpenMessages}
        />
        <SummaryButton
          count={homeModel.unansweredPolls}
          detail={homeModel.activePoll?.title || 'No response needed'}
          label="Polls to answer"
          onPress={onOpenPolls}
        />
      </View>

      {homeModel.upcomingMatches.length > 1 ? (
        <View style={styles.sectionStack}>
          <SectionHeading copy="Upcoming Parent-visible Matchday items." title="Fixtures" />
          {homeModel.upcomingMatches.slice(1, 4).map((match) => (
            <MatchPreviewCard key={match.id} match={match} onPress={onOpenMatch} />
          ))}
        </View>
      ) : null}

      {homeModel.upcomingCalendarEvents.length > 0 ? (
        <View style={styles.sectionStack}>
          <SectionHeading copy="Training, meetings and club events shared with your family." title="Calendar" />
          {homeModel.upcomingCalendarEvents.slice(0, 4).map((event) => (
            <CalendarCard event={event} key={event.id} />
          ))}
        </View>
      ) : null}

      {homeModel.recentMatches.length > 0 ? (
        <View style={styles.sectionStack}>
          <SectionHeading copy="Recent Parent-visible results." title="Recent Matchday" />
          {homeModel.recentMatches.slice(0, 3).map((match) => (
            <MatchPreviewCard key={match.id} match={match} onPress={onOpenMatch} />
          ))}
        </View>
      ) : null}
    </View>
  )
}

function MatchPreviewCard({ match, onPress, prominent = false }) {
  const status = labelize(match.status || 'scheduled')
  const isFinished = match.status === 'full_time'
  const score = isFinished || ['live', 'half_time', 'second_half', 'extra_time', 'penalties'].includes(match.status)
    ? `${match.homeScore} - ${match.awayScore}`
    : ''

  return (
    <Pressable
      accessibilityHint="Opens fixture details"
      accessibilityLabel={`${match.teamName} versus ${match.opponent}, ${status}`}
      accessibilityRole="button"
      onPress={() => onPress(match)}
      style={({ pressed }) => [styles.card, prominent && styles.cardProminent, pressed && styles.pressed]}
    >
      <View style={styles.cardTopRow}>
        <Badge label={status} tone={match.status === 'cancelled' ? 'danger' : match.status === 'live' ? 'accent' : 'neutral'} />
        <Text style={styles.cardDate}>{formatDateOnly(match.matchDate)}</Text>
      </View>
      <Text style={styles.cardTitle}>{match.teamName || 'Team'} v {match.opponent || 'Opponent'}</Text>
      <Text style={styles.cardMeta}>{formatTime(match.kickoffTime, match.kickoffTimeTbc)}</Text>
      {score ? <Text style={styles.score}>{score}</Text> : null}
      {match.venueName || match.venueAddress ? (
        <Text style={styles.cardMeta}>{[match.venueName, match.venueAddress].filter(Boolean).join(', ')}</Text>
      ) : null}
      <View style={styles.cardFooter}>
        <Text style={styles.cardLink}>View details</Text>
        {match.availabilityStatus ? <Badge label={`Availability: ${labelize(match.availabilityStatus)}`} /> : null}
      </View>
    </Pressable>
  )
}

function MatchDetail({ match, onBack }) {
  const selectionLabel = match.squadDecisionState && match.squadDecisionState !== 'undecided'
    ? labelize(match.squadDecisionState)
    : 'Not confirmed'
  const showScore = ['extra_time', 'full_time', 'half_time', 'live', 'penalties', 'second_half'].includes(match.status)

  return (
    <View style={styles.screenStack}>
      <BackButton label="Back to Home" onPress={onBack} />
      <View style={styles.heroCard}>
        <View style={styles.cardTopRow}>
          <Badge label={labelize(match.status)} tone={match.status === 'live' ? 'accent' : 'neutral'} />
          <Text style={styles.cardDate}>{formatDateOnly(match.matchDate)}</Text>
        </View>
        <Text accessibilityRole="header" style={styles.detailTitle}>{match.teamName} v {match.opponent}</Text>
        {showScore ? <Text style={styles.detailScore}>{match.homeScore} - {match.awayScore}</Text> : null}
      </View>

      <InfoPanel title="Fixture details">
        <InfoRow label="Kick-off" value={formatTime(match.kickoffTime, match.kickoffTimeTbc)} />
        {match.arrivalTime ? <InfoRow label="Arrival" value={formatTime(match.arrivalTime)} /> : null}
        <InfoRow label="Team" value={match.teamName || 'Team not set'} />
        <InfoRow label="Location" value={[match.venueName, match.venueAddress].filter(Boolean).join(', ') || 'Location not shared'} />
        <InfoRow label="Availability" value={labelize(match.availabilityStatus) || 'No response requested'} />
        <InfoRow label="Selection" value={selectionLabel} />
      </InfoPanel>

      {match.notes ? (
        <InfoPanel title="Shared notes">
          <Text style={styles.bodyText}>{match.notes}</Text>
        </InfoPanel>
      ) : null}

    </View>
  )
}

function CalendarCard({ event, prominent = false }) {
  const cancelled = event.status === 'cancelled' || Boolean(event.cancelledAt)
  return (
    <View style={[styles.card, prominent && styles.cardProminent]}>
      <View style={styles.cardTopRow}>
        <Badge label={cancelled ? 'Cancelled' : labelize(event.eventType)} tone={cancelled ? 'danger' : 'neutral'} />
        <Text style={styles.cardDate}>{formatDateTime(event.startsAt)}</Text>
      </View>
      <Text style={styles.cardTitle}>{event.title}</Text>
      {event.location ? <Text style={styles.cardMeta}>{event.location}</Text> : null}
      {event.notes ? <Text numberOfLines={3} style={styles.bodyText}>{event.notes}</Text> : null}
    </View>
  )
}

function MessagesScreen({ activeActionId, link, onBack, onOpen, onRetry, resource, selectedMessage }) {
  if (!link?.id) return <EmptyPanel message="No active child link is available for messages." title="Messages unavailable" />
  if (selectedMessage) {
    return (
      <View style={styles.screenStack}>
        <BackButton label="Back to Messages" onPress={onBack} />
        <View style={styles.heroCard}>
          <View style={styles.cardTopRow}>
            <Badge label={selectedMessage.readAt ? 'Read' : 'Unread'} tone={selectedMessage.readAt ? 'neutral' : 'accent'} />
            <Text style={styles.cardDate}>{formatDateTime(selectedMessage.createdAt)}</Text>
          </View>
          <Text accessibilityRole="header" style={styles.detailTitle}>{selectedMessage.subject}</Text>
          <Text style={styles.cardMeta}>From {selectedMessage.senderName || 'Your club'}</Text>
          {activeActionId === `message:${selectedMessage.id}` ? <LoadingLine label="Updating read status" /> : null}
        </View>
        <InfoPanel title="Message">
          <Text selectable style={styles.messageBody}>{selectedMessage.body || 'No message text was provided.'}</Text>
        </InfoPanel>
      </View>
    )
  }

  return (
    <View style={styles.screenStack}>
      <ScreenIntro copy={`Updates shared for ${link.playerName}.`} title="Messages" />
      <ResourceError onRetry={onRetry} resource={resource} title="Messages unavailable" />
      {resource.loading && resource.items.length === 0 ? <LoadingPanel message="Loading messages" /> : null}
      {!resource.loading && !resource.error && resource.items.length === 0 ? (
        <EmptyPanel message="Your club has not shared any messages for this child yet." title="No messages" />
      ) : null}
      {resource.items.map((message) => (
        <Pressable
          accessibilityHint="Opens the full message"
          accessibilityLabel={`${message.readAt ? 'Read' : 'Unread'} message, ${message.subject}`}
          accessibilityRole="button"
          key={message.id}
          onPress={() => onOpen(message)}
          style={({ pressed }) => [styles.card, !message.readAt && styles.unreadCard, pressed && styles.pressed]}
        >
          <View style={styles.cardTopRow}>
            <Badge label={message.readAt ? 'Read' : 'Unread'} tone={message.readAt ? 'neutral' : 'accent'} />
            <Text style={styles.cardDate}>{formatDateTime(message.createdAt)}</Text>
          </View>
          <Text style={styles.cardTitle}>{message.subject}</Text>
          <Text style={styles.cardMeta}>From {message.senderName || 'Your club'}</Text>
          <Text numberOfLines={2} style={styles.bodyText}>{message.body || 'Open to read this update.'}</Text>
          <Text style={styles.cardLink}>Read message</Text>
        </Pressable>
      ))}
    </View>
  )
}

function PollsScreen({ activeActionId, drafts, link, onDraftChange, onRetry, onSubmit, resource }) {
  if (!link?.id) return <EmptyPanel message="No active child link is available for polls." title="Polls unavailable" />

  return (
    <View style={styles.screenStack}>
      <ScreenIntro copy={`Parent responses for ${link.playerName}.`} title="Polls" />
      <ResourceError onRetry={onRetry} resource={resource} title="Polls unavailable" />
      {resource.loading && resource.items.length === 0 ? <LoadingPanel message="Loading polls" /> : null}
      {!resource.loading && !resource.error && resource.items.length === 0 ? (
        <EmptyPanel message="There are no active Parent polls right now." title="No polls to answer" />
      ) : null}
      {resource.items.map((poll) => {
        const draftOptionId = getPollDraftOption(poll, drafts)
        const currentOptionIds = Array.isArray(poll.currentOptionIds)
          ? poll.currentOptionIds.map(normalizeText).filter(Boolean)
          : normalizeText(poll.currentOptionId) ? [normalizeText(poll.currentOptionId)] : []
        const currentOptionId = currentOptionIds[0] || ''
        const busy = activeActionId === `poll:${poll.id}`
        const canChange = !currentOptionId || poll.allowVoteChanges === true
        const submitEnabled = canSubmitParentPoll(poll, draftOptionId)

        return (
          <View key={poll.id} style={styles.card}>
            <View style={styles.cardTopRow}>
              <Badge label={poll.status === 'open' && !poll.isExpired ? 'Open' : 'Closed'} tone={poll.status === 'open' && !poll.isExpired ? 'accent' : 'neutral'} />
              {poll.closesAt ? <Text style={styles.cardDate}>Closes {formatDateTime(poll.closesAt)}</Text> : null}
            </View>
            <Text accessibilityRole="header" style={styles.cardTitle}>{poll.title}</Text>
            {poll.description ? <Text style={styles.bodyText}>{poll.description}</Text> : null}
            {poll.allowMultiple ? (
              <Text style={styles.helperText}>
                {poll.maxChoices ? `Choose up to ${poll.maxChoices} answers. Each change is saved separately.` : 'Choose one or more answers. Each change is saved separately.'}
              </Text>
            ) : null}
            <View accessibilityLabel={`Response options for ${poll.title}`} style={styles.optionStack}>
              {poll.options.map((option) => {
                const selected = poll.allowMultiple ? currentOptionIds.includes(option.id) : draftOptionId === option.id
                const ownChildOption = poll.allowOwnChildVotes === false
                  && normalizeText(link.playerId)
                  && normalizeText(option.playerId) === normalizeText(link.playerId)
                const atChoiceLimit = poll.allowMultiple
                  && Number(poll.maxChoices || 0) > 0
                  && currentOptionIds.length >= Number(poll.maxChoices)
                  && !selected
                const optionDisabled = !canChange || busy || ownChildOption || atChoiceLimit
                return (
                  <Pressable
                    accessibilityHint={ownChildOption ? 'Your own child is not available for this poll' : poll.allowMultiple ? 'Adds or removes this saved response' : 'Selects this response'}
                    accessibilityRole={poll.allowMultiple ? 'checkbox' : 'radio'}
                    accessibilityState={{ checked: selected, disabled: optionDisabled }}
                    disabled={optionDisabled}
                    key={option.id}
                    onPress={() => poll.allowMultiple ? onSubmit(poll, option.id) : onDraftChange(poll.id, option.id)}
                    style={({ pressed }) => [styles.optionButton, selected && styles.optionButtonSelected, optionDisabled && styles.optionButtonDisabled, pressed && styles.pressed]}
                  >
                    <View style={[styles.radio, selected && styles.radioSelected]} />
                    <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                      {option.label}{ownChildOption ? ' (unavailable)' : ''}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
            {currentOptionId ? (
              <Text style={styles.helperText}>
                {poll.allowVoteChanges ? 'Your current response is selected. Choose another option to change it.' : 'Your response has been recorded and cannot be changed.'}
              </Text>
            ) : null}
            {poll.allowMultiple ? (
              busy ? <LoadingLine label="Saving response" /> : null
            ) : (
              <PrimaryAction
                disabled={!submitEnabled}
                label={currentOptionId ? 'Save changed response' : 'Submit response'}
                loading={busy}
                onPress={() => onSubmit(poll)}
              />
            )}
          </View>
        )
      })}
    </View>
  )
}

function SettingsScreen({ activeActionId, biometricAvailable, biometricEnabled, lastUpdatedAt, links, onBiometricChange, onSignOut, user }) {
  const appVersion = Constants.expoConfig?.version || '1.0.1'
  const buildNumber = Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber || '1'
    : Constants.expoConfig?.android?.versionCode || '1'

  return (
    <View style={styles.screenStack}>
      <ScreenIntro copy="Account, security and test-build information." title="Settings" />

      <InfoPanel title="Signed-in Parent">
        <InfoRow label="Name" value={user.displayName || user.name || 'Parent'} />
        <InfoRow label="Email" value={user.email || 'Email unavailable'} />
      </InfoPanel>

      <InfoPanel title="Linked children">
        {links.length > 0 ? links.map((link) => (
          <View key={link.id} style={styles.linkSummary}>
            <View style={styles.identityRow}>
              <Badge label="Player" tone="accent" />
              <Text style={styles.identityValue}>{link.playerName}</Text>
            </View>
            <View style={styles.identityRow}>
              <Badge label="Team" />
              <Text style={styles.identityValue}>{link.teamName || 'No Team assigned'}</Text>
            </View>
          </View>
        )) : <Text style={styles.bodyText}>No active child links are available.</Text>}
      </InfoPanel>

      <View style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={styles.cardTitle}>Biometric app lock</Text>
            <Text style={styles.bodyText}>
              Uses biometrics already enrolled on this device. It protects local app access and does not change your Football Player password.
            </Text>
            {!biometricAvailable ? <Text style={styles.helperText}>No enrolled biometric security is available on this device.</Text> : null}
          </View>
          {activeActionId === 'biometrics' ? <ActivityIndicator color={palette.accent} /> : (
            <Switch
              accessibilityLabel="Biometric app lock"
              disabled={!biometricAvailable}
              onValueChange={onBiometricChange}
              trackColor={{ false: palette.borderStrong, true: palette.accentMuted }}
              thumbColor={biometricEnabled ? palette.accent : palette.textMuted}
              value={biometricEnabled}
            />
          )}
        </View>
      </View>

      <InfoPanel title="App information">
        <InfoRow label="Build" value={getBuildClassification(config.buildProfile)} />
        <InfoRow label="Connection" value={config.isUsable ? 'Test service ready' : 'Connection needs attention'} />
        <InfoRow label="Version" value={`${appVersion} (${buildNumber})`} />
        {lastUpdatedAt ? <InfoRow label="Last refreshed" value={formatDateTime(lastUpdatedAt)} /> : null}
        <Text style={styles.helperText}>This test build cannot connect to the live Football Player service.</Text>
      </InfoPanel>

      <PrimaryAction label="Sign out" onPress={onSignOut} secondary />
      <Text style={styles.legalText}>Football Player Parents. Private family access.</Text>
    </View>
  )
}

function ScreenIntro({ copy, title }) {
  return (
    <View style={styles.screenIntro}>
      <Text accessibilityRole="header" style={styles.screenTitle}>{title}</Text>
      <Text style={styles.screenCopy}>{copy}</Text>
    </View>
  )
}

function SectionHeading({ copy, title }) {
  return (
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {copy ? <Text style={styles.sectionCopy}>{copy}</Text> : null}
    </View>
  )
}

function SummaryButton({ count, detail, label, onPress }) {
  return (
    <Pressable
      accessibilityLabel={`${count} ${label}. ${detail}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.summaryCard, pressed && styles.pressed]}
    >
      <Text style={styles.summaryCount}>{count}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.summaryDetail}>{detail}</Text>
    </Pressable>
  )
}

function InfoPanel({ children, title }) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>{title}</Text>
      <View style={styles.infoStack}>{children}</View>
    </View>
  )
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text selectable style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function Badge({ label, tone = 'neutral' }) {
  return (
    <View style={[styles.badge, tone === 'accent' && styles.badgeAccent, tone === 'danger' && styles.badgeDanger]}>
      <Text style={[styles.badgeText, tone === 'accent' && styles.badgeTextAccent, tone === 'danger' && styles.badgeTextDanger]}>{label}</Text>
    </View>
  )
}

function Notice({ message, onDismiss, tone = 'success' }) {
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, tone === 'error' && styles.noticeError, tone === 'warning' && styles.noticeWarning]}>
      <Text style={styles.noticeText}>{message}</Text>
      <Pressable accessibilityLabel="Dismiss message" accessibilityRole="button" onPress={onDismiss} style={styles.noticeDismiss}>
        <Text style={styles.noticeDismissText}>Dismiss</Text>
      </Pressable>
    </View>
  )
}

function ResourceError({ onRetry, resource, title }) {
  if (!resource.error) return null
  return (
    <View accessibilityLiveRegion="assertive" style={styles.errorPanel}>
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.bodyText}>{resource.error}</Text>
      {resource.items.length > 0 ? <Text style={styles.helperText}>Showing the last available information.</Text> : null}
      {onRetry ? <PrimaryAction label="Try again" onPress={onRetry} secondary /> : null}
    </View>
  )
}

function EmptyPanel({ message, title }) {
  return (
    <View style={styles.emptyPanel}>
      <Text accessibilityRole="header" style={styles.cardTitle}>{title}</Text>
      <Text style={styles.bodyText}>{message}</Text>
    </View>
  )
}

function LoadingPanel({ message }) {
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.loadingPanel}>
      <ActivityIndicator color={palette.accent} />
      <Text style={styles.bodyText}>{message}</Text>
    </View>
  )
}

function LoadingLine({ label }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.loadingLine}>
      <ActivityIndicator color={palette.accent} size="small" />
      <Text style={styles.helperText}>{label}</Text>
    </View>
  )
}

function PrimaryAction({ disabled = false, label, loading = false, onPress, secondary = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryAction,
        secondary && styles.secondaryAction,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? <ActivityIndicator color={secondary ? palette.text : palette.ink} /> : (
        <Text style={[styles.primaryActionText, secondary && styles.secondaryActionText]}>{label}</Text>
      )}
    </Pressable>
  )
}

function BackButton({ label, onPress }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
      <Text style={styles.backButtonText}>{label}</Text>
    </Pressable>
  )
}

function AppContent() {
  const { authError, isLoading, isLocked, session, unlockWithBiometrics } = useMobileAuth()

  if (isLoading) return <LoadingScreen message="Loading Football Player Parents..." />
  if (!session?.user) return <LoginScreen />
  if (isLocked) {
    return (
      <LockedScreen
        errorMessage={authError}
        logoSource={require('./assets/football-player-logo.png')}
        onUnlock={unlockWithBiometrics}
      />
    )
  }
  return <ParentHome />
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider appRole="parent">
        <AppContent />
      </AuthProvider>
    </SafeAreaProvider>
  )
}

const palette = {
  accent: '#d7ff2f',
  accentMuted: '#78920f',
  background: '#030603',
  border: '#1d3520',
  borderStrong: '#35543a',
  card: '#0a160c',
  cardRaised: '#102415',
  danger: '#ffb4ab',
  dangerBackground: '#351313',
  ink: '#071007',
  text: '#f2faef',
  textMuted: '#a9b8a6',
  warning: '#ffdca2',
  warningBackground: '#2c210d',
}

const styles = StyleSheet.create({
  backButton: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 48, paddingHorizontal: 4 },
  backButtonText: { color: palette.accent, fontSize: 15, fontWeight: '800' },
  badge: { alignSelf: 'flex-start', backgroundColor: '#142418', borderColor: palette.borderStrong, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  badgeAccent: { backgroundColor: palette.accent, borderColor: palette.accent },
  badgeDanger: { backgroundColor: palette.dangerBackground, borderColor: palette.danger },
  badgeText: { color: palette.textMuted, fontSize: 11, fontWeight: '900' },
  badgeTextAccent: { color: palette.ink },
  badgeTextDanger: { color: palette.danger },
  bodyText: { color: palette.textMuted, fontSize: 15, lineHeight: 22 },
  brandCopy: { flex: 1, minWidth: 0 },
  brandMeta: { color: palette.textMuted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  brandName: { color: palette.text, fontSize: 17, fontWeight: '900' },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  card: { backgroundColor: palette.card, borderColor: palette.border, borderRadius: 18, borderWidth: 1, gap: 10, padding: 16 },
  cardDate: { color: palette.textMuted, flexShrink: 1, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  cardFooter: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginTop: 4 },
  cardLink: { color: palette.accent, fontSize: 13, fontWeight: '900' },
  cardMeta: { color: palette.textMuted, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  cardProminent: { backgroundColor: palette.cardRaised, borderColor: palette.accentMuted },
  cardTitle: { color: palette.text, flexShrink: 1, fontSize: 18, fontWeight: '900', lineHeight: 23 },
  cardTopRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  childButton: { alignItems: 'center', backgroundColor: palette.card, borderColor: palette.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginTop: 12, minHeight: 58, paddingHorizontal: 14, paddingVertical: 9 },
  childButtonAction: { color: palette.accent, fontSize: 13, fontWeight: '900' },
  childButtonCopy: { flex: 1, minWidth: 0 },
  childButtonEyebrow: { color: palette.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  childButtonName: { color: palette.text, fontSize: 15, fontWeight: '900', marginTop: 2 },
  childButtonTeam: { color: palette.textMuted, fontSize: 12, fontWeight: '700', marginTop: 1 },
  childOption: { backgroundColor: palette.card, borderColor: palette.border, borderRadius: 14, borderWidth: 1, justifyContent: 'center', minHeight: 58, minWidth: 160, paddingHorizontal: 14, paddingVertical: 9 },
  childOptionActive: { backgroundColor: palette.accent, borderColor: palette.accent },
  childOptionName: { color: palette.text, fontSize: 14, fontWeight: '900' },
  childOptionNameActive: { color: palette.ink },
  childOptions: { gap: 8, paddingTop: 8 },
  childOptionTeam: { color: palette.textMuted, fontSize: 12, fontWeight: '700', marginTop: 3 },
  childOptionTeamActive: { color: palette.ink },
  contentColumn: { alignSelf: 'center', maxWidth: 680, width: '100%' },
  detailScore: { color: palette.accent, fontSize: 40, fontWeight: '900', letterSpacing: -1 },
  detailTitle: { color: palette.text, fontSize: 28, fontWeight: '900', letterSpacing: -0.5, lineHeight: 34 },
  disabled: { opacity: 0.45 },
  emptyPanel: { backgroundColor: palette.card, borderColor: palette.border, borderRadius: 18, borderStyle: 'dashed', borderWidth: 1, gap: 8, padding: 20 },
  errorPanel: { backgroundColor: palette.dangerBackground, borderColor: palette.danger, borderRadius: 16, borderWidth: 1, gap: 6, padding: 14 },
  errorTitle: { color: palette.danger, fontSize: 15, fontWeight: '900' },
  eyebrow: { color: palette.accent, fontSize: 12, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  header: { backgroundColor: palette.background, borderBottomColor: palette.border, borderBottomWidth: 1, paddingBottom: 12, paddingHorizontal: 16, paddingTop: 10 },
  headerLogo: { height: 42, width: 42 },
  helperText: { color: palette.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  heroCard: { backgroundColor: palette.cardRaised, borderColor: palette.borderStrong, borderRadius: 22, borderWidth: 1, gap: 10, padding: 20 },
  heroTitle: { color: palette.text, fontSize: 34, fontWeight: '900', letterSpacing: -1, lineHeight: 39 },
  identityRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  identityValue: { color: palette.text, flex: 1, fontSize: 14, fontWeight: '800' },
  infoLabel: { color: palette.textMuted, fontSize: 13, fontWeight: '700' },
  infoRow: { alignItems: 'flex-start', borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: 12, justifyContent: 'space-between', paddingTop: 11 },
  infoStack: { gap: 11 },
  infoValue: { color: palette.text, flex: 1, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  keyboardShell: { flex: 1 },
  legalText: { color: palette.textMuted, fontSize: 12, fontWeight: '700', paddingBottom: 8, textAlign: 'center' },
  linkSummary: { gap: 8 },
  loadingLine: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  loadingPanel: { alignItems: 'center', backgroundColor: palette.card, borderColor: palette.border, borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 76, padding: 18 },
  messageBody: { color: palette.text, fontSize: 16, lineHeight: 25 },
  notice: { backgroundColor: '#11240f', borderColor: palette.accentMuted, borderRadius: 16, borderWidth: 1, gap: 8, padding: 14 },
  noticeDismiss: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 40 },
  noticeDismissText: { color: palette.accent, fontSize: 13, fontWeight: '900' },
  noticeError: { backgroundColor: palette.dangerBackground, borderColor: palette.danger },
  noticeText: { color: palette.text, fontSize: 14, fontWeight: '800', lineHeight: 20 },
  noticeWarning: { backgroundColor: palette.warningBackground, borderColor: palette.warning },
  optionButton: { alignItems: 'center', backgroundColor: '#111e13', borderColor: palette.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10 },
  optionButtonDisabled: { opacity: 0.55 },
  optionButtonSelected: { backgroundColor: '#26360c', borderColor: palette.accent },
  optionLabel: { color: palette.text, flex: 1, fontSize: 15, fontWeight: '800' },
  optionLabelSelected: { color: palette.accent },
  optionStack: { gap: 8 },
  pressed: { opacity: 0.78 },
  primaryAction: { alignItems: 'center', backgroundColor: palette.accent, borderColor: palette.accent, borderRadius: 14, borderWidth: 1, justifyContent: 'center', minHeight: 52, paddingHorizontal: 16, paddingVertical: 13 },
  primaryActionText: { color: palette.ink, fontSize: 15, fontWeight: '900' },
  radio: { borderColor: palette.borderStrong, borderRadius: 999, borderWidth: 2, height: 20, width: 20 },
  radioSelected: { backgroundColor: palette.accent, borderColor: palette.accent, borderWidth: 5 },
  safeArea: { backgroundColor: palette.background, flex: 1 },
  score: { color: palette.accent, fontSize: 28, fontWeight: '900' },
  screenCopy: { color: palette.textMuted, fontSize: 15, lineHeight: 22 },
  screenIntro: { gap: 4 },
  screenStack: { gap: 14 },
  screenTitle: { color: palette.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  scrollContent: { paddingBottom: 28, paddingHorizontal: 16, paddingTop: 16 },
  secondaryAction: { backgroundColor: palette.card, borderColor: palette.borderStrong },
  secondaryActionText: { color: palette.text },
  sectionCopy: { color: palette.textMuted, fontSize: 13, lineHeight: 19 },
  sectionHeading: { gap: 2, marginTop: 4 },
  sectionStack: { gap: 10 },
  sectionTitle: { color: palette.text, fontSize: 21, fontWeight: '900' },
  settingCopy: { flex: 1, gap: 6 },
  settingRow: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  summaryCard: { backgroundColor: palette.card, borderColor: palette.border, borderRadius: 18, borderWidth: 1, flex: 1, gap: 4, minHeight: 132, minWidth: 145, padding: 16 },
  summaryCount: { color: palette.accent, fontSize: 32, fontWeight: '900' },
  summaryDetail: { color: palette.textMuted, fontSize: 12, lineHeight: 17 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryLabel: { color: palette.text, fontSize: 14, fontWeight: '900' },
  tabBar: { backgroundColor: '#071009', borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: 4, paddingBottom: Platform.OS === 'ios' ? 4 : 8, paddingHorizontal: 8, paddingTop: 8 },
  tabButton: { alignItems: 'center', borderColor: 'transparent', borderRadius: 12, borderWidth: 1, flex: 1, gap: 3, justifyContent: 'center', minHeight: 52, paddingHorizontal: 4, paddingVertical: 7 },
  tabButtonActive: { backgroundColor: '#1a2b0c', borderColor: palette.accentMuted },
  tabCount: { backgroundColor: palette.accent, borderRadius: 999, color: palette.ink, fontSize: 10, fontWeight: '900', minWidth: 19, overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 2, textAlign: 'center' },
  tabCountActive: { backgroundColor: palette.text },
  tabLabel: { color: palette.textMuted, fontSize: 11, fontWeight: '800' },
  tabLabelActive: { color: palette.accent },
  unreadCard: { borderColor: palette.accentMuted },
})
