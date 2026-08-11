import 'react-native-url-polyfill/auto'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { AuthProvider, useMobileAuth } from '../mobile-core/src/auth'
import { applyCoachContext, createCoachContextTransition, resolveCoachStaffContext } from '../mobile-core/src/coachContextCore'
import { getCoachNotificationStatusLabel, resolveCoachNotificationOpen } from '../mobile-core/src/coachNotificationsCore'
import { getMobileRuntimeConfig } from '../mobile-core/src/config'
import { useMobileDeviceControls } from '../mobile-core/src/deviceControls'
import { getCoachPhase31GHomeSnapshot } from '../mobile-core/src/coachPhase31GData'
import { MOBILE_STARTUP_STATES } from '../mobile-core/src/startupStateCore'
import { AccessScreen, LoadingScreen, LockedScreen, MobileLoginScreen } from '../mobile-core/src/ui'
import {
  getCoachBackTarget,
  getCoachBottomNavigationPadding,
  getCoachNavigationModel,
  getCoachRouteState,
  resolveCoachRoute,
} from './src/coachNavigationCore'
import { createCoachTheme, DEFAULT_COACH_THEME } from './src/coachThemeCore'
import {
  clearCoachAllLocalState,
  readCoachContextMarker,
  readCoachThemeMode,
  writeCoachContextMarker,
  writeCoachThemeMode,
} from './src/localState'
import { prepareCoachMobileStartup } from './src/startup'
import { CoachCalendarScreen, CoachPlayersScreen, CoachSessionsScreen } from './src/CoachOperationalScreens'
import { CoachMatchDayScreen } from './src/CoachMatchDayScreen'
import { CoachPhase31EScreen } from './src/CoachPhase31EScreens'
import { inspectCoachOfflineState, readCoachOfflineResources, saveCoachOfflineResources } from './src/offline'
import {
  addCoachPushTokenListener,
  enableCoachNotifications,
  initializeCoachNotifications,
  loadCoachNotificationState,
  unbindCoachNotifications,
  updateCoachNotificationPreference,
} from './src/notifications'

const config = getMobileRuntimeConfig('coach')
const defaultThemeContext = createCoachThemeContext(DEFAULT_COACH_THEME)
const CoachThemeContext = createContext(defaultThemeContext)

function useCoachTheme() {
  return useContext(CoachThemeContext)
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function formatDateTime(value, fallback = 'To be confirmed') {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString([], {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: 'Europe/London',
    weekday: 'short',
  })
}

function LoginScreen() {
  const { authError, signIn } = useMobileAuth()
  const handleSignIn = useCallback(async (email, password) => {
    try {
      await signIn(email, password)
    } catch {
      // AuthProvider owns the user-facing error.
    }
  }, [signIn])

  return (
    <MobileLoginScreen
      authError={authError}
      copy="Use the same active staff account you use on the website."
      emailPlaceholder="coach@example.com"
      kicker="Football Player Coach"
      logoSource={require('./assets/football-player-logo.png')}
      meta="Restricted club access."
      signIn={handleSignIn}
      title="Your team. Your match day."
    />
  )
}

function CoachHome() {
  const { authError, isProfileLoading, signOut, user } = useMobileAuth()
  const safeAreaInsets = useSafeAreaInsets()
  const lastNotificationResponse = Notifications.useLastNotificationResponse()
  const [activeRoute, setActiveRoute] = useState('home')
  const [chatNotificationTarget, setChatNotificationTarget] = useState(null)
  const [contextReady, setContextReady] = useState(false)
  const [contextOwnerUserId, setContextOwnerUserId] = useState('')
  const [displayTheme, setDisplayTheme] = useState('dark')
  const [homeState, setHomeState] = useState({ activePolls: 0, developmentRecords: 0, error: '', loading: true, matches: [], nextCalendar: null, pendingAvailability: 0, savedAt: '', sessions: [], stale: false, summary: null, unreadChat: 0, unreadCommunication: 0 })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState('')
  const [moreRoute, setMoreRoute] = useState('')
  const [notice, setNotice] = useState('')
  const [notificationState, setNotificationState] = useState(null)
  const [isRegisteringPush, setIsRegisteringPush] = useState(false)
  const [selectedContextId, setSelectedContextId] = useState('')
  const requestIdRef = useRef(0)
  const notificationResponseIdRef = useRef('')

  const contextResolution = useMemo(
    () => resolveCoachStaffContext({ profile: user, requestedContextId: selectedContextId }),
    [selectedContextId, user],
  )
  const activeContext = contextResolution.allowed ? contextResolution.context : null
  const selectedMobileUser = useMemo(
    () => activeContext && user ? applyCoachContext(user, activeContext) : null,
    [activeContext, user],
  )
  const navigation = useMemo(() => getCoachNavigationModel(activeContext), [activeContext])
  const themeModel = useMemo(
    () => createCoachTheme({ context: activeContext, mode: displayTheme }),
    [activeContext, displayTheme],
  )
  const themeContext = useMemo(() => createCoachThemeContext(themeModel), [themeModel])
  const { palette, styles } = themeContext
  const contextOwnedByCurrentUser = Boolean(user?.id && contextReady && contextOwnerUserId === user.id)
  const handleChatNotificationTargetHandled = useCallback(() => setChatNotificationTarget(null), [])

  const {
    biometricAvailable,
    biometricEnabled,
    isUpdatingBiometrics,
    toggleBiometrics,
  } = useMobileDeviceControls({
    apiBaseUrl: config.apiBaseUrl,
    appRole: 'coach',
    easProjectId: config.easProjectId,
    manageNotifications: false,
    notificationDisabledMessage: 'Coach notifications are disabled on this device.',
    notificationEnabledMessage: 'Coach notifications are enabled for this context.',
    onStatusMessage: setNotice,
    teamId: activeContext?.teamId || '',
  })

  const resetContextDomainState = useCallback(() => {
    requestIdRef.current += 1
    setHomeState({ activePolls: 0, developmentRecords: 0, error: '', loading: true, matches: [], nextCalendar: null, pendingAvailability: 0, savedAt: '', sessions: [], stale: false, summary: null, unreadChat: 0, unreadCommunication: 0 })
    setLastUpdatedAt('')
    setMoreRoute('')
    setChatNotificationTarget(null)
    setNotice('')
  }, [])

  const refreshNotifications = useCallback(async () => {
    if (!activeContext?.id) return null
    try {
      const next = await loadCoachNotificationState({ apiBaseUrl: config.apiBaseUrl, contextId: activeContext.id })
      setNotificationState(next)
      return next
    } catch (error) {
      setNotificationState((current) => ({ ...(current || {}), enabled: false, message: error?.code || 'Coach notifications could not be refreshed.' }))
      return null
    }
  }, [activeContext?.id])

  const enableNotifications = useCallback(async () => {
    if (!activeContext?.id) return
    setIsRegisteringPush(true)
    setNotice('')
    try {
      const next = await enableCoachNotifications({ apiBaseUrl: config.apiBaseUrl, contextId: activeContext.id, easProjectId: config.easProjectId })
      setNotificationState(next)
      setNotice(next.enabled ? 'Coach notifications are enabled for this staff context.' : next.message)
    } catch (error) {
      setNotice(error?.code || 'Coach notifications could not be enabled.')
    } finally { setIsRegisteringPush(false) }
  }, [activeContext?.id])

  const disableNotifications = useCallback(async () => {
    if (!activeContext?.id) return
    setIsRegisteringPush(true)
    try {
      const next = await updateCoachNotificationPreference({ apiBaseUrl: config.apiBaseUrl, contextId: activeContext.id, detailLevel: 'off' })
      setNotificationState(next)
      setNotice('Coach notifications are off.')
    } catch (error) { setNotice(error?.code || 'Coach notifications could not be disabled.') }
    finally { setIsRegisteringPush(false) }
  }, [activeContext?.id])

  const updateNotificationLevel = useCallback(async (detailLevel) => {
    if (!activeContext?.id) return
    setIsRegisteringPush(true)
    try {
      const next = await updateCoachNotificationPreference({ apiBaseUrl: config.apiBaseUrl, contextId: activeContext.id, detailLevel })
      setNotificationState(next)
      setNotice(`Coach notifications set to ${detailLevel}.`)
    } catch (error) { setNotice(error?.code || 'Coach notification preference could not be saved.') }
    finally { setIsRegisteringPush(false) }
  }, [activeContext?.id])

  const loadHome = useCallback(async ({ refresh = false } = {}) => {
    if (!selectedMobileUser?.clubId) return
    const requestId = ++requestIdRef.current
    if (refresh) setIsRefreshing(true)
    setHomeState((current) => ({ ...current, error: '', loading: !refresh }))

    try {
      const snapshot = await getCoachPhase31GHomeSnapshot(selectedMobileUser)
      if (requestId !== requestIdRef.current) return
      const savedAt = new Date().toISOString()
      setHomeState({ ...snapshot, error: '', loading: false, savedAt, stale: false })
      setLastUpdatedAt(savedAt)
      await saveCoachOfflineResources(user.id, activeContext, { home: { ...snapshot, savedAt } }).catch(() => {})
      if (refresh) setNotice('Latest Coach overview loaded.')
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      const cached = await readCoachOfflineResources(user.id, activeContext).catch(() => null)
      const home = cached?.resources?.home
      if (home) {
        setHomeState({ ...home, error: '', loading: false, savedAt: home.savedAt || cached.savedAt, stale: true })
        setLastUpdatedAt(home.savedAt || cached.savedAt)
        setNotice('Offline. Showing the last encrypted Coach overview. Refresh when online.')
      } else {
        setHomeState((current) => ({ ...current, error: error?.message || 'Coach overview could not be loaded.', loading: false }))
      }
    } finally {
      if (requestId === requestIdRef.current) setIsRefreshing(false)
    }
  }, [activeContext, selectedMobileUser, user?.id])

  const navigate = useCallback((route) => {
    setChatNotificationTarget(null)
    const resolved = resolveCoachRoute(route, activeContext)
    if (!resolved) {
      setNotice('That destination is not available in this staff context.')
      return false
    }
    const target = getCoachRouteState(resolved)
    setNotice('')
    setActiveRoute(target.activeRoute)
    setMoreRoute(target.moreRoute)
    return true
  }, [activeContext])

  const openCoachTarget = useCallback((data) => {
    const result = resolveCoachNotificationOpen(data, {
      activeContextId: activeContext?.id,
      availableTargets: {
        matchday: (homeState.matches || []).map((item) => item.id),
        sessions: (homeState.sessions || []).map((item) => item.id),
      },
      contexts: contextResolution.contexts,
    })
    if (!result.allowed) {
      setNotice('This Coach destination is stale or no longer authorised.')
      return false
    }
    const targetContext = contextResolution.contexts.find((context) => context.id === result.contextId)
    const resolved = resolveCoachRoute(result.route, targetContext)
    if (!targetContext || !resolved) {
      setNotice('This Coach destination is not available in the current staff role.')
      return false
    }
    if (targetContext.id !== activeContext?.id) {
      resetContextDomainState()
      setSelectedContextId(targetContext.id)
    }
    const target = getCoachRouteState(resolved)
    setActiveRoute(target.activeRoute)
    setMoreRoute(target.moreRoute)
    setChatNotificationTarget(result.route === 'chat' && result.targetId
      ? {
          contextId: result.contextId,
          id: result.targetId,
          kind: result.chatKind,
        }
      : null)
    return true
  }, [activeContext?.id, contextResolution.contexts, homeState.matches, homeState.sessions, resetContextDomainState])

  useEffect(() => {
    let mounted = true
    setContextReady(false)
    resetContextDomainState()
    void Promise.all([
      readCoachThemeMode(),
      user?.id ? readCoachContextMarker(user.id) : Promise.resolve(null),
    ]).then(([mode, marker]) => {
      if (!mounted) return
      setDisplayTheme(mode)
      const available = Array.isArray(user?.coachContexts) ? user.coachContexts : []
      const nextContextId = available.some((context) => context.id === marker?.contextId)
        ? marker.contextId
        : normalizeText(user?.activeCoachContextId || available[0]?.id)
      setSelectedContextId(nextContextId)
      setContextOwnerUserId(user?.id || '')
      setContextReady(true)
    }).catch(() => {
      if (mounted) {
        setContextOwnerUserId(user?.id || '')
        setContextReady(true)
      }
    })
    return () => { mounted = false }
  }, [resetContextDomainState, user])

  useEffect(() => {
    if (!activeContext || !user?.id || !contextOwnedByCurrentUser) return
    void writeCoachContextMarker(user.id, activeContext).catch(() => {})
    void loadHome()
  }, [activeContext, contextOwnedByCurrentUser, loadHome, user?.id])

  useEffect(() => {
    void initializeCoachNotifications().catch(() => {})
  }, [])

  useEffect(() => {
    if (!activeContext?.id || !contextOwnedByCurrentUser) return undefined
    void refreshNotifications().then((next) => {
      if (next?.registered && next.requiresContextRefresh && next.permissionGranted && next.detailLevel !== 'off') {
        void enableNotifications()
      }
    })
    const subscription = addCoachPushTokenListener(() => {
      if (notificationState?.registered) void enableNotifications()
    })
    return () => subscription.remove()
  }, [activeContext?.id, contextOwnedByCurrentUser, enableNotifications, notificationState?.registered, refreshNotifications])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && contextOwnedByCurrentUser && selectedMobileUser?.clubId) {
        void loadHome({ refresh: true })
        void refreshNotifications()
      }
    })
    return () => subscription.remove()
  }, [contextOwnedByCurrentUser, loadHome, refreshNotifications, selectedMobileUser?.clubId])

  useEffect(() => {
    if (!contextOwnedByCurrentUser || contextResolution.contexts.length === 0) return
    const request = lastNotificationResponse?.notification?.request
    const responseId = normalizeText(request?.identifier)
    if (!responseId || notificationResponseIdRef.current === responseId) return
    const data = request?.content?.data
    if (!data) return
    openCoachTarget(data)
    notificationResponseIdRef.current = responseId
  }, [contextOwnedByCurrentUser, contextResolution.contexts.length, lastNotificationResponse, openCoachTarget])

  useEffect(() => {
    const openUrl = ({ url }) => {
      try {
        const parsed = new URL(url)
        openCoachTarget({
          app: 'coach',
          contextId: parsed.searchParams.get('contextId') || '',
          conversationId: parsed.searchParams.get('conversationId') || '',
          route: parsed.searchParams.get('route') || parsed.pathname.split('/').filter(Boolean).at(-1) || '',
          roomId: parsed.searchParams.get('roomId') || '',
          targetId: parsed.searchParams.get('targetId') || '',
          teamId: parsed.searchParams.get('teamId') || '',
          type: parsed.searchParams.get('type') || '',
        })
      } catch {
        setNotice('This Coach link could not be opened safely.')
      }
    }
    const subscription = Linking.addEventListener('url', openUrl)
    void Linking.getInitialURL().then((url) => { if (url) openUrl({ url }) }).catch(() => {})
    return () => subscription.remove()
  }, [openCoachTarget])

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const target = getCoachBackTarget({ activeRoute, moreRoute })
      if (!target) return false
      setActiveRoute(target.activeRoute)
      setMoreRoute(target.moreRoute)
      return true
    })
    return () => subscription.remove()
  }, [activeRoute, moreRoute])

  const selectContext = useCallback((contextId) => {
    const nextContext = contextResolution.contexts?.find((context) => context.id === contextId)
    if (!nextContext) {
      setNotice('That staff context is no longer available.')
      return
    }
    const transition = createCoachContextTransition(activeContext, nextContext)
    if (transition.clearDomainState) resetContextDomainState()
    const currentDestination = moreRoute || activeRoute
    const preserved = resolveCoachRoute(currentDestination, nextContext)
    const target = preserved ? getCoachRouteState(preserved) : { activeRoute: 'home', moreRoute: '' }
    setActiveRoute(target.activeRoute)
    setMoreRoute(target.moreRoute)
    setSelectedContextId(nextContext.id)
  }, [activeContext, activeRoute, contextResolution.contexts, moreRoute, resetContextDomainState])

  const toggleTheme = useCallback(async () => {
    const next = displayTheme === 'dark' ? 'light' : 'dark'
    setDisplayTheme(next)
    try {
      await writeCoachThemeMode(next)
    } catch {
      setNotice('Theme preference could not be saved on this device.')
    }
  }, [displayTheme])

  if (isProfileLoading) return <LoadingScreen message="Resolving staff access..." />
  if (!user) {
    return (
      <AccessScreen
        message={authError || 'An active Coach, Team Admin, Manager, or Club Admin membership is required.'}
        onSignOut={signOut}
        title="Coach access unavailable"
      />
    )
  }
  if (!contextOwnedByCurrentUser) return <LoadingScreen message="Resolving staff access..." />
  if (!contextResolution.allowed) {
    return (
      <AccessScreen
        message={authError || 'An active operational staff context is required.'}
        onSignOut={signOut}
        title="Coach access unavailable"
      />
    )
  }

  return (
    <CoachThemeContext.Provider value={themeContext}>
      <SafeAreaView edges={['top', 'right', 'left']} style={styles.appShell}>
        <StatusBar style={themeModel.mode === 'dark' ? 'light' : 'dark'} />
        <CoachHeader context={activeContext} user={selectedMobileUser} />
        <ContextSwitcher
          contexts={contextResolution.contexts}
          onSelect={selectContext}
          selectedContextId={activeContext.id}
        />
        {activeContext.paymentAccess.state === 'payment_required' ? (
          <StatePanel
            message="Viewing remains available, but operational changes are blocked until plan access is restored."
            title="Payment required"
            tone="warning"
          />
        ) : null}
        {notice ? <Notice message={notice} onDismiss={() => setNotice('')} /> : null}
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={(
            <RefreshControl
              colors={[palette.accent]}
              onRefresh={() => loadHome({ refresh: true })}
              refreshing={isRefreshing}
              tintColor={palette.accent}
            />
          )}
        >
          <CoachRoute
            activeRoute={activeRoute}
            biometricAvailable={biometricAvailable}
            biometricEnabled={biometricEnabled}
            context={activeContext}
            contexts={contextResolution.contexts}
            chatNotificationTarget={chatNotificationTarget}
            disableNotifications={disableNotifications}
            enableNotifications={enableNotifications}
            homeState={homeState}
            isRegisteringPush={isRegisteringPush}
            isUpdatingBiometrics={isUpdatingBiometrics}
            lastUpdatedAt={lastUpdatedAt}
            moreRoute={moreRoute}
            navigation={navigation}
            notificationState={notificationState}
            onChatNotificationTargetHandled={handleChatNotificationTargetHandled}
            onNavigate={navigate}
            onSelectContext={selectContext}
            onSelectMore={navigate}
            onSignOut={signOut}
            onToggleBiometrics={toggleBiometrics}
            onToggleTheme={toggleTheme}
            onUpdateNotificationLevel={updateNotificationLevel}
            reloadHome={loadHome}
            themeMode={displayTheme}
            user={selectedMobileUser}
          />
        </ScrollView>
        <PrimaryNavigation activeRoute={activeRoute} bottomInset={safeAreaInsets.bottom} navigation={navigation.primary} onNavigate={navigate} platform={Platform.OS} />
      </SafeAreaView>
    </CoachThemeContext.Provider>
  )
}

function CoachRoute(props) {
  const { activeRoute, moreRoute } = props
  const { palette } = useCoachTheme()
  if (activeRoute === 'home') return <HomeScreen {...props} />
  if (activeRoute === 'calendar') return <CoachCalendarScreen {...props} key={props.context.id} palette={palette} />
  if (activeRoute === 'players') return <CoachPlayersScreen {...props} key={props.context.id} palette={palette} />
  if (activeRoute === 'matchday') return <CoachMatchDayScreen {...props} key={props.context.id} palette={palette} />
  if (activeRoute === 'sessions') return <CoachSessionsScreen {...props} key={props.context.id} palette={palette} />
  if (activeRoute === 'more') {
    if (['development', 'resources', 'chat', 'messages', 'polls', 'invites'].includes(moreRoute)) {
      return <CoachPhase31EScreen {...props} domain={moreRoute} key={`${props.context.id}:${moreRoute}`} palette={palette} />
    }
    return moreRoute ? <FoundationRoute route={moreRoute} {...props} /> : <MoreScreen {...props} />
  }
  return <FoundationRoute route={activeRoute} {...props} />
}

function HomeScreen({ context, homeState, onNavigate, reloadHome, user }) {
  const { styles } = useCoachTheme()
  const nextMatch = homeState.nextMatch || homeState.matches[0]
  const nextSession = homeState.nextSession || homeState.sessions[0]
  const nextCalendar = homeState.nextCalendar

  return (
    <View style={styles.stack}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{context.roleLabel}</Text>
        <Text accessibilityRole="header" style={styles.heroTitle}>Hi {user.displayName || user.name}.</Text>
        <Text style={styles.bodyText}>{context.teamId ? `${context.teamName} is ready.` : `${context.clubName} overview.`}</Text>
      </View>
      {homeState.stale ? (
        <StatePanel
          actionLabel="Refresh when online"
          message={`Last updated ${formatDateTime(homeState.savedAt, 'time unavailable')}. Match and availability information may have changed.`}
          onAction={() => reloadHome({ refresh: true })}
          title="Offline, stale data"
          tone="warning"
        />
      ) : null}
      {homeState.loading ? <LoadingPanel message="Loading your Coach overview..." /> : null}
      {homeState.error ? <StatePanel actionLabel="Try again" message={homeState.error} onAction={reloadHome} title="Overview unavailable" tone="danger" /> : null}
      {homeState.partial && !homeState.stale ? <StatePanel actionLabel="Refresh" message="The main overview is available, but one or more supporting summaries could not be refreshed." onAction={() => reloadHome({ refresh: true })} title="Some summaries are unavailable" tone="warning" /> : null}
      {!homeState.loading ? (
        <View style={styles.statGrid}>
          <StatCard label="Players" value={homeState.summary?.activePlayers || 0} />
          <StatCard label="Sessions" value={homeState.summary?.sessions || 0} />
          <StatCard label="Matches" value={homeState.summary?.matches || 0} />
          <StatCard label="Teams" value={homeState.summary?.teams || 0} />
        </View>
      ) : null}
      <Section title="Coming up">
        <PreviewCard
          actionLabel="Open Calendar"
          detail={nextCalendar ? `${formatDateTime(nextCalendar.startsAt)} | ${nextCalendar.title || 'Calendar item'}` : 'No upcoming Calendar item is available.'}
          onAction={() => onNavigate('calendar')}
          title="Next Calendar item"
        />
        {context.teamId ? (
          <>
            <PreviewCard
              actionLabel="Open Match Day"
              detail={nextMatch ? `${formatDateTime(nextMatch.matchDate || nextMatch.match_date)} | ${nextMatch.opponent || 'Opponent to be confirmed'}` : 'No upcoming match is available.'}
              onAction={() => onNavigate('matchday')}
              title="Next match"
            />
            <PreviewCard
              actionLabel="Open Sessions"
              detail={nextSession ? `${formatDateTime(nextSession.sessionDate || nextSession.session_date)} | ${nextSession.title || nextSession.type || 'Training session'}` : 'No upcoming session is available.'}
              onAction={() => onNavigate('sessions')}
              title="Next session"
            />
          </>
        ) : <EmptyPanel message="Choose a Team context to see Team fixtures, Players, and Sessions." title="Club overview" />}
      </Section>
      <Section title="Operational attention">
        <View style={styles.statGrid}>
          <StatCard label="Availability pending" value={homeState.pendingAvailability || 0} />
          <StatCard label="Active Polls" value={homeState.activePolls || 0} />
          <StatCard label="Unread Chat" value={homeState.unreadChat || 0} />
          <StatCard label="Development records" value={homeState.developmentRecords || 0} />
        </View>
        <View style={styles.quickGrid}>
          <SecondaryAction label="Availability" onPress={() => onNavigate('invites')} />
          <SecondaryAction label="Chat" onPress={() => onNavigate('chat')} />
          <SecondaryAction label="Polls" onPress={() => onNavigate('polls')} />
          <SecondaryAction label="Development" onPress={() => onNavigate('development')} />
        </View>
        <Text style={styles.helperText}>Communication history unread: {homeState.unreadCommunication || 0}. Counts come from the completed canonical domain adapters.</Text>
      </Section>
      <Section title="Quick access">
        <View style={styles.quickGrid}>
          {['calendar', 'players', 'matchday', 'development'].map((route) => (
            <SecondaryAction key={route} label={route === 'matchday' ? 'Match Day' : `${route.charAt(0).toUpperCase()}${route.slice(1)}`} onPress={() => onNavigate(route)} />
          ))}
        </View>
      </Section>
    </View>
  )
}

function FoundationRoute({ context, route, ...props }) {
  const { styles } = useCoachTheme()
  const titles = {
    calendar: 'Calendar', chat: 'Chat', club: 'Club', development: 'Development', matchday: 'Match Day', payment: 'Plan access',
    invites: 'Invites and availability', messages: 'Messages', players: 'Players', polls: 'Polls', resources: 'Resources', sessions: 'Sessions', settings: 'Settings', team: 'Team',
  }
  if (route === 'settings') return <SettingsScreen context={context} {...props} />
  if (route === 'team') {
    return (
      <ScreenIntro copy="Canonical Team identity, operational scope, branding, and governed administration boundary." title="Team">
        <Section title="Current Team">
          <InfoRow label="Team" value={context.teamName || 'Team'} />
          <InfoRow label="Club" value={context.clubName} />
          <InfoRow label="Role" value={context.roleLabel} />
          <InfoRow label="Plan access" value={context.paymentAccess.state} />
          <InfoRow label="Branding" value={context.teamAccent ? 'Team accent' : context.clubAccent ? 'Club accent' : 'Football Player fallback'} />
        </Section>
        <Section title="Operational Team tools">
          <View style={styles.quickGrid}>
            <SecondaryAction label="Players" onPress={() => props.onNavigate('players')} />
            <SecondaryAction label="Sessions" onPress={() => props.onNavigate('sessions')} />
            <SecondaryAction label="Resources" onPress={() => props.onNavigate('resources')} />
          </View>
          <Text style={styles.helperText}>Staff assignment, squad governance, Team transfer, archive, and destructive administration remain in the authoritative web workflow.</Text>
        </Section>
      </ScreenIntro>
    )
  }
  if (route === 'club') {
    return (
      <ScreenIntro copy="Canonical Club identity, branding, operational scope, and governed administration boundary." title="Club">
        <Section title="Current Club">
          <InfoRow label="Club" value={context.clubName} />
          <InfoRow label="Role" value={context.roleLabel} />
          <InfoRow label="Workspace" value={context.workspaceScope} />
          <InfoRow label="Plan access" value={context.paymentAccess.state} />
          <InfoRow label="Branding" value={context.clubAccent ? 'Club accent' : 'Football Player fallback'} />
        </Section>
        <Section title="Operational Club tools">
          <SecondaryAction label="Club Calendar" onPress={() => props.onNavigate('calendar')} />
          <SecondaryAction label="Resources" onPress={() => props.onNavigate('resources')} />
          <SecondaryAction label="Chat" onPress={() => props.onNavigate('chat')} />
          <Text style={styles.helperText}>Club-wide staff, plan ownership, archive, and settings administration remain in the authoritative web workflow.</Text>
        </Section>
      </ScreenIntro>
    )
  }
  if (route === 'payment') {
    return (
      <ScreenIntro copy="Read-only plan state and exact payer authority. Financial changes remain on the authoritative web flow." title="Plan access">
        <Section title="Current access">
          <InfoRow label="Status" value={context.paymentAccess.state} />
          <InfoRow label="Plan" value={context.planKey || 'No active plan key'} />
          <InfoRow label="Payer authority" value={context.paymentAccess.payerAuthority} />
          <InfoRow label="Operational changes" value={context.paymentAccess.canMutate ? 'Allowed' : 'Blocked'} />
          <Text style={styles.helperText}>Ordinary Coaches cannot gain plan purchase control. Payment methods, coupons, and ownership changes remain web-only.</Text>
        </Section>
      </ScreenIntro>
    )
  }
  return (
    <ScreenIntro copy="This route is not part of the final authorised Coach mobile navigation contract." title={titles[route] || 'Coach'}>
      <StatePanel
        message="Return to Home and use the visible role-scoped navigation. No hidden route is available."
        title="Route unavailable"
        tone="warning"
      />
    </ScreenIntro>
  )
}

function MoreScreen({ navigation, onSelectMore }) {
  const { styles } = useCoachTheme()
  return (
    <ScreenIntro copy="Open the staff tools available for this role and context." title="More">
      <View style={styles.stackTight}>
        {navigation.more.map((route) => <MenuRow key={route.key} label={route.label} onPress={() => onSelectMore(route.key)} />)}
      </View>
    </ScreenIntro>
  )
}

function SettingsScreen({
  biometricAvailable,
  biometricEnabled,
  context,
  disableNotifications,
  enableNotifications,
  isRegisteringPush,
  isUpdatingBiometrics,
  lastUpdatedAt,
  notificationState,
  onSignOut,
  onToggleBiometrics,
  onToggleTheme,
  onUpdateNotificationLevel,
  themeMode,
  user,
}) {
  const { styles } = useCoachTheme()
  const build = Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || 'development'
  const [cacheState, setCacheState] = useState(null)
  useEffect(() => {
    let mounted = true
    void inspectCoachOfflineState(user.id).then((state) => { if (mounted) setCacheState(state) }).catch(() => { if (mounted) setCacheState({ hasDocument: false, status: 'unavailable' }) })
    return () => { mounted = false }
  }, [lastUpdatedAt, user.id])
  return (
    <ScreenIntro copy="Account, device security, notifications, sync, and app information." title="Settings">
      <Section title="Account">
        <InfoRow label="Name" value={user.displayName || user.name} />
        <InfoRow label="Email" value={user.email} />
        <InfoRow label="Role" value={context.roleLabel} />
        <InfoRow label="Context" value={context.teamName || context.clubName} />
      </Section>
      <Section title="Appearance">
        <SettingRow copy="Use a complete semantic light or dark palette." label={`Light mode ${themeMode === 'light' ? 'on' : 'off'}`}>
          <Switch accessibilityLabel="Toggle light mode" onValueChange={onToggleTheme} value={themeMode === 'light'} />
        </SettingRow>
      </Section>
      <Section title="Device security">
        <SettingRow copy={biometricAvailable ? 'Require local device authentication after backgrounding.' : 'Biometric authentication is unavailable on this device.'} label="Biometric lock">
          <Switch disabled={!biometricAvailable || isUpdatingBiometrics} onValueChange={onToggleBiometrics} value={biometricEnabled} />
        </SettingRow>
      </Section>
      <Section title="Notifications">
        <InfoRow label="Status" value={getCoachNotificationStatusLabel(notificationState || {})} />
        <Text style={styles.bodyText}>{notificationState?.registered ? 'Registered to this Coach installation and staff context.' : notificationState?.message || 'Not enabled on this device.'}</Text>
        {notificationState?.registered ? (
          <View style={styles.quickGrid}>
            {['minimal', 'detailed'].map((level) => (
              <SecondaryAction disabled={isRegisteringPush} key={level} label={level === 'minimal' ? 'Minimal privacy' : 'Detailed'} onPress={() => onUpdateNotificationLevel(level)} />
            ))}
          </View>
        ) : null}
        {notificationState?.enabled
          ? <SecondaryAction disabled={isRegisteringPush} label="Disable notifications" onPress={disableNotifications} />
          : <PrimaryAction disabled={isRegisteringPush} label="Enable notifications" onPress={enableNotifications} />}
        <Text style={styles.helperText}>Minimal is the conservative default. Lock-screen copy excludes Player names, Parent contacts, Chat bodies, and Development notes.</Text>
      </Section>
      <Section title="Sync and environment">
        <InfoRow label="Last refreshed" value={lastUpdatedAt ? formatDateTime(lastUpdatedAt) : 'Not yet refreshed'} />
        <InfoRow label="Encrypted cache" value={cacheState?.hasDocument ? `Ready, schema ${cacheState.schemaVersion}` : cacheState?.status || 'Checking'} />
        <InfoRow label="Cache ownership" value="Coach, user, environment, Club, Team, context, and resource isolated" />
        <InfoRow label="Environment" value={config.isProduction ? 'Production' : 'Test only'} />
        <InfoRow label="Production access" value={config.isProduction ? 'True' : 'False'} />
        <InfoRow label="Offline changes" value="High-risk changes require an online authority check" />
      </Section>
      <Section title="App">
        <InfoRow label="Branding" value={`${context.clubName}${context.teamName ? ` | ${context.teamName}` : ''}`} />
        <InfoRow label="Accent source" value={context.teamAccent ? 'Team accent' : context.clubAccent ? 'Club accent' : 'Football Player fallback'} />
        <InfoRow label="Version" value={Constants.expoConfig?.version || 'development'} />
        <InfoRow label="Build" value={String(build)} />
      </Section>
      <SecondaryAction label="Log out" onPress={onSignOut} />
    </ScreenIntro>
  )
}

function CoachHeader({ context, user }) {
  const { branding, styles } = useCoachTheme()
  const source = branding.logoUrl ? { uri: branding.logoUrl } : require('./assets/football-player-logo.png')
  return (
    <View style={styles.header}>
      <Image accessibilityLabel={`${context.clubName} logo`} source={source} style={styles.logo} />
      <View style={styles.headerCopy}>
        <Text numberOfLines={1} style={styles.headerTitle}>{context.clubName}</Text>
        <Text numberOfLines={1} style={styles.headerMeta}>{context.teamName || 'Club context'} | {user.roleLabel}</Text>
      </View>
      <View style={styles.testBadge}><Text style={styles.testBadgeText}>{config.isProduction ? 'LIVE' : 'TEST'}</Text></View>
    </View>
  )
}

function ContextSwitcher({ contexts, onSelect, selectedContextId }) {
  const { styles } = useCoachTheme()
  if (contexts.length < 2) return null
  return (
    <View style={styles.contextShell}>
      <Text style={styles.contextLabel}>Active staff context</Text>
      <ScrollView contentContainerStyle={styles.contextList} horizontal showsHorizontalScrollIndicator={false}>
        {contexts.map((context) => {
          const selected = context.id === selectedContextId
          return (
            <Pressable
              accessibilityHint="Changes the active staff Team or Club context"
              accessibilityLabel={`${context.teamName || context.clubName}, ${context.roleLabel}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={context.id}
              onPress={() => onSelect(context.id)}
              style={({ pressed }) => [styles.contextOption, selected && styles.contextOptionSelected, pressed && styles.pressed]}
            >
              <Text style={[styles.contextOptionTitle, selected && styles.contextOptionTitleSelected]}>{context.teamName || context.clubName}</Text>
              <Text style={[styles.contextOptionMeta, selected && styles.contextOptionMetaSelected]}>{context.roleLabel}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

function PrimaryNavigation({ activeRoute, bottomInset, navigation, onNavigate, platform }) {
  const { styles } = useCoachTheme()
  return (
    <View accessibilityRole="tablist" style={[styles.tabBar, { paddingBottom: getCoachBottomNavigationPadding(bottomInset, platform) }]}>
      {navigation.map((route) => {
        const selected = route.key === activeRoute
        return (
          <Pressable
            accessibilityLabel={`${route.label} tab`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={route.key}
            onPress={() => onNavigate(route.key)}
            style={({ pressed }) => [styles.tab, selected && styles.tabSelected, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={[styles.tabText, selected && styles.tabTextSelected]}>{route.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function ScreenIntro({ children, copy, title }) {
  const { styles } = useCoachTheme()
  return (
    <View style={styles.stack}>
      <View style={styles.screenIntro}>
        <Text accessibilityRole="header" style={styles.screenTitle}>{title}</Text>
        <Text style={styles.bodyText}>{copy}</Text>
      </View>
      {children}
    </View>
  )
}

function Section({ children, title }) {
  const { styles } = useCoachTheme()
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function StatCard({ label, value }) {
  const { styles } = useCoachTheme()
  return <View style={styles.statCard}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>
}

function PreviewCard({ actionLabel, detail, onAction, title }) {
  const { styles } = useCoachTheme()
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.bodyText}>{detail}</Text>
      <SecondaryAction label={actionLabel} onPress={onAction} />
    </View>
  )
}

function MenuRow({ label, onPress }) {
  const { styles } = useCoachTheme()
  return (
    <Pressable accessibilityHint={`Open ${label}`} accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
      <Text style={styles.menuText}>{label}</Text><Text style={styles.menuArrow}>›</Text>
    </Pressable>
  )
}

function InfoRow({ label, value }) {
  const { styles } = useCoachTheme()
  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text selectable style={styles.infoValue}>{value}</Text></View>
}

function SettingRow({ children, copy, label }) {
  const { styles } = useCoachTheme()
  return (
    <View style={styles.settingRow}><View style={styles.settingCopy}><Text style={styles.cardTitle}>{label}</Text><Text style={styles.helperText}>{copy}</Text></View>{children}</View>
  )
}

function LoadingPanel({ message }) {
  const { palette, styles } = useCoachTheme()
  return <View accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.statePanel}><ActivityIndicator color={palette.accent} /><Text style={styles.bodyText}>{message}</Text></View>
}

function EmptyPanel({ message, title }) {
  return <StatePanel message={message} title={title} />
}

function StatePanel({ actionLabel = '', message, onAction, title, tone = 'neutral' }) {
  const { styles } = useCoachTheme()
  return (
    <View accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'} style={[styles.statePanel, tone === 'warning' && styles.stateWarning, tone === 'danger' && styles.stateDanger]}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.bodyText}>{message}</Text>
      {actionLabel && onAction ? <SecondaryAction label={actionLabel} onPress={onAction} /> : null}
    </View>
  )
}

function Notice({ message, onDismiss }) {
  const { styles } = useCoachTheme()
  return (
    <View accessibilityLiveRegion="polite" style={styles.notice}>
      <Text style={styles.noticeText}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.noticeDismiss}><Text style={styles.noticeDismissText}>Dismiss</Text></Pressable>
    </View>
  )
}

function PrimaryAction({ disabled = false, label, onPress }) {
  const { styles } = useCoachTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryAction, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={styles.primaryActionText}>{label}</Text>
    </Pressable>
  )
}

function SecondaryAction({ disabled = false, label, onPress }) {
  const { styles } = useCoachTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.secondaryAction, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={styles.secondaryActionText}>{label}</Text>
    </Pressable>
  )
}

function StartupRecoveryScreen({ diagnosticCode, message, onReset, onRetry, showReset = true }) {
  const theme = defaultThemeContext
  return (
    <CoachThemeContext.Provider value={theme}>
      <View style={theme.styles.startupRecovery}>
        <View accessibilityLiveRegion="assertive" style={theme.styles.startupCard}>
          <Text style={theme.styles.eyebrow}>Football Player Coach</Text>
          <Text style={theme.styles.screenTitle}>Something went wrong</Text>
          <Text style={theme.styles.bodyText}>{message || 'The Coach app could not finish starting safely.'}</Text>
          <Text selectable style={theme.styles.diagnostic}>Code {diagnosticCode || 'COACH_STARTUP_FAILED'} | Version {Constants.expoConfig?.version || 'unknown'}</Text>
          <PrimaryAction label="Try again" onPress={onRetry} />
          {showReset ? <SecondaryAction label="Reset local app data" onPress={onReset} /> : null}
          {showReset ? <Text style={theme.styles.helperText}>This affects only saved Coach app information on this device. Football Player records are not changed.</Text> : null}
        </View>
      </View>
    </CoachThemeContext.Provider>
  )
}

class CoachRootErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Coach root render failed.', error?.name || 'unknown', error?.message || 'No message', info?.componentStack || 'No component stack')
  }

  render() {
    if (this.state.hasError) {
      return (
        <StartupRecoveryScreen
          diagnosticCode="COACH_ROOT_RENDER_FAILED"
          message="The Coach app could not display its first screen safely."
          onReset={() => this.setState({ hasError: false })}
          onRetry={() => this.setState({ hasError: false })}
          showReset={false}
        />
      )
    }
    return this.props.children
  }
}

function AppContent() {
  const {
    authError,
    isLocked,
    resetLocalAppData,
    retryStartup,
    session,
    startupDiagnosticCode,
    startupState,
    unlockWithBiometrics,
  } = useMobileAuth()

  if ([MOBILE_STARTUP_STATES.BOOTING, MOBILE_STARTUP_STATES.RESTORING_SESSION, MOBILE_STARTUP_STATES.RESOLVING_STAFF_CONTEXT].includes(startupState)) {
    return <LoadingScreen message={startupState === MOBILE_STARTUP_STATES.RESOLVING_STAFF_CONTEXT ? 'Resolving staff context...' : 'Loading Football Player Coach...'} />
  }
  if (startupState === MOBILE_STARTUP_STATES.RECOVERABLE_ERROR) {
    return <StartupRecoveryScreen diagnosticCode={startupDiagnosticCode} message={authError} onReset={resetLocalAppData} onRetry={retryStartup} />
  }
  if (!session?.user) return <LoginScreen />
  if (isLocked) return <LockedScreen errorMessage={authError} logoSource={require('./assets/football-player-logo.png')} onUnlock={unlockWithBiometrics} />
  return <CoachHome />
}

async function clearCoachBeforeSignOut({ accessToken, apiBaseUrl }) {
  await unbindCoachNotifications({ accessToken, apiBaseUrl }).catch(() => {})
  await clearCoachAllLocalState()
}

export default function App() {
  // Secure-session integration contract: <AuthProvider appRole="coach">
  return (
    <SafeAreaProvider>
      <CoachRootErrorBoundary>
        <AuthProvider
          appRole="coach"
          onBeforeSignOut={clearCoachBeforeSignOut}
          onResetLocalData={clearCoachAllLocalState}
          prepareStartup={prepareCoachMobileStartup}
        >
          <AppContent />
        </AuthProvider>
      </CoachRootErrorBoundary>
    </SafeAreaProvider>
  )
}

function createCoachThemeContext(theme) {
  const palette = theme.tokens
  return Object.freeze({ ...theme, palette, styles: createCoachStyles(palette) })
}

function createCoachStyles(palette) {
  return StyleSheet.create({
    appShell: { backgroundColor: palette.background, flex: 1 },
    bodyText: { color: palette.textSecondary, fontSize: 15, lineHeight: 22 },
    card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 18, borderWidth: 1, gap: 10, padding: 16 },
    cardTitle: { color: palette.textPrimary, fontSize: 16, fontWeight: '900', lineHeight: 21 },
    content: { alignSelf: 'center', maxWidth: 720, paddingBottom: 28, paddingHorizontal: 16, paddingTop: 16, width: '100%' },
    contextLabel: { color: palette.textMuted, fontSize: 11, fontWeight: '900', letterSpacing: 0.6, paddingHorizontal: 16, textTransform: 'uppercase' },
    contextList: { gap: 8, paddingHorizontal: 16, paddingVertical: 9 },
    contextOption: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 14, borderWidth: 1, minHeight: 54, minWidth: 142, paddingHorizontal: 13, paddingVertical: 8 },
    contextOptionMeta: { color: palette.textMuted, fontSize: 11, fontWeight: '700', marginTop: 2 },
    contextOptionMetaSelected: { color: palette.selectedForeground },
    contextOptionSelected: { backgroundColor: palette.selected, borderColor: palette.accent },
    contextOptionTitle: { color: palette.textPrimary, fontSize: 14, fontWeight: '900' },
    contextOptionTitleSelected: { color: palette.selectedForeground },
    contextShell: { backgroundColor: palette.background, borderBottomColor: palette.border, borderBottomWidth: 1, paddingTop: 6 },
    diagnostic: { color: palette.textMuted, fontFamily: 'monospace', fontSize: 12 },
    disabled: { opacity: 0.48 },
    eyebrow: { color: palette.accent, fontSize: 12, fontWeight: '900', letterSpacing: 0.9, textTransform: 'uppercase' },
    header: { alignItems: 'center', backgroundColor: palette.surface, borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: 12, minHeight: 72, paddingHorizontal: 16, paddingVertical: 10 },
    headerCopy: { flex: 1, minWidth: 0 },
    headerMeta: { color: palette.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 2 },
    headerTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '900' },
    helperText: { color: palette.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 18 },
    hero: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 22, borderWidth: 1, gap: 8, padding: 20 },
    heroTitle: { color: palette.textPrimary, fontSize: 32, fontWeight: '900', letterSpacing: -0.8, lineHeight: 38 },
    infoLabel: { color: palette.textMuted, fontSize: 13, fontWeight: '700' },
    infoRow: { alignItems: 'flex-start', borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: 12, justifyContent: 'space-between', paddingTop: 11 },
    infoValue: { color: palette.textPrimary, flex: 1, fontSize: 14, fontWeight: '800', textAlign: 'right' },
    logo: { height: 44, width: 44 },
    menuArrow: { color: palette.accent, fontSize: 26, fontWeight: '900' },
    menuRow: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 15, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: 15 },
    menuText: { color: palette.textPrimary, fontSize: 15, fontWeight: '900' },
    notice: { alignItems: 'center', backgroundColor: palette.selected, borderBottomColor: palette.accent, borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
    noticeDismiss: { minHeight: 36, paddingHorizontal: 6, justifyContent: 'center' },
    noticeDismissText: { color: palette.accent, fontSize: 12, fontWeight: '900' },
    noticeText: { color: palette.textPrimary, flex: 1, fontSize: 13, fontWeight: '800', lineHeight: 18 },
    pressed: { opacity: 0.76 },
    primaryAction: { alignItems: 'center', backgroundColor: palette.accent, borderColor: palette.accent, borderRadius: 14, borderWidth: 1, justifyContent: 'center', minHeight: 50, paddingHorizontal: 15, paddingVertical: 12 },
    primaryActionText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900' },
    quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
    screenIntro: { gap: 5 },
    screenTitle: { color: palette.textPrimary, fontSize: 29, fontWeight: '900', letterSpacing: -0.5 },
    secondaryAction: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 14, borderWidth: 1, justifyContent: 'center', minHeight: 48, minWidth: 118, paddingHorizontal: 14, paddingVertical: 11 },
    secondaryActionText: { color: palette.textPrimary, fontSize: 14, fontWeight: '900' },
    section: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 18, borderWidth: 1, gap: 11, padding: 16 },
    sectionTitle: { color: palette.textPrimary, fontSize: 20, fontWeight: '900' },
    settingCopy: { flex: 1, gap: 4 },
    settingRow: { alignItems: 'center', flexDirection: 'row', gap: 14 },
    stack: { gap: 14 },
    stackTight: { gap: 9 },
    startupCard: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 20, borderWidth: 1, gap: 14, maxWidth: 520, padding: 22, width: '100%' },
    startupRecovery: { alignItems: 'center', backgroundColor: palette.background, flex: 1, justifyContent: 'center', padding: 20 },
    statCard: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 17, borderWidth: 1, flex: 1, gap: 4, minHeight: 104, minWidth: 138, padding: 15 },
    statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    statLabel: { color: palette.textSecondary, fontSize: 13, fontWeight: '800' },
    statValue: { color: palette.accent, fontSize: 30, fontWeight: '900' },
    stateDanger: { borderColor: palette.danger },
    statePanel: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 18, borderWidth: 1, gap: 9, marginHorizontal: 16, marginTop: 12, padding: 16 },
    stateWarning: { borderColor: palette.warning },
    tab: { alignItems: 'center', borderColor: 'transparent', borderRadius: 12, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 50, paddingHorizontal: 3, paddingVertical: 7 },
    tabBar: { backgroundColor: palette.surface, borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: 4, paddingBottom: 8, paddingHorizontal: 8, paddingTop: 8 },
    tabSelected: { backgroundColor: palette.selected, borderColor: palette.accent },
    tabText: { color: palette.textMuted, fontSize: 10, fontWeight: '800', textAlign: 'center' },
    tabTextSelected: { color: palette.selectedForeground },
    testBadge: { backgroundColor: palette.accent, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
    testBadgeText: { color: palette.accentForeground, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  })
}
