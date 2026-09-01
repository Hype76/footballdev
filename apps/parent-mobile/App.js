import 'react-native-url-polyfill/auto'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import NetInfo from '@react-native-community/netinfo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Image,
  InteractionManager,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { AuthProvider, useMobileAuth } from '../mobile-core/src/auth'
import {
  getParentAppBadgeCount,
  readMobileAppBadgeEnabled,
  syncMobileAppBadge,
  writeMobileAppBadgeEnabled,
} from '../mobile-core/src/appBadge'
import { getBiometricAvailability, getBiometricEnabled, setBiometricEnabled } from '../mobile-core/src/biometrics'
import { getMobileRuntimeConfig } from '../mobile-core/src/config'
import { getMobileChatMessagesFingerprint } from '../mobile-core/src/mobileChatCore'
import { getMobileNotificationIndicator, MOBILE_SETTING_LOAD_STATES, preserveMobileNotificationState } from '../mobile-core/src/deviceSettingsCore'
import { getParentAppBadgeUpdate } from '../mobile-core/src/parentNotificationsCore'
import { getParentCalendarEvents, getParentMessages, getParentPolls } from '../mobile-core/src/data'
import { getParentPortalLinks, getSelectedParentLink, withSelectedParentLink } from '../mobile-core/src/parentLinks'
import { buildParentCalendarEvents } from '../mobile-core/src/parentCalendarCore'
import {
  formatParentProductDateTime,
  formatParentProductTime,
  getParentProductDateTimeParts,
} from '../mobile-core/src/parentDateTimeCore'
import {
  getParentNotificationStatusLabel,
  loadCurrentParentNotificationData,
  resolveParentNotificationLinkId,
  resolveParentNotificationOpen,
} from '../mobile-core/src/parentNotificationsCore'
import { countUnreadNonChatNotifications, prepareParentNotificationInbox } from '../mobile-core/src/parentNotificationInboxCore'
import { AccessScreen, LoadingScreen, LockedScreen, MobileLoginScreen } from '../mobile-core/src/ui'
import { MOBILE_STARTUP_STATES } from '../mobile-core/src/startupStateCore'
import { useMobileAutomaticUpdates } from '../mobile-core/src/updates'
import { useConfirmedConnectionIssue } from '../mobile-core/src/useConfirmedConnectionIssue'
import { createParentMobileTheme, DEFAULT_PARENT_MOBILE_THEME } from '../mobile-core/src/parentThemeCore'
import { getMobileIconName, getParentTabIconKey } from '../mobile-core/src/mobileIconSystem'
import { getMatchDayShirtChoiceLabel } from '../../src/lib/matchday-model.js'
import {
  canSubmitParentPoll,
  getBuildClassification,
  getParentCalendarDirectionsUrl,
  getParentMatchDirectionsUrl,
  getParentFriendlyError,
  getParentHomeFixtureCards,
  getParentHomeModel,
  getPollDraftOption,
  isParentDefinitelyOffline,
  rankParentPollResults,
} from './src/parentExperience'
import { getParentInvitationSections } from './src/parentPresentationCore'
import {
  addParentScorerGoal,
  correctParentScorerGoal,
  deleteParentChatMessage,
  expressParentScorerInterest,
  getParentChatMessages,
  getParentChatRooms,
  getParentCalendarEventDetails,
  getParentCalendarEventResources,
  getParentDevelopmentHistory,
  getParentInvitations,
  getParentNotificationInbox,
  getParentPortalMatchDays,
  getParentPortalMatchDayPlayers,
  getParentResources,
  isParentInvitationActionable,
  markParentChatRoomRead,
  markParentNotificationRead,
  openParentResource,
  recordParentScorerShootoutKick,
  respondToParentInvitation,
  setParentMatchTransport,
  shareParentCalendarItem,
  sendParentScorerMatchDayPush,
  sendParentChatMessage,
  setParentChatRoomNotifications,
  subscribeToParentChatRoom,
  setParentScorerExtendedState,
  setParentScorerTimer,
  startParentScorerMatch,
  updateParentPassword,
  updateParentDisplayName,
  updateParentScorerScore,
  voidParentScorerGoal,
  voidParentScorerShootoutKick,
} from './src/parentPortalData'
import { getParentAnnouncementMessages, isParentStaffAnnouncement, prepareParentChatRooms } from './src/parentPresentationCore'
import {
  CalendarScreen,
  ChatScreen,
  DevelopmentScreen,
  InvitationsScreen,
  MatchdayScreen,
  MoreScreen,
  openExternalParentUrl,
  ResourcesScreen,
  ResultsScreen,
} from './src/ParentPortalScreens'
import {
  parentOfflineProfileStore,
  markParentOfflineNotificationRead,
  queueParentMessageRead,
  queueParentPollVote,
  readParentOfflineView,
  reconcileParentOfflineAttention,
  saveParentOfflineResources,
  saveParentOfflineSelection,
  syncParentOfflineCommands,
} from './src/offline'
import {
  addParentPushTokenListener,
  enableParentNotifications,
  initializeParentNotifications,
  loadParentNotificationState,
  registerParentAppInstallation,
  sendParentTestNotification,
  updateParentNotificationPreference,
} from './src/notifications'
import { prepareParentMobileStartup } from './src/startup'
import { getParentCommunicationPreference, updateParentCommunicationPreference as updateParentCommunicationChannel } from './src/communicationPreferences'
import { getSafeParentMessageUrl, presentParentMessages } from './messagePresentation'
import { shareParentMobileDevelopmentPdf } from './parentDevelopment'

const config = getMobileRuntimeConfig('parent')
const PARENT_REFRESH_MIN_INTERVAL_MS = 30 * 1000
const resourceNames = ['calendar', 'chatHistory', 'chatRooms', 'development', 'invitations', 'matches', 'messages', 'notifications', 'polls', 'resources']
const resourceFallbacks = {
  calendar: 'Calendar information could not be loaded.',
  chatHistory: 'Saved Parent Chat history could not be loaded.',
  chatRooms: 'Parent Chat could not be loaded.',
  development: 'Development history could not be loaded.',
  invitations: 'Invitations could not be loaded.',
  matches: 'Matchday information could not be loaded.',
  messages: 'Club announcements could not be loaded.',
  notifications: 'Notifications could not be loaded.',
  polls: 'Polls could not be loaded.',
  resources: 'Resources could not be loaded.',
}

const PARENT_THEME_STORAGE_KEY = 'fp.parent.display-theme.v1'
const PARENT_NOTIFICATION_RESPONSE_HISTORY_PREFIX = 'fp.parent.notification-responses.v1'
const PARENT_NOTIFICATION_RESPONSE_HISTORY_LIMIT = 32
const defaultParentThemeContext = {
  ...DEFAULT_PARENT_MOBILE_THEME,
  palette: createParentAppPalette(DEFAULT_PARENT_MOBILE_THEME.tokens),
  styles: createParentAppStyles(DEFAULT_PARENT_MOBILE_THEME.tokens),
}
const ParentThemeContext = createContext(defaultParentThemeContext)

function useParentTheme() {
  return useContext(ParentThemeContext)
}

function createResourceState() {
  return Object.fromEntries(resourceNames.map((name) => [name, {
    error: '',
    items: [],
    loading: true,
  }]))
}

function prepareResourceItems(name, items) {
  const normalizedItems = Array.isArray(items) ? items : []
  return name === 'messages'
    ? presentParentMessages(normalizedItems).filter(isParentStaffAnnouncement)
    : normalizedItems
}

function getCalendarResourceOccurrenceKey(eventId, dateValue) {
  const normalizedEventId = String(eventId || '').trim()
  const rawDate = String(dateValue || '').trim()
  const occurrenceDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : getParentProductDateTimeParts(rawDate).date
  return normalizedEventId && occurrenceDate ? `${normalizedEventId}:${occurrenceDate}` : ''
}

function buildCalendarResourcesByOccurrence(resources = []) {
  const byOccurrence = new Map()
  for (const resource of resources) {
    const key = getCalendarResourceOccurrenceKey(resource.eventId, resource.occurrenceDate)
    if (!key) continue
    const current = byOccurrence.get(key) || []
    current.push(resource)
    byOccurrence.set(key, current)
  }
  return byOccurrence
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function getParentNotificationTargets(items = {}) {
  return {
    calendar: (items.calendar || []).map((item) => item.id),
    chat: [
      ...(items.chatRooms || []).map((item) => item.id),
      ...((items.messages || []).some((item) => normalizeText(item.body)) ? ['club-announcements'] : []),
    ],
    development: (items.development || []).map((item) => item.id),
    invites: (items.invitations || []).map((item) => item.invitationId),
    matchday: (items.matches || []).map((item) => item.id),
    messages: (items.messages || []).map((item) => item.id),
    polls: (items.polls || []).map((item) => item.id),
    resources: (items.resources || []).map((item) => item.id),
    results: (items.matches || []).filter((item) => item.status === 'full_time').map((item) => item.id),
  }
}

function labelize(value) {
  const label = normalizeText(value).replaceAll('_', ' ')
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : ''
}

function formatDateOnly(value, fallback = 'Date to be confirmed') {
  return formatParentProductDateTime(value, { fallback, includeTime: false, weekday: 'short' })
}

function formatDateTime(value, fallback = 'Time to be confirmed') {
  return formatParentProductDateTime(value, { fallback, weekday: 'short' })
}

function formatTime(value, isTbc = false) {
  if (isTbc) return 'Kick-off time to be confirmed'
  return formatParentProductTime(value)
}

function LoginScreen() {
  const { authError, requestPasswordReset, signIn } = useMobileAuth()

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
      requestPasswordReset={requestPasswordReset}
      signIn={handleSignIn}
      title="Everything for your child, in one place."
    />
  )
}

function ParentHome() {
  const { authError, isProfileLoading, refreshUserProfile, signOut, user } = useMobileAuth()
  const lastNotificationResponse = Notifications.useLastNotificationResponse()
  const [activeTab, setActiveTab] = useState('home')
  const [activeActionId, setActiveActionId] = useState('')
  const [appBadgeEnabled, setAppBadgeEnabled] = useState(true)
  const [attentionIndex, setAttentionIndex] = useState(0)
  const [biometricAvailable, setBiometricAvailableState] = useState(false)
  const [biometricEnabled, setBiometricEnabledState] = useState(false)
  const [biometricStateStatus, setBiometricStateStatus] = useState(MOBILE_SETTING_LOAD_STATES.LOADING)
  const [childSwitcherOpen, setChildSwitcherOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState('')
  const [offlineCacheState, setOfflineCacheState] = useState({ source: '', stale: false })
  const [notice, setNotice] = useState(null)
  const [notificationState, setNotificationState] = useState({
    canAskAgain: true,
    detailLevel: 'minimal',
    enabled: false,
    message: '',
    permissionGranted: false,
    permissionStatus: 'undetermined',
    registered: false,
  })
  const [notificationStateStatus, setNotificationStateStatus] = useState(MOBILE_SETTING_LOAD_STATES.LOADING)
  const [notificationSettingsFocusRequest, setNotificationSettingsFocusRequest] = useState(null)
  const [notificationResponseHistoryReady, setNotificationResponseHistoryReady] = useState(false)
  const [communicationPreference, setCommunicationPreference] = useState({ communicationChannel: 'both', updatedAt: '' })
  const [chatMessages, setChatMessages] = useState({ error: '', items: [], loading: false })
  const [displayTheme, setDisplayTheme] = useState('dark')
  const [dismissedItems, setDismissedItems] = useState({ development: [], invitations: [], matches: [], messages: [], polls: [], resources: [] })
  const [moreSection, setMoreSection] = useState('')
  const [pollDrafts, setPollDrafts] = useState({})
  const [resources, setResources] = useState(createResourceState)
  const [matchDayPlayers, setMatchDayPlayers] = useState([])
  const [selectedResourcePreview, setSelectedResourcePreview] = useState(null)
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [selectedInvitationId, setSelectedInvitationId] = useState('')
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [selectedMessageId, setSelectedMessageId] = useState('')
  const [selectedPollId, setSelectedPollId] = useState('')
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [pendingNotificationRoomId, setPendingNotificationRoomId] = useState('')
  const [syncSummary, setSyncSummary] = useState({ attentionItems: [], needsAttention: 0, state: 'synced', waiting: 0 })
  const appStateRef = useRef(AppState.currentState)
  const backgroundedAtRef = useRef(0)
  const hydratedScopeRef = useRef('')
  const lastDataRefreshAtRef = useRef(0)
  const requestIdRef = useRef(0)
  const resumeInteractionRef = useRef(null)
  const resumeRefreshRef = useRef(false)
  const scrollViewRef = useRef(null)
  const notificationResponseIdRef = useRef('')
  const notificationStateRequestRef = useRef(0)
  const notificationResponseHistoryRef = useRef(new Set())
  const notificationResponseProcessingRef = useRef('')
  const reloadSelectedChatRoomRef = useRef(() => Promise.resolve())
  const chatMessagesRef = useRef(chatMessages)
  const latestBadgeCountRef = useRef(0)
  const openNotificationSettings = useCallback(() => {
    setChildSwitcherOpen(false)
    setMoreSection('settings')
    setActiveTab('more')
    setNotificationSettingsFocusRequest({ id: Date.now() })
  }, [])
  const focusNotificationSettings = useCallback((sectionY) => {
    const numericY = Number(sectionY)
    const targetY = Number.isFinite(numericY) ? Math.max(0, numericY - 12) : 0
    requestAnimationFrame(() => scrollViewRef.current?.scrollTo({ animated: true, y: targetY }))
    setNotificationSettingsFocusRequest(null)
  }, [])
  const parentLinks = useMemo(() => getParentPortalLinks(user), [user])
  const selectedLink = useMemo(
    () => getSelectedParentLink({ ...user, parentPortalLinks: parentLinks }, selectedLinkId),
    [parentLinks, selectedLinkId, user],
  )
  const selectedMobileUser = useMemo(
    () => withSelectedParentLink({ ...user, parentPortalLinks: parentLinks }, selectedLink),
    [parentLinks, selectedLink, user],
  )
  const refreshParentAppInstallationPresence = useCallback(async () => {
    if (!selectedMobileUser?.id) return null
    try {
      return await registerParentAppInstallation({ apiBaseUrl: config.apiBaseUrl })
    } catch {
      return null
    }
  }, [selectedMobileUser?.id])
  const dismissalStorageKey = useMemo(
    () => selectedMobileUser?.id && selectedLink?.id ? `fp.parent.dismissed.v1.${selectedMobileUser.id}.${selectedLink.id}` : '',
    [selectedLink?.id, selectedMobileUser?.id],
  )
  const visibleInvitations = useMemo(() => resources.invitations.items.filter((item) => !dismissedItems.invitations.includes(item.invitationId)), [dismissedItems.invitations, resources.invitations.items])
  const visibleMatches = useMemo(() => resources.matches.items.filter((item) => !dismissedItems.matches.includes(item.id)), [dismissedItems.matches, resources.matches.items])
  const visibleInvitationsWithMatchTimes = useMemo(() => {
    const matchesById = new Map(resources.matches.items.map((match) => [normalizeText(match.id), match]))
    return visibleInvitations.map((invitation) => {
      if (!['match_attendance', 'match_role'].includes(invitation.invitationType)) return invitation
      const match = matchesById.get(normalizeText(invitation.eventId))
      if (!match) return invitation
      return {
        ...invitation,
        arrivalTime: match.arrivalTime || '',
        kickoffTime: match.kickoffTime || '',
        kickoffTimeTbc: match.kickoffTimeTbc === true,
      }
    })
  }, [resources.matches.items, visibleInvitations])
  const visibleMessages = useMemo(() => resources.messages.items.filter((item) => !dismissedItems.messages.includes(item.id)), [dismissedItems.messages, resources.messages.items])
  const visibleDevelopment = useMemo(() => resources.development.items.filter((item) => !dismissedItems.development.includes(item.id)), [dismissedItems.development, resources.development.items])
  const visiblePolls = useMemo(() => resources.polls.items.filter((item) => !dismissedItems.polls.includes(item.id)), [dismissedItems.polls, resources.polls.items])
  const visibleResources = useMemo(() => resources.resources.items.filter((item) => !dismissedItems.resources.includes(item.id)), [dismissedItems.resources, resources.resources.items])

  useEffect(() => {
    let mounted = true
    void readMobileAppBadgeEnabled('parent')
      .then((enabled) => { if (mounted) setAppBadgeEnabled(enabled) })
      .catch(() => { if (mounted) setAppBadgeEnabled(true) })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    void refreshParentAppInstallationPresence()
  }, [refreshParentAppInstallationPresence])
  const homeModel = useMemo(() => getParentHomeModel({
    calendarEvents: resources.calendar.items,
    matches: visibleMatches,
    messages: visibleMessages.filter((message) => normalizeText(message.body)),
    polls: visiblePolls,
  }), [resources.calendar.items, visibleMatches, visibleMessages, visiblePolls])
  const parentChatRooms = useMemo(
    () => prepareParentChatRooms(resources.chatRooms.items, visibleMessages),
    [resources.chatRooms.items, visibleMessages],
  )
  const selectedRoom = parentChatRooms.find((room) => room.id === selectedRoomId)
    || (pendingNotificationRoomId && pendingNotificationRoomId === selectedRoomId
      ? {
          canPost: false,
          id: pendingNotificationRoomId,
          notificationsMuted: false,
          title: 'Opening chat',
          type: 'parent_staff',
          unreadCount: 0,
        }
      : null)
  chatMessagesRef.current = chatMessages
  const themeModel = useMemo(
    () => createParentMobileTheme({ mode: displayTheme, selectedLink }),
    [displayTheme, selectedLink],
  )
  const themeContext = useMemo(() => ({
    ...themeModel,
    palette: createParentAppPalette(themeModel.tokens),
    styles: createParentAppStyles(themeModel.tokens),
  }), [themeModel])
  const { palette, styles } = themeContext

  const notificationResponseHistoryKey = useMemo(
    () => selectedMobileUser?.id ? `${PARENT_NOTIFICATION_RESPONSE_HISTORY_PREFIX}.${selectedMobileUser.id}` : '',
    [selectedMobileUser?.id],
  )

  const consumeLastNotificationResponse = useCallback((responseId) => {
    notificationResponseIdRef.current = responseId
    if (responseId && notificationResponseHistoryKey) {
      const recentIds = [...notificationResponseHistoryRef.current, responseId]
        .slice(-PARENT_NOTIFICATION_RESPONSE_HISTORY_LIMIT)
      notificationResponseHistoryRef.current = new Set(recentIds)
      void AsyncStorage.setItem(notificationResponseHistoryKey, JSON.stringify(recentIds)).catch(() => {})
    }
    void Notifications.clearLastNotificationResponseAsync().catch(() => {})
  }, [notificationResponseHistoryKey])

  const applyParentNotificationDestination = useCallback((destination, { pending = false } = {}) => {
    const nestedSection = ['development', 'invites', 'messages', 'polls', 'resources', 'results', 'settings'].includes(destination.tab)
      ? destination.tab
      : ''
    setSelectedMatchId(destination.tab === 'matchday' ? destination.targetId : '')
    setSelectedInvitationId(destination.tab === 'invites' ? destination.targetId : '')
    setSelectedMessageId(destination.tab === 'messages' ? destination.targetId : '')
    setSelectedPollId(destination.tab === 'polls' ? destination.targetId : '')
    if (destination.tab === 'chat') {
      setSelectedRoomId(destination.targetId)
      setPendingNotificationRoomId(pending ? destination.targetId : '')
      if (pending && destination.targetId) {
        setChatMessages({ error: '', items: [], loading: true })
      }
    } else {
      setSelectedRoomId('')
      setPendingNotificationRoomId('')
    }
    setMoreSection(nestedSection)
    setActiveTab(nestedSection ? 'more' : destination.tab)
  }, [])

  const loadParentData = useCallback(async ({ reset = false } = {}) => {
    const requestId = ++requestIdRef.current

    if (!selectedMobileUser?.id || !selectedLink?.id) {
      hydratedScopeRef.current = ''
      setResources(Object.fromEntries(resourceNames.map((name) => [name, {
        error: '',
        items: [],
        loading: false,
      }])))
      setLastUpdatedAt('')
      setMatchDayPlayers([])
      setOfflineCacheState({ source: '', stale: false })
      return { failed: 0 }
    }

    const cacheScopeKey = `${selectedMobileUser.id}:${selectedLink.id}`
    const shouldHydrateCache = reset || hydratedScopeRef.current !== cacheScopeKey
    let cachedView = null
    try {
      cachedView = await readParentOfflineView(selectedMobileUser.id, selectedLink.id)
    } catch (error) {
      console.warn(error)
    }
    if (requestId !== requestIdRef.current) return { failed: 0, stale: true }
    if (shouldHydrateCache) hydratedScopeRef.current = cacheScopeKey

    if (cachedView?.cache && shouldHydrateCache) {
      setResources(Object.fromEntries(resourceNames.map((name) => [name, {
        error: '',
        items: prepareResourceItems(name, cachedView.cache.resources[name]),
        loading: !isOffline,
      }])))
      setLastUpdatedAt(cachedView.cache.retrievedAt)
      setOfflineCacheState({ source: 'cache', stale: cachedView.cache.stale })
    } else if (shouldHydrateCache || !cachedView?.cache) {
      setResources((current) => Object.fromEntries(resourceNames.map((name) => [name, {
        error: isOffline ? 'No saved information is available for this section yet.' : '',
        items: reset ? [] : current[name].items,
        loading: !isOffline,
      }])))
      setOfflineCacheState({ source: '', stale: false })
    } else {
      setResources((current) => Object.fromEntries(resourceNames.map((name) => [name, {
        ...current[name],
        loading: true,
      }])))
    }

    if (cachedView?.sync) setSyncSummary(cachedView.sync)
    if (isOffline) return { cached: Boolean(cachedView?.cache), failed: cachedView?.cache ? 0 : resourceNames.length }

    const calendarEventResourcesPromise = getParentCalendarEventResources(selectedMobileUser)
      .catch((error) => {
        console.error('Parent calendar attachments could not be loaded', error)
        return []
      })
    const resourcesByOccurrencePromise = calendarEventResourcesPromise.then(buildCalendarResourcesByOccurrence)
    const calendarEventDetailsPromise = getParentCalendarEventDetails(selectedMobileUser)
      .catch((error) => {
        console.error('Parent calendar event details could not be loaded', error)
        return []
      })
    const calendarEventDetailsByIdPromise = calendarEventDetailsPromise.then((events) => new Map(
      events.map((event) => [normalizeText(event.id), event]),
    ))
    const loaders = {
      calendar: async () => {
        const [calendarEvents, resourcesByOccurrence, detailsById] = await Promise.all([
          getParentCalendarEvents(selectedMobileUser),
          resourcesByOccurrencePromise,
          calendarEventDetailsByIdPromise,
        ])
        return calendarEvents.map((event) => ({
          ...event,
          notes: detailsById.get(normalizeText(event.id))?.notes || event.notes,
          occurrenceDate: getParentProductDateTimeParts(event.startsAt).date,
          resources: resourcesByOccurrence.get(getCalendarResourceOccurrenceKey(event.id, event.startsAt)) || [],
        }))
      },
      chatHistory: () => Promise.resolve(cachedView?.cache?.resources.chatHistory || []),
      chatRooms: () => getParentChatRooms(selectedMobileUser),
      development: () => getParentDevelopmentHistory(selectedMobileUser),
      invitations: async () => {
        const [invitations, resourcesByOccurrence, detailsById] = await Promise.all([
          getParentInvitations(selectedMobileUser),
          resourcesByOccurrencePromise,
          calendarEventDetailsByIdPromise,
        ])
        return invitations.map((invitation) => ({
          ...invitation,
          notes: detailsById.get(normalizeText(invitation.eventId))?.notes || invitation.notes || '',
          occurrenceDate: getParentProductDateTimeParts(invitation.eventStart || invitation.eventDate).date,
          resources: resourcesByOccurrence.get(getCalendarResourceOccurrenceKey(invitation.eventId, invitation.eventStart || invitation.eventDate)) || [],
        }))
      },
      matches: async () => {
        const [matches, players] = await Promise.all([
          getParentPortalMatchDays(selectedMobileUser),
          getParentPortalMatchDayPlayers(selectedMobileUser),
        ])
        if (requestId === requestIdRef.current) setMatchDayPlayers(players)
        return matches
      },
      messages: () => getParentMessages(selectedMobileUser),
      notifications: () => getParentNotificationInbox(selectedMobileUser),
      polls: () => getParentPolls(selectedMobileUser),
      resources: () => getParentResources(selectedMobileUser),
    }
    const settleResource = async (name) => {
      try {
        const value = await loaders[name]()
        if (requestId === requestIdRef.current && name !== 'calendar') {
          setResources((current) => ({
            ...current,
            [name]: {
              error: '',
              items: prepareResourceItems(name, value),
              loading: false,
            },
          }))
        }
        return { status: 'fulfilled', value }
      } catch (reason) {
        if (requestId === requestIdRef.current && name !== 'calendar') {
          setResources((current) => ({
            ...current,
            [name]: {
              error: cachedView?.cache ? '' : getParentFriendlyError(reason, resourceFallbacks[name]),
              items: current[name].items,
              loading: false,
            },
          }))
        }
        return { reason, status: 'rejected' }
      }
    }
    const results = await Promise.all(resourceNames.map(settleResource))

    if (requestId !== requestIdRef.current) return { failed: 0, stale: true }

    const failed = results.filter((result) => result.status === 'rejected').length
    const resultByName = Object.fromEntries(resourceNames.map((name, index) => [name, results[index]]))
    const valueFor = (name) => resultByName[name]?.status === 'fulfilled'
      ? prepareResourceItems(name, resultByName[name].value)
      : []
    const combinedCalendar = buildParentCalendarEvents({
      calendarEvents: valueFor('calendar'),
      invitations: valueFor('invitations'),
      matches: valueFor('matches'),
    })
    const refreshedItems = Object.fromEntries(
      resourceNames.map((name) => [name, name === 'calendar' ? combinedCalendar : valueFor(name)]),
    )
    const calendarDependencyFailed = ['calendar', 'invitations', 'matches']
      .some((name) => resultByName[name]?.status === 'rejected')
    setResources((current) => {
      const next = { ...current }
      results.forEach((result, index) => {
        const name = resourceNames[index]
        if (result.status === 'fulfilled') {
          next[name] = {
            error: name === 'calendar' && calendarDependencyFailed && !cachedView?.cache
              ? 'Some Calendar items could not be refreshed.'
              : '',
            items: name === 'calendar' ? combinedCalendar : valueFor(name),
            loading: false,
          }
        } else {
          next[name] = {
            error: cachedView?.cache ? '' : getParentFriendlyError(result.reason, resourceFallbacks[name]),
            items: current[name].items,
            loading: false,
          }
        }
      })
      next.calendar = {
        error: calendarDependencyFailed && !cachedView?.cache ? 'Some Calendar items could not be refreshed.' : '',
        items: calendarDependencyFailed && combinedCalendar.length === 0
          ? current.calendar.items
          : combinedCalendar,
        loading: false,
      }
      return next
    })

    if (failed < resourceNames.length) {
      setLastUpdatedAt(new Date().toISOString())
      lastDataRefreshAtRef.current = Date.now()
      setOfflineCacheState({ source: failed === 0 ? 'online' : cachedView?.cache ? 'cache' : 'online', stale: false })
    }
    let reconciledSync = cachedView?.sync || null
    if (failed === 0) {
      try {
        await new Promise((resolve) => {
          InteractionManager.runAfterInteractions(resolve)
        })
        if (requestId !== requestIdRef.current) return { failed: 0, stale: true }
        await saveParentOfflineResources(selectedMobileUser, selectedLink.id, Object.fromEntries(
          resourceNames.map((name) => [name, refreshedItems[name]]),
        ))
        reconciledSync = await reconcileParentOfflineAttention(selectedMobileUser, selectedLink.id, refreshedItems)
        setSyncSummary(reconciledSync)
      } catch (error) {
        console.warn(error)
      }
    }
    return { failed, items: refreshedItems, sync: reconciledSync }
  }, [isOffline, selectedLink?.id, selectedMobileUser])

  const runParentSync = useCallback(async ({ explicitRetry = false } = {}) => {
    if (isOffline || !selectedMobileUser?.id) return null
    setIsSyncing(true)
    try {
      const result = await syncParentOfflineCommands(selectedMobileUser, { explicitRetry })
      setSyncSummary({
        attentionItems: result.attentionItems || [],
        needsAttention: result.needsAttention,
        state: result.state,
        waiting: result.waiting,
      })
      return result
    } catch (error) {
      console.warn(error)
      return null
    } finally {
      setIsSyncing(false)
    }
  }, [isOffline, selectedMobileUser])

  const refreshParentMatchDay = useCallback(async () => {
    if (isOffline || !selectedMobileUser?.id) return
    try {
      const [matches, players] = await Promise.all([
        getParentPortalMatchDays(selectedMobileUser),
        getParentPortalMatchDayPlayers(selectedMobileUser),
      ])
      setMatchDayPlayers(players)
      setResources((current) => ({
        ...current,
        matches: { error: '', items: matches, loading: false },
      }))
    } catch {
      return
    }
  }, [isOffline, selectedMobileUser])

  useEffect(() => {
    if (syncSummary.needsAttention === 0) setAttentionIndex(0)
    else if (attentionIndex >= syncSummary.needsAttention) setAttentionIndex(0)
  }, [attentionIndex, syncSummary.needsAttention])

  useEffect(() => {
    const nextSelectedLinkId = selectedLink?.id || ''
    if (selectedLinkId !== nextSelectedLinkId) {
      setSelectedLinkId(nextSelectedLinkId)
    }
  }, [selectedLink?.id, selectedLinkId])

  useEffect(() => {
    const subscription = NetInfo.addEventListener((state) => {
      const offline = isParentDefinitelyOffline(state)
      setIsOffline((current) => {
        if (current && !offline && selectedMobileUser?.id) {
          void runParentSync().then(() => loadParentData())
        }
        return offline
      })
    })
    return () => subscription()
  }, [loadParentData, runParentSync, selectedMobileUser?.id])

  useEffect(() => {
    setSelectedMatchId('')
    setSelectedInvitationId('')
    setSelectedMessageId('')
    setSelectedRoomId('')
    setPendingNotificationRoomId('')
    setMoreSection('')
    setChatMessages({ error: '', items: [], loading: false })
    setPollDrafts({})
    setNotice(null)
    void loadParentData({ reset: true }).then(() => runParentSync())
  }, [loadParentData, runParentSync, selectedLink?.id])

  useEffect(() => {
    let mounted = true
    void AsyncStorage.getItem(PARENT_THEME_STORAGE_KEY)
      .then((value) => {
        if (mounted && ['dark', 'light'].includes(value)) setDisplayTheme(value)
      })
      .catch(() => {})
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    let mounted = true
    notificationResponseIdRef.current = ''
    notificationResponseHistoryRef.current = new Set()
    setNotificationResponseHistoryReady(false)
    if (!notificationResponseHistoryKey) {
      setNotificationResponseHistoryReady(true)
      return () => { mounted = false }
    }
    void AsyncStorage.getItem(notificationResponseHistoryKey)
      .then((value) => {
        if (!mounted) return
        const parsed = value ? JSON.parse(value) : []
        notificationResponseHistoryRef.current = new Set(
          Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(-PARENT_NOTIFICATION_RESPONSE_HISTORY_LIMIT) : [],
        )
      })
      .catch(() => {
        if (mounted) notificationResponseHistoryRef.current = new Set()
      })
      .finally(() => {
        if (mounted) setNotificationResponseHistoryReady(true)
      })
    return () => { mounted = false }
  }, [notificationResponseHistoryKey])

  useEffect(() => {
    let mounted = true
    if (!dismissalStorageKey) {
      setDismissedItems({ development: [], invitations: [], matches: [], messages: [], polls: [], resources: [] })
      return () => { mounted = false }
    }
    void AsyncStorage.getItem(dismissalStorageKey).then((value) => {
      if (!mounted) return
      const parsed = value ? JSON.parse(value) : {}
      setDismissedItems({
        development: Array.isArray(parsed.development) ? parsed.development : [],
        invitations: Array.isArray(parsed.invitations) ? parsed.invitations : [],
        matches: Array.isArray(parsed.matches) ? parsed.matches : [],
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        polls: Array.isArray(parsed.polls) ? parsed.polls : [],
        resources: Array.isArray(parsed.resources) ? parsed.resources : [],
      })
    }).catch(() => {
      if (mounted) setDismissedItems({ development: [], invitations: [], matches: [], messages: [], polls: [], resources: [] })
    })
    return () => { mounted = false }
  }, [dismissalStorageKey])

  useEffect(() => {
    let mounted = true
    void Promise.all([
      getBiometricAvailability(),
      getBiometricEnabled(),
    ])
      .then(([availability, enabled]) => {
        if (mounted) {
          setBiometricAvailableState(availability.available)
          setBiometricEnabledState(enabled)
          setBiometricStateStatus(MOBILE_SETTING_LOAD_STATES.READY)
        }
      })
      .catch(() => {
        if (mounted) {
          setBiometricStateStatus(MOBILE_SETTING_LOAD_STATES.ERROR)
        }
      })
    void initializeParentNotifications().catch(() => {})

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!selectedMobileUser?.id) return undefined

    let mounted = true
    const requestId = notificationStateRequestRef.current + 1
    notificationStateRequestRef.current = requestId
    setNotificationStateStatus(MOBILE_SETTING_LOAD_STATES.LOADING)
    void Promise.allSettled([
      loadParentNotificationState({ apiBaseUrl: config.apiBaseUrl }),
      getParentCommunicationPreference(config.apiBaseUrl),
    ])
      .then(([notificationResult, communicationResult]) => {
        if (!mounted) return
        if (notificationStateRequestRef.current !== requestId) return
        if (notificationResult.status === 'fulfilled') {
          setNotificationState(notificationResult.value)
          setNotificationStateStatus(MOBILE_SETTING_LOAD_STATES.READY)
        } else {
          setNotificationStateStatus(MOBILE_SETTING_LOAD_STATES.ERROR)
        }
        if (communicationResult.status === 'fulfilled') setCommunicationPreference(communicationResult.value)
      })
      .catch(() => {})

    return () => {
      mounted = false
      if (notificationStateRequestRef.current === requestId) notificationStateRequestRef.current += 1
    }
  }, [selectedMobileUser?.id])

  const retryParentBiometricState = useCallback(async () => {
    setBiometricStateStatus(MOBILE_SETTING_LOAD_STATES.LOADING)
    try {
      const [availability, enabled] = await Promise.all([
        getBiometricAvailability(),
        getBiometricEnabled(),
      ])
      setBiometricAvailableState(availability.available)
      setBiometricEnabledState(enabled)
      setBiometricStateStatus(MOBILE_SETTING_LOAD_STATES.READY)
    } catch {
      setBiometricStateStatus(MOBILE_SETTING_LOAD_STATES.ERROR)
    }
  }, [])

  const reloadParentNotificationState = useCallback(async ({ preserveKnownState = false } = {}) => {
    const requestId = notificationStateRequestRef.current + 1
    notificationStateRequestRef.current = requestId
    if (!preserveKnownState) setNotificationStateStatus(MOBILE_SETTING_LOAD_STATES.LOADING)
    try {
      const nextState = await loadParentNotificationState({ apiBaseUrl: config.apiBaseUrl })
      if (notificationStateRequestRef.current !== requestId) return null
      setNotificationState(nextState)
      setNotificationStateStatus(MOBILE_SETTING_LOAD_STATES.READY)
      return nextState
    } catch {
      if (notificationStateRequestRef.current === requestId) {
        setNotificationStateStatus(preserveKnownState ? MOBILE_SETTING_LOAD_STATES.STALE : MOBILE_SETTING_LOAD_STATES.ERROR)
      }
      return null
    }
  }, [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current
      if (nextState === 'background' && previousState !== 'background') backgroundedAtRef.current = Date.now()
      appStateRef.current = nextState
      const returnedFromBackground = previousState === 'background' && nextState === 'active'
      const wasAwayLongEnough = Date.now() - backgroundedAtRef.current >= 1500
      const dataRefreshDue = Date.now() - lastDataRefreshAtRef.current >= PARENT_REFRESH_MIN_INTERVAL_MS
      if (returnedFromBackground && wasAwayLongEnough && dataRefreshDue && selectedLink?.id && !resumeRefreshRef.current) {
        void refreshParentAppInstallationPresence()
        resumeRefreshRef.current = true
        const roomIdAtResume = selectedRoomId
        resumeInteractionRef.current?.cancel?.()
        resumeInteractionRef.current = InteractionManager.runAfterInteractions(() => {
          void runParentSync()
            .then(() => loadParentData())
            .then(() => roomIdAtResume && roomIdAtResume === selectedRoomId ? reloadSelectedChatRoomRef.current() : null)
            .catch(() => {})
            .finally(() => {
              resumeRefreshRef.current = false
              resumeInteractionRef.current = null
            })
        })
        void reloadParentNotificationState({ preserveKnownState: true })
      }
    })
    return () => {
      subscription.remove()
      resumeInteractionRef.current?.cancel?.()
      resumeInteractionRef.current = null
      resumeRefreshRef.current = false
    }
  }, [loadParentData, refreshParentAppInstallationPresence, reloadParentNotificationState, runParentSync, selectedLink?.id, selectedRoomId])

  useEffect(() => {
    if (!notificationState.enabled || !selectedLink?.id) return undefined
    const subscription = addParentPushTokenListener((devicePushToken) => {
      void enableParentNotifications({
        apiBaseUrl: config.apiBaseUrl,
        devicePushToken,
        easProjectId: config.easProjectId,
        parentLinkId: selectedLink.id,
      }).then(setNotificationState).catch(() => {})
    })
    return () => subscription.remove()
  }, [notificationState.enabled, selectedLink?.id])

  useEffect(() => {
    const request = lastNotificationResponse?.notification?.request
    const responseId = normalizeText(request?.identifier)
    if (
      !notificationResponseHistoryReady
      || !responseId
      || notificationResponseIdRef.current === responseId
      || notificationResponseProcessingRef.current === responseId
    ) return undefined

    if (notificationResponseHistoryRef.current.has(responseId)) {
      notificationResponseIdRef.current = responseId
      void Notifications.clearLastNotificationResponseAsync().catch(() => {})
      return undefined
    }

    const notificationData = request.content?.data
    const notificationAction = normalizeText(lastNotificationResponse?.actionIdentifier)
    const requestedLinkId = resolveParentNotificationLinkId(notificationData, parentLinks)
    if (requestedLinkId === null) {
      consumeLastNotificationResponse(responseId)
      return undefined
    }
    if (requestedLinkId && requestedLinkId !== selectedLink?.id) {
      setSelectedLinkId(requestedLinkId)
      void saveParentOfflineSelection(selectedMobileUser, requestedLinkId).catch((error) => console.warn(error))
      return undefined
    }
    const currentDestination = resolveParentNotificationOpen(notificationData, {})
    if (!currentDestination) {
      consumeLastNotificationResponse(responseId)
      return undefined
    }

    notificationResponseProcessingRef.current = responseId
    applyParentNotificationDestination(currentDestination, { pending: true })
    consumeLastNotificationResponse(responseId)
    void loadCurrentParentNotificationData(loadParentData)
      .then(async (result) => {
        if (notificationResponseProcessingRef.current !== responseId) return
        let destination = resolveParentNotificationOpen(
          notificationData,
          getParentNotificationTargets(result?.items || {}),
        )
        if (!destination) return
        if (currentDestination.targetId && !destination.targetId) {
          applyParentNotificationDestination({ tab: currentDestination.tab, targetId: '' })
          setNotice({ message: 'That notification item is no longer available. The latest information for this section is shown.', tone: 'warning' })
          return
        }
        if (destination.tab === 'messages') {
          const legacyMessage = (result?.items?.messages || []).find((message) => message.id === destination.targetId)
          if (normalizeText(legacyMessage?.body)) {
            destination = { tab: 'chat', targetId: 'club-announcements' }
          } else if (legacyMessage?.evaluationId) {
            destination = { tab: 'development', targetId: legacyMessage.evaluationId }
          } else {
            applyParentNotificationDestination({ tab: 'messages', targetId: '' })
            setNotice({ message: 'This email update did not contain an in-app message. Open Chat or the relevant request to continue.', tone: 'warning' })
            return
          }
        }
        applyParentNotificationDestination(destination)
        if (destination.tab === 'chat') {
          const room = prepareParentChatRooms(result?.items?.chatRooms || [], result?.items?.messages || [])
            .find((candidate) => candidate.id === destination.targetId)
          if (room) {
            if (room.id === 'club-announcements') {
              setChatMessages({ error: '', items: getParentAnnouncementMessages(result?.items?.messages || []), loading: false })
            } else {
              setChatMessages({ error: '', items: [], loading: true })
              try {
                const items = await getParentChatMessages(selectedMobileUser, room.id)
                setChatMessages({ error: '', items, loading: false })
                if (room.unreadCount > 0) await markParentChatRoomRead(selectedMobileUser, room.id)
              } catch (error) {
                setChatMessages({ error: getParentFriendlyError(error, 'Chat messages could not be loaded.'), items: [], loading: false })
              }
            }
          }
        }
        if (destination.tab === 'invites' && ['parent_accept', 'parent_decline'].includes(notificationAction)) {
          const invitation = (result?.items?.invitations || []).find((item) => item.invitationId === destination.targetId)
          if (invitation && isParentInvitationActionable(invitation)) {
            const responseState = notificationAction === 'parent_accept'
              ? invitation.invitationType === 'match_role' ? 'yes' : 'available'
              : invitation.invitationType === 'match_role' ? 'no' : 'unavailable'
            try {
              await respondToParentInvitation(selectedMobileUser, invitation, responseState)
              await loadParentData()
              setNotice({ message: notificationAction === 'parent_accept' ? 'Request accepted.' : 'Request declined.', tone: 'success' })
            } catch (error) {
              setNotice({ message: getParentFriendlyError(error, 'That response could not be saved. Open the request and try again.'), tone: 'warning' })
            }
          }
        }
      })
      .catch(() => {
        if (notificationResponseProcessingRef.current !== responseId) return
        if (currentDestination.tab === 'chat' && currentDestination.targetId) {
          setChatMessages({ error: 'Chat messages could not be loaded. Pull to retry or return to Chat rooms.', items: [], loading: false })
        }
        setNotice({ message: 'The destination opened, but its latest information could not be refreshed. Pull to retry.', tone: 'warning' })
      })
      .finally(() => {
        if (notificationResponseProcessingRef.current === responseId) {
          notificationResponseProcessingRef.current = ''
        }
      })

    return undefined
  }, [applyParentNotificationDestination, consumeLastNotificationResponse, lastNotificationResponse, loadParentData, notificationResponseHistoryReady, parentLinks, selectedLink?.id, selectedMobileUser])

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
      if (selectedRoomId) {
        setSelectedRoomId('')
        setPendingNotificationRoomId('')
        return true
      }
      if (moreSection) {
        setMoreSection('')
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
  }, [activeTab, childSwitcherOpen, moreSection, selectedMatchId, selectedMessageId, selectedRoomId])

  async function handleRefresh() {
    if (!selectedLink?.id || isRefreshing) return
    setIsRefreshing(true)
    setNotice(null)
    try {
      await runParentSync({ explicitRetry: true })
      const result = await loadParentData()
      setNotice(isOffline
        ? { message: result.cached ? 'Offline. Showing your last saved information.' : 'Offline. No saved information is available yet.', tone: 'warning' }
        : result.failed > 0
        ? { message: 'Some information could not be refreshed. Your previous view is still available.', tone: 'warning' }
        : Number(result.sync?.needsAttention || 0) > 0
        ? null
        : { message: 'You are up to date.', tone: 'success' })
    } finally {
      setIsRefreshing(false)
    }
  }

  function handleTabChange(tab) {
    setNotice(null)
    setSelectedInvitationId('')
    setSelectedMatchId('')
    setSelectedMessageId('')
    setSelectedPollId('')
    setSelectedRoomId('')
    setPendingNotificationRoomId('')
    setMoreSection('')
    setChildSwitcherOpen(false)
    setActiveTab(tab)
  }

  function handleChildChange(linkId) {
    if (!parentLinks.some((link) => link.id === linkId)) return
    setSelectedLinkId(linkId)
    void saveParentOfflineSelection(selectedMobileUser, linkId).catch((error) => console.warn(error))
    setChildSwitcherOpen(false)
    setActiveTab('home')
  }

  async function handleOpenMessage(message) {
    setSelectedMessageId(message.id)
    if (message.readAt || activeActionId) return

    setActiveActionId(`message:${message.id}`)
    try {
      const command = await queueParentMessageRead(selectedMobileUser, selectedLink.id, message)
      const readAt = command.createdAt
      setResources((current) => ({
        ...current,
        messages: {
          ...current.messages,
          items: current.messages.items.map((item) => item.id === message.id ? { ...item, readAt } : item),
        },
      }))
      const pendingView = await readParentOfflineView(selectedMobileUser.id, selectedLink.id)
      setSyncSummary(pendingView.sync)
      if (isOffline) {
        setNotice({ message: 'Read status is saved on this device and will sync when you are online.', tone: 'warning' })
      } else {
        const result = await runParentSync()
        if (result?.results?.some((entry) => entry.commandId === command.commandId && entry.status !== 'succeeded')) {
          await loadParentData()
          setNotice({ message: 'The server could not apply this read update. Your current information has been restored.', tone: 'warning' })
        }
      }
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
      const command = await queueParentPollVote(selectedMobileUser, selectedLink.id, poll, optionId)
      setResources((current) => ({
        ...current,
        polls: {
          ...current.polls,
          items: current.polls.items.map((item) => {
            if (item.id !== poll.id) return item
            const savedOptionIds = Array.isArray(item.currentOptionIds) ? item.currentOptionIds : []
            const nextOptionIds = item.allowMultiple
              ? savedOptionIds.includes(optionId)
                ? item.allowVoteChanges === true ? savedOptionIds.filter((id) => id !== optionId) : savedOptionIds
                : [...new Set([...savedOptionIds, optionId])]
              : [optionId]
            return {
              ...item,
              currentOptionId: nextOptionIds[0] || null,
              currentOptionIds: nextOptionIds,
            }
          }),
        },
      }))
      const pendingView = await readParentOfflineView(selectedMobileUser.id, selectedLink.id)
      setSyncSummary(pendingView.sync)
      if (isOffline) {
        setNotice({ message: 'Your response is saved on this device and will sync when you are online.', tone: 'warning' })
      } else {
        const result = await runParentSync()
        const commandResult = result?.results?.find((entry) => entry.commandId === command.commandId)
        if (commandResult?.status === 'succeeded') {
          setNotice({ message: 'Your response has been saved.', tone: 'success' })
        } else if (commandResult) {
          setNotice({ message: 'This response could not be applied. The current server response has been restored.', tone: 'warning' })
        }
        await loadParentData()
      }
    } catch (error) {
      setNotice({
        message: getParentFriendlyError(error, 'Your poll response could not be saved.'),
        tone: 'error',
      })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleInvitationResponse(invitation, responseState) {
    if (isOffline || activeActionId) return
    setActiveActionId(`invite:${invitation.invitationId}`)
    setNotice(null)
    try {
      await respondToParentInvitation(selectedMobileUser, invitation, responseState)
      await loadParentData()
      setNotice({ message: 'Your invitation response has been saved.', tone: 'success' })
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'Your invitation response could not be saved.'), tone: 'error' })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleMatchTransport(invitation, mode, seatsOffered = 0) {
    if (isOffline || activeActionId) return
    setActiveActionId(`transport:${invitation.invitationId}`)
    setNotice(null)
    try {
      await setParentMatchTransport(selectedMobileUser, invitation, mode, seatsOffered)
      await loadParentData()
      setNotice({ message: 'Your carpool choice has been saved.', tone: 'success' })
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'Your carpool choice could not be saved.'), tone: 'error' })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleAddToCalendar(item) {
    if (isOffline || activeActionId || !item) return
    setActiveActionId(`calendar-share:${item.id || item.invitationId || item.eventId || 'event'}`)
    setNotice(null)
    try {
      await shareParentCalendarItem(item)
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'This event could not be added to your calendar.'), tone: 'warning' })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleOpenParentItem(type, item) {
    if (isOffline || activeActionId) return
    setActiveActionId(`${type}:${item.id}`)
    setNotice(null)
    try {
      const result = type === 'development'
        ? await shareParentMobileDevelopmentPdf({
            apiBaseUrl: config.apiBaseUrl,
            parentLinkId: selectedLink.id,
            report: item,
          })
        : await openParentResource(selectedMobileUser, item.id)
      if (result?.formationBoard) setSelectedResourcePreview(result.formationBoard)
      if (result?.externalUrl) await openExternalParentUrl(result.externalUrl)
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, `This ${type === 'development' ? 'Development report' : 'resource'} could not be opened.`), tone: 'warning' })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleOpenCalendarResource(event, resource) {
    if (isOffline || activeActionId || !event || !resource?.id) return
    setActiveActionId(`calendar-resource:${resource.id}`)
    setNotice(null)

    try {
      const result = await openParentResource(selectedMobileUser, resource.id, {
        calendarEventId: event.sourceId || event.eventId || String(event.id || '').replace(/^calendar:/, ''),
        calendarOccurrenceDate: event.occurrenceDate || event.calendarDate || event.eventDate || getParentProductDateTimeParts(event.startsAt || event.eventStart).date,
      })
      if (result?.formationBoard) setSelectedResourcePreview(result.formationBoard)
      if (result?.externalUrl) await openExternalParentUrl(result.externalUrl)
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'This event attachment could not be opened.'), tone: 'warning' })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleOpenMessageLink(url) {
    if (isOffline || activeActionId) return
    const safeUrl = getSafeParentMessageUrl(url)

    if (!safeUrl) {
      setNotice({ message: 'This message link is not safe to open.', tone: 'warning' })
      return
    }

    setActiveActionId(`message-link:${safeUrl}`)
    setNotice(null)
    try {
      await openExternalParentUrl(safeUrl)
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'This message link could not be opened.'), tone: 'warning' })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleOpenAttentionItem() {
    const items = syncSummary.attentionItems || []
    const item = items[attentionIndex % Math.max(items.length, 1)]
    if (!item) {
      setMoreSection('settings')
      setActiveTab('more')
      return
    }
    setNotice(null)
    if (item.type === 'poll_vote') {
      const targetPoll = visiblePolls.find((poll) => poll.id === item.entityId)
      if (!targetPoll) {
        await handleRefresh()
        setNotice({ message: 'That poll has closed. The attention list has been refreshed.', tone: 'success' })
        return
      }
      setSelectedPollId(targetPoll.id)
      setMoreSection('polls')
      setActiveTab('more')
      return
    }
    if (item.type === 'message_read') {
      const room = parentChatRooms.find((candidate) => candidate.id === 'club-announcements')
      setActiveTab('chat')
      if (room) void handleOpenChatRoom(room)
      return
    }
    setMoreSection('settings')
    setActiveTab('more')
  }

  async function handleOpenMatchLink(url, destination) {
    if (isOffline || activeActionId || !url) return
    setActiveActionId(`match-${destination}`)
    setNotice(null)
    try {
      await openExternalParentUrl(url)
    } catch (error) {
      setNotice({
        message: getParentFriendlyError(error, destination === 'calendar' ? 'The Calendar could not be opened.' : 'Directions could not be opened.'),
        tone: 'warning',
      })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleOpenChatRoom(room) {
    setPendingNotificationRoomId('')
    setSelectedRoomId(room.id)
    if (room.id === 'club-announcements') {
      const items = getParentAnnouncementMessages(visibleMessages)
      setChatMessages({ error: '', items, loading: false })
      const unreadMessages = visibleMessages.filter((message) => normalizeText(message.body) && !message.readAt)
      if (unreadMessages.length) {
        const readAt = new Date().toISOString()
        try {
          await Promise.all(unreadMessages.map((message) => queueParentMessageRead(selectedMobileUser, selectedLink.id, message)))
          setResources((current) => ({
            ...current,
            messages: {
              ...current.messages,
              items: current.messages.items.map((message) => unreadMessages.some((item) => item.id === message.id) ? { ...message, readAt } : message),
            },
          }))
          if (!isOffline) void runParentSync()
        } catch (error) {
          setNotice({ message: getParentFriendlyError(error, 'Announcement read status could not be saved.'), tone: 'warning' })
        }
      }
      return
    }
    if (isOffline) {
      setChatMessages({
        error: resources.chatHistory.error,
        items: resources.chatHistory.items.filter((message) => message.roomId === room.id),
        loading: false,
      })
      return
    }
    setChatMessages({ error: '', items: [], loading: true })
    try {
      const items = await getParentChatMessages(selectedMobileUser, room.id)
      setChatMessages({ error: '', items, loading: false })
      cacheChatRoomMessages(room.id, items)
      if (!isOffline && room.unreadCount > 0) {
        await markParentChatRoomRead(selectedMobileUser, room.id)
        setResources((current) => ({
          ...current,
          chatRooms: { ...current.chatRooms, items: current.chatRooms.items.map((item) => item.id === room.id ? { ...item, unreadCount: 0 } : item) },
        }))
      }
    } catch (error) {
      setChatMessages({ error: getParentFriendlyError(error, 'Chat messages could not be loaded.'), items: [], loading: false })
    }
  }

  async function handleToggleChatRoomNotifications(room, notificationsMuted) {
    if (isOffline || activeActionId || !room?.id) return
    setActiveActionId(`chat-dnd:${room.id}`)
    try {
      await setParentChatRoomNotifications(selectedMobileUser, room.id, notificationsMuted)
      setResources((current) => ({
        ...current,
        chatRooms: {
          ...current.chatRooms,
          items: current.chatRooms.items.map((item) => item.id === room.id
            ? { ...item, notificationsMuted: notificationsMuted === true }
            : item),
        },
      }))
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'This Chat notification setting could not be saved.'), tone: 'warning' })
    } finally {
      setActiveActionId('')
    }
  }

  async function reloadSelectedChatRoom() {
    if (!selectedRoomId) return
    if (selectedRoomId === 'club-announcements') {
      setChatMessages({ error: '', items: getParentAnnouncementMessages(visibleMessages), loading: false })
      return
    }
    const items = await getParentChatMessages(selectedMobileUser, selectedRoomId)
    const changed = getMobileChatMessagesFingerprint(items) !== getMobileChatMessagesFingerprint(chatMessagesRef.current.items)
    setChatMessages({ error: '', items, loading: false })
    chatMessagesRef.current = { error: '', items, loading: false }
    cacheChatRoomMessages(selectedRoomId, items)
    if (changed) {
      await markParentChatRoomRead(selectedMobileUser, selectedRoomId)
      const latestMessage = items[items.length - 1]
      setResources((current) => ({
        ...current,
        chatRooms: {
          ...current.chatRooms,
          items: current.chatRooms.items.map((room) => room.id === selectedRoomId
            ? {
                ...room,
                latestMessage: latestMessage?.deletedAt ? 'Message deleted' : latestMessage?.body || room.latestMessage,
                latestMessageAt: latestMessage?.createdAt || room.latestMessageAt,
                unreadCount: 0,
              }
            : room),
        },
      }))
    }
  }
  reloadSelectedChatRoomRef.current = reloadSelectedChatRoom

  useEffect(() => {
    if (activeTab !== 'chat' || !selectedRoomId || selectedRoomId === 'club-announcements' || isOffline || !selectedLink?.id) return undefined
    const refreshOpenRoom = () => {
      if (AppState.currentState !== 'active') return
      void reloadSelectedChatRoomRef.current().catch(() => {})
    }
    const unsubscribe = subscribeToParentChatRoom(selectedMobileUser, selectedRoomId, { onChange: refreshOpenRoom })
    const interval = setInterval(refreshOpenRoom, 15000)
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshOpenRoom()
    })
    return () => {
      clearInterval(interval)
      appStateSubscription.remove()
      unsubscribe()
    }
  }, [activeTab, isOffline, selectedLink?.id, selectedMobileUser, selectedRoomId])

  function cacheChatRoomMessages(roomId, items) {
    const roomMessages = items.map((message) => ({ ...message, roomId }))
    const nextHistory = [
      ...resources.chatHistory.items.filter((message) => message.roomId !== roomId),
      ...roomMessages,
    ]
    setResources((current) => ({
      ...current,
      chatHistory: { ...current.chatHistory, error: '', items: nextHistory, loading: false },
    }))
    void saveParentOfflineResources(selectedMobileUser, selectedLink.id, {
      ...Object.fromEntries(resourceNames.map((name) => [name, resources[name].items])),
      chatHistory: nextHistory,
    }).catch(() => {})
  }

  async function handleSendChatMessage(body) {
    if (isOffline || activeActionId || !selectedRoomId || selectedRoomId === 'club-announcements') return
    setActiveActionId('chat-send')
    setNotice(null)
    try {
      await sendParentChatMessage(selectedMobileUser, selectedRoomId, body)
      await reloadSelectedChatRoom()
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'Your Chat message could not be sent.'), tone: 'error' })
      throw error
    } finally {
      setActiveActionId('')
    }
  }

  async function handleDeleteChatMessage(message) {
    if (isOffline || activeActionId) return
    setActiveActionId(`chat-delete:${message.id}`)
    try {
      await deleteParentChatMessage(selectedMobileUser, message.id)
      await reloadSelectedChatRoom()
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'This Chat message could not be deleted.'), tone: 'error' })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleScorerInterest(match) {
    if (isOffline || activeActionId) return
    setActiveActionId(`scorer:${match.id}:interest`)
    try {
      await expressParentScorerInterest(selectedMobileUser, match.id)
      await loadParentData()
      setNotice({ message: 'Your scorer interest has been registered with Coaches.', tone: 'success' })
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'Scorer interest could not be registered.'), tone: 'error' })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleScorerAction(match, action, value) {
    if (isOffline || activeActionId || !match.isScorer) return false
    setActiveActionId(`scorer:${match.id}:${action}`)
    setNotice(null)
    try {
      if (action === 'start') await startParentScorerMatch(match.id)
      if (action === 'timer') await setParentScorerTimer(match.id, value)
      if (action === 'extended') await setParentScorerExtendedState(match.id, value)
      if (action === 'score') await updateParentScorerScore(selectedMobileUser, match.id, value.homeScore, value.awayScore)
      if (action === 'goal') {
        const savedEvent = await addParentScorerGoal(selectedMobileUser, match.id, value)
        await sendParentScorerMatchDayPush(selectedMobileUser, match.id, 'goal', savedEvent?.id)
      }
      if (action === 'correct-goal') await correctParentScorerGoal(selectedMobileUser, match, value.event, value.goal, value.reason)
      if (action === 'void-goal') await voidParentScorerGoal(selectedMobileUser, match.id, value.eventId, value.reason)
      if (action === 'shootout') await recordParentScorerShootoutKick(match.id, value)
      if (action === 'void-shootout') await voidParentScorerShootoutKick(match.id, value.kickId, value.reason)
      await loadParentData()
      setNotice({ message: 'Game Day has been updated.', tone: 'success' })
      return true
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'This Game Day change could not be saved.'), tone: 'error' })
      return false
    } finally {
      setActiveActionId('')
    }
  }

  async function handleDisplayThemeChange(theme) {
    if (!['dark', 'light'].includes(theme)) return
    setDisplayTheme(theme)
    await AsyncStorage.setItem(PARENT_THEME_STORAGE_KEY, theme)
  }

  async function handlePasswordChange(currentPassword, nextPassword) {
    if (activeActionId) return
    setActiveActionId('password')
    setNotice(null)
    try {
      await updateParentPassword(selectedMobileUser, currentPassword, nextPassword)
      setNotice({ message: 'Your password has been updated.', tone: 'success' })
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, error.message || 'Your password could not be updated.'), tone: 'error' })
      throw error
    } finally {
      setActiveActionId('')
    }
  }

  async function handleDisplayNameChange(displayName) {
    if (activeActionId) return
    setActiveActionId('display-name')
    setNotice(null)
    try {
      const authUser = await updateParentDisplayName(displayName)
      await refreshUserProfile(authUser)
      setNotice({ message: 'Your display name has been updated.', tone: 'success' })
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, error.message || 'Your display name could not be updated.'), tone: 'error' })
      throw error
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
      setBiometricStateStatus(MOBILE_SETTING_LOAD_STATES.READY)
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

  async function handleNotificationModeChange(mode) {
    if (activeActionId || !selectedLink?.id) return
    const currentMode = notificationState.enabled ? notificationState.detailLevel : 'off'
    if (mode === currentMode) return
    setActiveActionId('notifications')
    setNotice(null)
    try {
      const nextState = mode === 'off'
        ? await updateParentNotificationPreference({
            apiBaseUrl: config.apiBaseUrl,
            detailLevel: notificationState.detailLevel,
            enabled: false,
          })
        : notificationState.enabled
          ? await updateParentNotificationPreference({
              apiBaseUrl: config.apiBaseUrl,
              detailLevel: mode,
              enabled: true,
            })
          : await enableParentNotifications({
              apiBaseUrl: config.apiBaseUrl,
              detailLevel: mode,
              easProjectId: config.easProjectId,
              parentLinkId: selectedLink.id,
            })
      setNotificationState(nextState)
      setNotificationStateStatus(MOBILE_SETTING_LOAD_STATES.READY)
      setNotice({
        message: nextState.enabled
          ? `Notifications are on with ${nextState.detailLevel === 'detailed' ? 'Detailed' : 'Minimal'} content.`
          : nextState.message || 'Notifications are off. The rest of the app is unchanged.',
        tone: nextState.enabled ? 'success' : 'warning',
      })
    } catch (error) {
      console.warn('Parent notification setup failed.', normalizeText(error?.code) || 'unknown')
      const message = getParentFriendlyError(error, 'Notification settings could not be changed.')
      setNotificationState((current) => preserveMobileNotificationState(current, message))
      setNotificationStateStatus(MOBILE_SETTING_LOAD_STATES.STALE)
      setNotice({
        message,
        tone: 'warning',
      })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleAppBadgeEnabledChange(enabled) {
    if (activeActionId) return
    setActiveActionId('app-icon-badge')
    setNotice(null)
    try {
      const nextEnabled = await writeMobileAppBadgeEnabled('parent', enabled)
      setAppBadgeEnabled(nextEnabled)
      if (nextEnabled) {
        await syncMobileAppBadge({ appRole: 'parent', count: latestBadgeCountRef.current })
      }
      setNotice({
        message: nextEnabled ? 'App icon badge is enabled on this device.' : 'App icon badge is disabled and cleared.',
        tone: 'success',
      })
    } catch (error) {
      setNotice({
        message: getParentFriendlyError(error, 'App icon badge could not be changed.'),
        tone: 'warning',
      })
    } finally {
      setActiveActionId('')
    }
  }

  function handleDismissParentItem(kind, id, label = 'item') {
    if (!dismissalStorageKey || !['development', 'invitations', 'matches', 'messages', 'polls', 'resources'].includes(kind) || !id) return
    Alert.alert(
      `Remove this ${label}?`,
      'This hides it from lists on this device. It does not delete the club record or its audit history.',
      [
        { style: 'cancel', text: 'Cancel' },
        { style: 'destructive', text: 'Remove', onPress: () => {
          if (kind === 'messages') setChatMessages((current) => ({ ...current, items: current.items.filter((message) => message.legacyMessageId !== id) }))
          setDismissedItems((current) => {
            const next = { ...current, [kind]: [...new Set([...(current[kind] || []), id])] }
            void AsyncStorage.setItem(dismissalStorageKey, JSON.stringify(next)).catch(() => {})
            return next
          })
        } },
      ],
    )
  }

  async function handleRestoreDismissedItems() {
    if (dismissalStorageKey) await AsyncStorage.removeItem(dismissalStorageKey)
    setDismissedItems({ development: [], invitations: [], matches: [], messages: [], polls: [], resources: [] })
    setNotice({ message: 'Hidden Parent items are visible again.', tone: 'success' })
  }

  async function handleCommunicationChannelChange(communicationChannel) {
    if (activeActionId || communicationChannel === communicationPreference.communicationChannel) return
    setActiveActionId('communication-channel')
    setNotice(null)
    try {
      const nextPreference = await updateParentCommunicationChannel(config.apiBaseUrl, communicationChannel)
      setCommunicationPreference(nextPreference)
      setNotice({ message: 'Your communication choice has been saved for Email and app notifications.', tone: 'success' })
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'Your communication choice could not be saved.'), tone: 'warning' })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleTestNotification(intentType) {
    if (activeActionId || !notificationState.enabled) return
    setActiveActionId('notification-test')
    setNotice(null)
    try {
      await sendParentTestNotification({ apiBaseUrl: config.apiBaseUrl, intentType })
      setNotice({ message: 'A controlled test notification was sent to this installation.', tone: 'success' })
    } catch (error) {
      setNotice({
        message: getParentFriendlyError(error, 'The test notification could not be sent.'),
        tone: 'warning',
      })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleOpenNotification(notification) {
    const notificationIds = Array.isArray(notification?.notificationIds) && notification.notificationIds.length
      ? notification.notificationIds
      : [notification?.id].filter(Boolean)
    const notificationIdSet = new Set(notificationIds.map((id) => normalizeText(id)))
    setResources((current) => ({
      ...current,
      notifications: {
        ...current.notifications,
        items: current.notifications.items.map((item) => notificationIdSet.has(normalizeText(item.id)) ? { ...item, isRead: true } : item),
      },
    }))
    void markParentOfflineNotificationRead(selectedMobileUser, selectedLink.id, notificationIds).catch(() => {})
    void markParentNotificationRead(selectedMobileUser, notificationIds).catch(() => {})

    const currentItems = Object.fromEntries(resourceNames.map((name) => [name, resources[name].items]))
    let destination = resolveParentNotificationOpen(notification?.data, getParentNotificationTargets(currentItems))
    if (!destination) {
      setNotice({ message: 'That notification destination is not available.', tone: 'warning' })
      return
    }
    if (destination.tab === 'messages') {
      const legacyMessage = resources.messages.items.find((message) => message.id === destination.targetId)
      if (normalizeText(legacyMessage?.body)) destination = { tab: 'chat', targetId: 'club-announcements' }
      else if (legacyMessage?.evaluationId) destination = { tab: 'development', targetId: legacyMessage.evaluationId }
    }
    applyParentNotificationDestination(destination)
    if (destination.tab !== 'chat' || !destination.targetId) return
    const room = parentChatRooms.find((candidate) => candidate.id === destination.targetId)
    if (room) void handleOpenChatRoom(room)
    else setNotice({ message: 'That Chat is no longer available. Your current Chat rooms are shown.', tone: 'warning' })
  }

  useEffect(() => {
    const unreadChatCount = parentChatRooms.reduce(
      (total, room) => total + Number(room.unreadCount || 0),
      0,
    )
    const unreadNotificationCount = countUnreadNonChatNotifications(resources.notifications.items)
    const resourcesLoaded = resources.notifications.loading === false
      && resources.chatRooms.loading === false
      && resources.messages.loading === false
      && resources.polls.loading === false
      && resources.invitations.loading === false
    const badgeCount = getParentAppBadgeUpdate({
      authenticated: Boolean(user),
      count: getParentAppBadgeCount({
        unreadChat: unreadChatCount,
        unreadNotifications: unreadNotificationCount,
      }),
      resourcesLoaded,
    })
    if (badgeCount === null) return
    latestBadgeCountRef.current = badgeCount
    void syncMobileAppBadge({ appRole: 'parent', count: badgeCount }).catch(() => {})
  }, [parentChatRooms, resources.chatRooms.loading, resources.invitations.loading, resources.messages.loading, resources.notifications.items, resources.notifications.loading, resources.polls.loading, user])

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
  const selectedMatch = visibleMatches.find((match) => match.id === selectedMatchId)
  const matchInvitations = visibleInvitationsWithMatchTimes.filter((invitation) => (
    ['match_attendance', 'match_role'].includes(invitation.invitationType)
  ))
  const unansweredInvites = getParentInvitationSections(visibleInvitations).needsResponse.length
  const unreadChat = parentChatRooms.reduce((total, room) => total + Number(room.unreadCount || 0), 0)
  const tabs = [
    { key: 'home', label: 'Home' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'matchday', label: 'Matchday' },
    { count: unreadChat, key: 'chat', label: 'Chat' },
    { count: homeModel.unansweredPolls + unansweredInvites, key: 'more', label: 'More' },
  ]
  const focusedChatRoom = activeTab === 'chat' && Boolean(selectedRoom)

  return (
    <ParentThemeContext.Provider value={themeContext}>
    <SafeAreaView style={[styles.safeArea, displayTheme === 'light' && styles.safeAreaLight]}>
      <StatusBar style={displayTheme === 'light' ? 'dark' : 'light'} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS === 'ios' || focusedChatRoom}
        style={styles.keyboardShell}
      >
        {!focusedChatRoom ? <AppHeader
          childCount={parentLinks.length}
          childSwitcherOpen={childSwitcherOpen}
          links={parentLinks}
          onChildChange={handleChildChange}
          notificationState={notificationState}
          notificationStateStatus={notificationStateStatus}
          onOpenNotificationSettings={openNotificationSettings}
          onToggleChildSwitcher={() => setChildSwitcherOpen((open) => !open)}
          selectedLink={selectedLink}
          theme={displayTheme}
        /> : null}

        {activeTab === 'chat' ? (
          <View style={[styles.contentColumn, styles.chatRouteContent]}>
            {!focusedChatRoom ? <SyncStatus attentionIndex={attentionIndex} cacheState={offlineCacheState} isOffline={isOffline} isSyncing={isSyncing} onNextAttention={() => setAttentionIndex((current) => (current + 1) % Math.max(syncSummary.needsAttention, 1))} onOpenAttention={handleOpenAttentionItem} summary={syncSummary} /> : null}
            {notice ? <Notice message={notice.message} onDismiss={() => setNotice(null)} tone={notice.tone} /> : null}
            <ChatScreen
              activeActionId={activeActionId}
              isOffline={isOffline}
              link={selectedLink}
              messages={chatMessages}
              onBack={() => { setSelectedRoomId(''); setPendingNotificationRoomId('') }}
              onDelete={handleDeleteChatMessage}
              onDismissAnnouncement={(message) => handleDismissParentItem('messages', message.legacyMessageId, 'announcement')}
              onOpenRoom={handleOpenChatRoom}
              onSend={handleSendChatMessage}
              onToggleRoomNotifications={handleToggleChatRoomNotifications}
              rooms={{ ...resources.chatRooms, items: parentChatRooms }}
              selectedRoom={selectedRoom}
              theme={displayTheme}
              themeTokens={themeModel.tokens}
            />
          </View>
        ) : <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          ref={scrollViewRef}
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
            <SyncStatus
              attentionIndex={attentionIndex}
              cacheState={offlineCacheState}
              isOffline={isOffline}
              isSyncing={isSyncing}
              onNextAttention={() => setAttentionIndex((current) => (current + 1) % Math.max(syncSummary.needsAttention, 1))}
              onOpenAttention={handleOpenAttentionItem}
              summary={syncSummary}
            />
            {notice ? <Notice message={notice.message} onDismiss={() => setNotice(null)} tone={notice.tone} /> : null}

            {activeTab === 'home' ? (
              <HomeScreen
                activeActionId={activeActionId}
                calendar={resources.calendar}
                homeModel={homeModel}
                link={selectedLink}
                matchInvitations={matchInvitations}
                matches={{ ...resources.matches, items: visibleMatches }}
                messages={{ ...resources.messages, items: visibleMessages }}
                notifications={resources.notifications}
                isOffline={isOffline}
                onOpenInvites={() => { setMoreSection('invites'); setActiveTab('more') }}
                onOpenCalendar={() => setActiveTab('calendar')}
                onOpenMatch={(match) => setSelectedMatchId(match.id)}
                onOpenLink={handleOpenMatchLink}
                onOpenMessages={() => {
                  const room = parentChatRooms.find((candidate) => candidate.id === 'club-announcements')
                  setActiveTab('chat')
                  if (room) void handleOpenChatRoom(room)
                }}
                onOpenNotification={handleOpenNotification}
                onOpenPolls={() => { setMoreSection('polls'); setActiveTab('more') }}
                onOpenResource={handleOpenCalendarResource}
                onRetry={handleRefresh}
                selectedMatch={selectedMatch}
              />
            ) : null}
            {activeTab === 'calendar' ? <CalendarScreen activeActionId={activeActionId} invitations={visibleInvitationsWithMatchTimes} isOffline={isOffline} link={selectedLink} onAddToCalendar={handleAddToCalendar} onDateSelected={() => setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50)} onOpenInvitation={(invitation) => { setSelectedInvitationId(invitation.invitationId); setMoreSection('invites'); setActiveTab('more') }} onOpenLink={handleOpenMatchLink} onOpenResource={handleOpenCalendarResource} onRespond={handleInvitationResponse} onTransport={handleMatchTransport} resource={resources.calendar} theme={displayTheme} themeTokens={themeModel.tokens} /> : null}
            {activeTab === 'matchday' ? (
              <MatchdayScreen
                activeActionId={activeActionId}
                isOffline={isOffline}
                link={selectedLink}
                onBack={() => setSelectedMatchId('')}
                onDismiss={(match) => handleDismissParentItem('matches', match.id, 'match')}
                onLiveRefresh={refreshParentMatchDay}
                onOpen={(match) => setSelectedMatchId(match.id)}
                onAddToCalendar={handleAddToCalendar}
                onOpenLink={handleOpenMatchLink}
                onScorerAction={handleScorerAction}
                onVolunteer={handleScorerInterest}
                players={matchDayPlayers}
                resource={{ ...resources.matches, items: visibleMatches }}
                selectedMatch={selectedMatch}
                theme={displayTheme}
                themeTokens={themeModel.tokens}
              />
            ) : null}
            {activeTab === 'more' && !moreSection ? (
              <MoreScreen
                onOpen={setMoreSection}
                theme={displayTheme}
                themeTokens={themeModel.tokens}
                unansweredInvites={unansweredInvites}
                unansweredPolls={homeModel.unansweredPolls}
              />
            ) : null}
            {activeTab === 'more' && moreSection ? <BackButton label="Back to More" onPress={() => { setMoreSection(''); setSelectedInvitationId(''); setSelectedMessageId(''); setSelectedPollId('') }} /> : null}
            {activeTab === 'more' && moreSection === 'invites' ? (
              <InvitationsScreen activeActionId={activeActionId} isOffline={isOffline} link={selectedLink} onAddToCalendar={handleAddToCalendar} onBackTarget={() => setSelectedInvitationId('')} onDismiss={(invitation) => handleDismissParentItem('invitations', invitation.invitationId, 'request')} onOpenResource={handleOpenCalendarResource} onRespond={handleInvitationResponse} onTransport={handleMatchTransport} resource={{ ...resources.invitations, items: visibleInvitationsWithMatchTimes }} targetInvitationId={selectedInvitationId} theme={displayTheme} themeTokens={themeModel.tokens} />
            ) : null}
            {activeTab === 'more' && moreSection === 'results' ? <ResultsScreen link={selectedLink} resource={{ ...resources.matches, items: visibleMatches }} theme={displayTheme} themeTokens={themeModel.tokens} /> : null}
            {activeTab === 'more' && moreSection === 'development' ? <DevelopmentScreen isOffline={isOffline} onDismiss={(report) => handleDismissParentItem('development', report.id, 'report')} onOpen={(report) => handleOpenParentItem('development', report)} resource={{ ...resources.development, items: visibleDevelopment }} theme={displayTheme} themeTokens={themeModel.tokens} /> : null}
            {activeTab === 'more' && moreSection === 'resources' ? <ResourcesScreen formationBoard={selectedResourcePreview} isOffline={isOffline} onCloseFormation={() => setSelectedResourcePreview(null)} onDismiss={(item) => handleDismissParentItem('resources', item.id, 'resource')} onOpen={(item) => handleOpenParentItem('resource', item)} resource={{ ...resources.resources, items: visibleResources }} theme={displayTheme} themeTokens={themeModel.tokens} /> : null}
            {activeTab === 'more' && moreSection === 'messages' ? (
              <MessagesScreen
                activeActionId={activeActionId}
                development={resources.development}
                isOffline={isOffline}
                link={selectedLink}
                onBack={() => setSelectedMessageId('')}
                onOpenDevelopment={(report) => handleOpenParentItem('development', report)}
                onOpenLink={handleOpenMessageLink}
                onOpen={handleOpenMessage}
                onRetry={handleRefresh}
                resource={resources.messages}
                selectedMessage={selectedMessage}
              />
            ) : null}
            {activeTab === 'more' && moreSection === 'polls' ? (
              <PollsScreen
                activeActionId={activeActionId}
                drafts={pollDrafts}
                link={selectedLink}
                onDraftChange={(pollId, optionId) => setPollDrafts((current) => ({ ...current, [pollId]: optionId }))}
                onDismiss={(poll) => handleDismissParentItem('polls', poll.id, 'poll')}
                onRetry={handleRefresh}
                onSubmit={handlePollSubmit}
                resource={{ ...resources.polls, items: visiblePolls }}
                targetPollId={selectedPollId}
              />
            ) : null}
            {activeTab === 'more' && moreSection === 'settings' ? (
              <SettingsScreen
                key={`settings-${user.id || user.email || 'parent'}-${user.displayName || user.name || ''}`}
                activeActionId={activeActionId}
                appBadgeEnabled={appBadgeEnabled}
                biometricAvailable={biometricAvailable}
                biometricEnabled={biometricEnabled}
                biometricStateStatus={biometricStateStatus}
                cacheState={offlineCacheState}
                isOffline={isOffline}
                isSyncing={isSyncing}
                lastUpdatedAt={lastUpdatedAt}
                links={parentLinks}
                onBiometricChange={handleBiometricChange}
                onAppBadgeEnabledChange={handleAppBadgeEnabledChange}
                displayTheme={displayTheme}
                communicationPreference={communicationPreference}
                notificationState={notificationState}
                notificationStateStatus={notificationStateStatus}
                notificationSettingsFocusRequest={notificationSettingsFocusRequest}
                onCommunicationChannelChange={handleCommunicationChannelChange}
                onNotificationModeChange={handleNotificationModeChange}
                onNotificationSettingsFocus={focusNotificationSettings}
                onRetryBiometricState={retryParentBiometricState}
                onRetryNotificationState={() => reloadParentNotificationState()}
                onDisplayThemeChange={handleDisplayThemeChange}
                onDisplayNameChange={handleDisplayNameChange}
                onPasswordChange={handlePasswordChange}
                onRestoreDismissedItems={handleRestoreDismissedItems}
                onSendTestNotification={handleTestNotification}
                onRetrySync={async () => {
                  const result = await runParentSync({ explicitRetry: true })
                  await loadParentData()
                  setNotice(result?.needsAttention > 0
                    ? { message: 'An action still needs attention.', tone: 'warning' }
                    : { message: 'Sync is up to date.', tone: 'success' })
                }}
                onSignOut={signOut}
                syncSummary={syncSummary}
                hiddenItemCount={Object.values(dismissedItems).reduce((total, items) => total + items.length, 0)}
                user={user}
              />
            ) : null}
          </View>
        </ScrollView>}

        {!focusedChatRoom ? <BottomTabs activeTab={activeTab} onChange={handleTabChange} tabs={tabs} theme={displayTheme} /> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
    </ParentThemeContext.Provider>
  )
}

function ClubBrandLogo({ link }) {
  const { branding, styles } = useParentTheme()
  const [remoteFailed, setRemoteFailed] = useState(false)
  const remoteUrl = branding.clubLogoUrl

  return (
    <Image
      accessibilityIgnoresInvertColors
      accessibilityLabel={remoteUrl && !remoteFailed ? `${link?.clubName || 'Club'} logo` : 'Football Player Parents'}
      onError={() => setRemoteFailed(true)}
      resizeMode="contain"
      source={remoteUrl && !remoteFailed ? { uri: remoteUrl } : require('./assets/football-player-logo.png')}
      style={styles.headerLogo}
    />
  )
}

function AppHeader({ childCount, childSwitcherOpen, links, notificationState, notificationStateStatus, onChildChange, onOpenNotificationSettings, onToggleChildSwitcher, selectedLink, theme }) {
  const { palette, styles } = useParentTheme()
  const isLight = theme === 'light'
  return (
    <View style={[styles.header, isLight && styles.headerLight]}>
      <View style={styles.brandRow}>
        <ClubBrandLogo key={`${selectedLink?.id || 'default'}:${selectedLink?.clubLogoUrl || ''}`} link={selectedLink} />
        <View style={styles.brandCopy}>
          <Text style={[styles.brandName, isLight && styles.textLight]}>Football Player Parents</Text>
          <Text numberOfLines={1} style={[styles.brandMeta, isLight && styles.textMutedLight]}>
            {selectedLink?.clubName || 'Private family view'}
          </Text>
        </View>
        <NotificationStatusButton
          notificationState={notificationState}
          notificationStateStatus={notificationStateStatus}
          onPress={onOpenNotificationSettings}
        />
      </View>

      {childCount > 0 ? (
        <>
          <Pressable
            accessibilityHint={childCount > 1 ? 'Shows your linked children' : 'Shows the active child'}
            accessibilityLabel={`Active child ${selectedLink?.playerName || 'not selected'}`}
            accessibilityRole="button"
            disabled={childCount <= 1}
            onPress={onToggleChildSwitcher}
            style={({ pressed }) => [styles.childButton, isLight && styles.surfaceLight, pressed && styles.pressed]}
          >
            <MaterialIcons color={palette.accent} name="account-circle" size={30} />
            <View style={styles.childButtonCopy}>
              <Text style={[styles.childButtonEyebrow, isLight && styles.textMutedLight]}>Active child</Text>
              <Text numberOfLines={1} style={[styles.childButtonName, isLight && styles.textLight]}>{selectedLink?.playerName || 'Choose a child'}</Text>
              <Text numberOfLines={1} style={[styles.childButtonTeam, isLight && styles.textMutedLight]}>{selectedLink?.teamName || 'No Team assigned'}</Text>
            </View>
            {childCount > 1 ? <Text style={styles.childButtonAction}>{childSwitcherOpen ? 'Close' : 'Switch'}</Text> : null}
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
                    style={[styles.childOption, isLight && styles.surfaceLight, active && styles.childOptionActive]}
                  >
                    <Text style={[styles.childOptionName, isLight && styles.textLight, active && styles.childOptionNameActive]}>{link.playerName}</Text>
                    <Text style={[styles.childOptionTeam, isLight && styles.textMutedLight, active && styles.childOptionTeamActive]}>{link.teamName || 'No Team assigned'}</Text>
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

function NotificationStatusButton({ notificationState, notificationStateStatus, onPress }) {
  const { palette, styles } = useParentTheme()
  const indicator = getMobileNotificationIndicator(notificationState, notificationStateStatus)
  return (
    <Pressable
      accessibilityHint="Opens the Notifications section in Settings"
      accessibilityLabel={indicator.accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.notificationStatusButton, pressed && styles.pressed]}
    >
      <MaterialIcons
        color={indicator.enabled ? palette.accent : palette.textMuted}
        name={getMobileIconName(indicator.iconKey)}
        size={27}
      />
    </Pressable>
  )
}

function BottomTabs({ activeTab, onChange, tabs, theme }) {
  const { palette, styles } = useParentTheme()
  const isLight = theme === 'light'
  return (
    <View accessibilityLabel="Parent app navigation" style={[styles.tabBar, isLight && styles.tabBarLight]}>
      {tabs.map((tab) => {
        const active = activeTab === tab.key
        return (
          <Pressable
            accessibilityLabel={tab.count > 0 ? `${tab.label}, ${tab.count} new` : tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.tabButton, active && styles.tabButtonActive, isLight && active && styles.tabButtonActiveLight, pressed && styles.pressed]}
          >
            <MaterialIcons color={active ? palette.accent : palette.textMuted} name={getMobileIconName(getParentTabIconKey(tab.key))} size={23} />
            <Text style={[styles.tabLabel, isLight && styles.textMutedLight, active && styles.tabLabelActive]}>{tab.label}</Text>
            {tab.count > 0 ? <Text style={[styles.tabCount, active && styles.tabCountActive]}>{tab.count}</Text> : null}
          </Pressable>
        )
      })}
    </View>
  )
}

function getNotificationTypeLabel(intentType) {
  return ({
    matchday_update: 'MATCH',
    parent_chat: 'CHAT',
    parent_message: 'NEWS',
    parent_poll: 'POLL',
    poll_results: 'RESULT',
    resource_shared: 'FILE',
    training_update: 'TRAINING',
    calendar_update: 'CALENDAR',
  })[normalizeText(intentType).toLowerCase()] || 'UPDATE'
}

function getNotificationTypeIcon(intentType) {
  return ({
    matchday_update: 'event',
    parent_chat: 'chat',
    parent_message: 'campaign',
    parent_poll: 'poll',
    poll_results: 'emoji-events',
    resource_shared: 'folder',
    training_update: 'event-available',
    calendar_update: 'event-repeat',
  })[normalizeText(intentType).toLowerCase()] || 'notifications'
}

function HomeScreen({ activeActionId, calendar, homeModel, isOffline, link, matchInvitations = [], matches, messages, notifications, onOpenCalendar, onOpenInvites, onOpenLink, onOpenMatch, onOpenMessages, onOpenNotification, onOpenPolls, onOpenResource, onRetry, selectedMatch }) {
  const { palette, styles } = useParentTheme()
  const unreadNotifications = prepareParentNotificationInbox(notifications.items.filter((notification) => !notification.isRead))
  const homeFixtures = getParentHomeFixtureCards(homeModel)
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
  const pendingMatchRequests = matchInvitations.filter((invitation) => invitation.isPending)
  const nextDirectionsUrl = homeModel.nextActivity?.type === 'match'
    ? getParentMatchDirectionsUrl(homeModel.nextActivity.item, Platform.OS)
    : homeModel.nextActivity?.type === 'calendar'
      ? getParentCalendarDirectionsUrl(homeModel.nextActivity.item, Platform.OS)
      : ''

  return (
    <View style={styles.screenStack}>
      {isInitialLoading ? <LoadingPanel message="Loading your family updates" /> : null}
      <ResourceError onRetry={onRetry} resource={matches} title="Matchday unavailable" />
      <ResourceError onRetry={onRetry} resource={calendar} title="Calendar unavailable" />

      <View accessibilityLabel="Family actions" style={styles.summaryGrid}>
        <SummaryButton count={homeModel.unreadMessages} iconKey="parent.updates" label="Updates" onPress={onOpenMessages} />
        <SummaryButton count={homeModel.unansweredPolls} iconKey="parent.polls" label="Polls" onPress={onOpenPolls} />
        <SummaryButton count={pendingMatchRequests.length} iconKey="parent.match" label="Matches" onPress={onOpenInvites} />
        <SummaryButton iconKey="parent.calendar" label="Calendar" onPress={onOpenCalendar} />
        <SummaryButton disabled={!nextDirectionsUrl} iconKey="parent.directions" label="Directions" onPress={() => onOpenLink?.(nextDirectionsUrl, 'directions')} />
      </View>

      {!isInitialLoading ? (
        <>
          <SectionHeading copy="The nearest Parent-visible fixture or event." title="Next up" />
          {homeModel.nextActivity?.type === 'match' ? (
            <MatchPreviewCard match={homeModel.nextActivity.item} onPress={onOpenMatch} prominent />
          ) : homeModel.nextActivity?.type === 'calendar' ? (
            <CalendarCard activeActionId={activeActionId} event={homeModel.nextActivity.item} isOffline={isOffline} onOpenLink={onOpenLink} onOpenResource={onOpenResource} prominent />
          ) : (
            <EmptyPanel message="There are no upcoming fixtures or shared calendar events right now." title="Nothing scheduled" />
          )}
        </>
      ) : null}

      {unreadNotifications.length > 0 ? (
        <View style={styles.sectionStack}>
          <SectionHeading copy="Tap an update to open the right place." title="Notifications" />
          {unreadNotifications.slice(0, 8).map((notification) => (
            <Pressable
              accessibilityHint="Opens this update"
              accessibilityLabel={`${getNotificationTypeLabel(notification.intentType)}: ${notification.title}`}
              accessibilityRole="button"
              key={notification.id}
              onPress={() => onOpenNotification(notification)}
              style={({ pressed }) => [styles.card, !notification.isRead && styles.cardProminent, pressed && styles.pressed]}
            >
              <View style={styles.notificationRow}>
                <View style={styles.notificationIcon}>
                  <MaterialIcons color={palette.accent} name={getNotificationTypeIcon(notification.intentType)} size={23} />
                </View>
                <View style={styles.notificationContent}>
                  <View style={styles.cardTopRow}>
                    <Badge label={getNotificationTypeLabel(notification.intentType)} tone={notification.isRead ? 'neutral' : 'accent'} />
                    <Text style={styles.cardDate}>{formatDateTime(notification.sentAt || notification.createdAt)}</Text>
                  </View>
                  <Text style={styles.cardTitle}>{notification.title}</Text>
                  <Text numberOfLines={2} style={styles.bodyText}>{notification.body}</Text>
                  <Text style={styles.cardLink}>{notification.isRead ? 'Open' : 'New, tap to open'}</Text>
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {homeFixtures.length > 0 ? (
        <View style={styles.sectionStack}>
          <SectionHeading copy="Upcoming Parent-visible Matchday items." title="Fixtures" />
          {homeFixtures.map((match) => (
            <MatchPreviewCard key={match.id} match={match} onPress={onOpenMatch} />
          ))}
        </View>
      ) : null}

      {homeModel.upcomingCalendarEvents.length > 0 ? (
        <View style={styles.sectionStack}>
          <SectionHeading copy="Training, meetings and club events shared with your family." title="Calendar" />
          {homeModel.upcomingCalendarEvents.slice(0, 4).map((event) => (
            <CalendarCard activeActionId={activeActionId} event={event} isOffline={isOffline} key={event.id} onOpenLink={onOpenLink} onOpenResource={onOpenResource} />
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
  const { palette, styles } = useParentTheme()
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
      style={({ pressed }) => [styles.card, styles.homeCard, prominent && styles.cardProminent, pressed && styles.pressed]}
    >
      <View style={styles.cardTopRow}>
        <Badge label={status} tone={match.status === 'cancelled' ? 'danger' : match.status === 'live' ? 'accent' : 'neutral'} />
        <Text style={styles.cardDate}>{formatDateOnly(match.matchDate)}</Text>
      </View>
      <View style={styles.homeCardTitleRow}><MaterialIcons color={palette.accent} name={getMobileIconName('parent.match')} size={23} /><Text style={styles.cardTitle}>{match.teamName || 'Team'} v {match.opponent || 'Opponent'}</Text><MaterialIcons color={palette.accent} name="chevron-right" size={21} /></View>
      <Text style={styles.cardMeta}>{match.arrivalTime ? `Arrival: ${formatTime(match.arrivalTime)}` : `Kick-off: ${formatTime(match.kickoffTime, match.kickoffTimeTbc)}`}</Text>
      <Text style={styles.cardMeta}>{getMatchDayShirtChoiceLabel(match.shirtChoice)}</Text>
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
  const { styles } = useParentTheme()
  const [squadOpen, setSquadOpen] = useState(false)
  const squadNames = [...new Set((match.confirmedTeam || []).map(normalizeText).filter(Boolean))]
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
        <InfoRow label="Kits" value={getMatchDayShirtChoiceLabel(match.shirtChoice)} />
        <InfoRow label="Location" value={[match.venueName, match.venueAddress].filter(Boolean).join(', ') || 'Location not shared'} />
        <InfoRow label="Availability" value={labelize(match.availabilityStatus) || 'No response requested'} />
        <InfoRow label="Selection" value={selectionLabel} />
      </InfoPanel>

      <PrimaryAction
        label={squadOpen ? 'Hide squad' : `See squad (${squadNames.length})`}
        onPress={() => setSquadOpen((open) => !open)}
        secondary
      />
      {squadOpen ? (
        <InfoPanel title="Selected and confirmed squad">
          <Text style={styles.helperText}>Only Players who are both Available and Selected are shown. Automatic selections appear after this fixture refreshes.</Text>
          {squadNames.length
            ? squadNames.map((playerName) => <Text key={playerName} style={styles.bodyText}>{playerName}</Text>)
            : <Text style={styles.bodyText}>No Available and Selected Players are confirmed yet.</Text>}
        </InfoPanel>
      ) : null}

      {match.notes ? (
        <InfoPanel title="Shared notes">
          <Text style={styles.bodyText}>{match.notes}</Text>
        </InfoPanel>
      ) : null}

    </View>
  )
}

function CalendarCard({ activeActionId, event, isOffline, onOpenLink, onOpenResource, prominent = false }) {
  const { palette, styles } = useParentTheme()
  const cancelled = event.status === 'cancelled' || Boolean(event.cancelledAt)
  const directionsUrl = getParentCalendarDirectionsUrl(event, Platform.OS)
  return (
    <View style={[styles.card, styles.homeCard, prominent && styles.cardProminent]}>
      <View style={styles.cardTopRow}>
        <Badge label={cancelled ? 'Cancelled' : labelize(event.eventType)} tone={cancelled ? 'danger' : 'neutral'} />
        <Text style={styles.cardDate}>{formatDateTime(event.startsAt)}</Text>
      </View>
      <View style={styles.homeCardTitleRow}><MaterialIcons color={palette.accent} name={getMobileIconName('parent.calendar')} size={23} /><Text style={styles.cardTitle}>{event.title}</Text></View>
      {event.location ? <Text style={styles.cardMeta}>{event.location}</Text> : null}
      {event.notes ? <Text numberOfLines={2} style={styles.bodyText}>{event.notes}</Text> : null}
      {Array.isArray(event.resources) && event.resources.length > 0 ? (
        <View style={styles.sectionStack}>
          <Text style={styles.cardMeta}>Attachments</Text>
          {event.resources.map((resource) => (
            <PrimaryAction
              disabled={isOffline || Boolean(activeActionId)}
              key={resource.id}
              label={activeActionId === `calendar-resource:${resource.id}` ? 'Opening...' : `Open ${resource.title}`}
              onPress={() => onOpenResource?.(event, resource)}
              secondary
            />
          ))}
        </View>
      ) : null}
      {directionsUrl ? <Pressable accessibilityLabel="Get directions" accessibilityRole="button" onPress={() => onOpenLink?.(directionsUrl, 'directions')} style={({ pressed }) => [styles.homeInlineAction, pressed && styles.pressed]}><MaterialIcons color={palette.accent} name={getMobileIconName('parent.directions')} size={19} /><Text style={styles.homeInlineActionText}>Get directions</Text></Pressable> : null}
    </View>
  )
}

function MessagesScreen({ activeActionId, development = { items: [] }, isOffline, link, onBack, onOpen, onOpenDevelopment, onOpenLink, onRetry, resource, selectedMessage }) {
  const { styles } = useParentTheme()
  if (!link?.id) return <EmptyPanel message="No active child link is available for announcements." title="Club announcements unavailable" />
  if (selectedMessage) {
    const linkedReport = development.items.find((report) => String(report.id) === String(selectedMessage.evaluationId)) || null
    const developmentPdfAvailable = linkedReport?.canDownloadPdf === true
    const developmentPdfUnavailable = Boolean(selectedMessage.evaluationId) && !developmentPdfAvailable

    return (
      <View style={styles.screenStack}>
        <BackButton label="Back to Club Announcements" onPress={onBack} />
        <View style={styles.heroCard}>
          <View style={styles.cardTopRow}>
            <Badge label={selectedMessage.readAt ? 'Read' : 'Unread'} tone={selectedMessage.readAt ? 'neutral' : 'accent'} />
            <Text style={styles.cardDate}>{formatDateTime(selectedMessage.createdAt)}</Text>
          </View>
          <Text accessibilityRole="header" style={styles.detailTitle}>{selectedMessage.subject}</Text>
          <Text style={styles.cardMeta}>From {selectedMessage.senderName || 'Your club'}</Text>
          {activeActionId === `message:${selectedMessage.id}` ? <LoadingLine label="Updating read status" /> : null}
        </View>
        <InfoPanel title="Announcement">
          <Text selectable style={styles.messageBody}>{selectedMessage.body || 'No message text was provided.'}</Text>
        </InfoPanel>
        {(selectedMessage.links || []).map((url) => (
          <PrimaryAction
            disabled={isOffline}
            key={url}
            label="Open secure link"
            loading={activeActionId === `message-link:${url}`}
            onPress={() => onOpenLink(url)}
            secondary
          />
        ))}
        {developmentPdfAvailable ? (
          <PrimaryAction
            disabled={isOffline}
            label="View Development PDF"
            loading={activeActionId === `development:${linkedReport.id}`}
            onPress={() => onOpenDevelopment(linkedReport)}
          />
        ) : null}
        {developmentPdfUnavailable ? (
          <Text style={styles.helperText}>Development PDF unavailable. Open Development history later to check for an authorised report.</Text>
        ) : null}
      </View>
    )
  }

  return (
    <View style={styles.screenStack}>
      <ScreenIntro copy={`Updates shared for ${link.playerName}.`} title="Club Announcements" />
      <ResourceError onRetry={onRetry} resource={resource} title="Club announcements unavailable" />
      {resource.loading && resource.items.length === 0 ? <LoadingPanel message="Loading Club announcements" /> : null}
      {!resource.loading && !resource.error && resource.items.length === 0 ? (
        <EmptyPanel message="Your club has not shared any announcements for this child yet." title="No announcements" />
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
          <Text style={styles.cardLink}>Read announcement</Text>
        </Pressable>
      ))}
    </View>
  )
}

function PollsScreen({ activeActionId, drafts, link, onDismiss, onDraftChange, onRetry, onSubmit, resource, targetPollId = '' }) {
  const { styles } = useParentTheme()
  const [viewMode, setViewMode] = useState('open')
  if (!link?.id) return <EmptyPanel message="No active child link is available for polls." title="Polls unavailable" />
  const targetPoll = targetPollId ? resource.items.find((poll) => poll.id === targetPollId) : null
  const isOpenPoll = (poll) => poll.status === 'open' && !poll.isExpired
  const openPolls = resource.items.filter(isOpenPoll)
  const resultPolls = resource.items.filter((poll) => !isOpenPoll(poll))
  const activeView = targetPoll && !isOpenPoll(targetPoll) ? 'results' : viewMode
  const visibleItems = targetPoll ? [targetPoll] : activeView === 'results' ? resultPolls : openPolls

  return (
    <View style={styles.screenStack}>
      <ScreenIntro copy={`Parent responses for ${link.playerName}.`} title="Polls" />
      <ResourceError onRetry={onRetry} resource={resource} title="Polls unavailable" />
      {!targetPoll ? <View accessibilityLabel="Poll view" style={styles.notificationChoices}>
        <PrimaryAction label={`Open (${openPolls.length})`} onPress={() => setViewMode('open')} secondary={activeView !== 'open'} />
        <PrimaryAction label={`Results (${resultPolls.length})`} onPress={() => setViewMode('results')} secondary={activeView !== 'results'} />
      </View> : null}
      {resource.loading && resource.items.length === 0 ? <LoadingPanel message="Loading polls" /> : null}
      {!resource.loading && !resource.error && visibleItems.length === 0 ? (
        <EmptyPanel message={activeView === 'results' ? 'No completed Poll results are available.' : 'There are no active Parent Polls right now.'} title={activeView === 'results' ? 'No Poll results' : 'No Polls to answer'} />
      ) : null}
      {visibleItems.map((poll) => {
        const draftOptionId = getPollDraftOption(poll, drafts)
        const currentOptionIds = Array.isArray(poll.currentOptionIds)
          ? poll.currentOptionIds.map(normalizeText).filter(Boolean)
          : normalizeText(poll.currentOptionId) ? [normalizeText(poll.currentOptionId)] : []
        const currentOptionId = currentOptionIds[0] || ''
        const busy = activeActionId === `poll:${poll.id}`
        const submitEnabled = canSubmitParentPoll(poll, draftOptionId)
        const rankedResults = rankParentPollResults(poll.options, poll.votes)

        return (
          <View key={poll.id} style={styles.card}>
            <View style={styles.cardTopRow}>
              <Badge label={poll.status === 'open' && !poll.isExpired ? 'Open' : 'Closed'} tone={poll.status === 'open' && !poll.isExpired ? 'accent' : 'neutral'} />
              {poll.closesAt ? <Text style={styles.cardDate}>Closes {formatDateTime(poll.closesAt)}</Text> : null}
            </View>
            <Text accessibilityRole="header" style={styles.cardTitle}>{poll.title}</Text>
            {poll.description ? <Text style={styles.bodyText}>{poll.description}</Text> : null}
            {!isOpenPoll(poll) ? <View style={styles.optionStack}>
              {rankedResults.map((option) => <View key={option.id} style={styles.optionButton}>
                <Badge label={`${option.rank}`} tone={option.rank === 1 && option.count > 0 ? 'accent' : 'neutral'} />
                <Text style={styles.optionLabel}>{option.label}</Text>
                <Text style={styles.cardMeta}>{option.count} vote{option.count === 1 ? '' : 's'}</Text>
              </View>)}
            </View> : null}
            {isOpenPoll(poll) && poll.allowMultiple ? (
              <Text style={styles.helperText}>
                {poll.maxChoices ? `Choose up to ${poll.maxChoices} answers. Each change is saved separately.` : 'Choose one or more answers. Each change is saved separately.'}
              </Text>
            ) : null}
            {isOpenPoll(poll) ? <View accessibilityLabel={`Response options for ${poll.title}`} style={styles.optionStack}>
              {poll.options.map((option) => {
                const selected = poll.allowMultiple ? currentOptionIds.includes(option.id) : draftOptionId === option.id
                const saved = currentOptionIds.includes(option.id)
                const ownChildOption = poll.allowOwnChildVotes === false
                  && normalizeText(link.playerId)
                  && normalizeText(option.playerId) === normalizeText(link.playerId)
                const atChoiceLimit = poll.allowMultiple
                  && Number(poll.maxChoices || 0) > 0
                  && currentOptionIds.length >= Number(poll.maxChoices)
                  && !selected
                const optionDisabled = !canSubmitParentPoll(poll, option.id) || busy || ownChildOption || atChoiceLimit
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
                    {selected ? <Badge label={saved ? 'Saved' : 'Selected'} tone="accent" /> : null}
                  </Pressable>
                )
              })}
            </View> : null}
            {isOpenPoll(poll) && currentOptionId ? (
              <Text style={styles.helperText}>
                {poll.allowMultiple
                  ? poll.allowVoteChanges
                    ? 'Your saved answers are selected. Tap one again to remove it.'
                    : 'Your saved answers cannot be removed. You can still add another answer within the choice limit.'
                  : poll.allowVoteChanges
                    ? 'Your current response is selected. Choose another option to change it.'
                    : 'Your response has been recorded and cannot be changed.'}
              </Text>
            ) : null}
            {isOpenPoll(poll) && (poll.allowMultiple ? (
              busy ? <LoadingLine label="Saving response" /> : null
            ) : (
              <PrimaryAction
                disabled={!submitEnabled}
                label={currentOptionId ? 'Save changed response' : 'Submit response'}
                loading={busy}
                onPress={() => onSubmit(poll)}
              />
            ))}
            <PrimaryAction label="Remove from this list" onPress={() => onDismiss(poll)} secondary />
          </View>
        )
      })}
    </View>
  )
}

function SyncStatus({ attentionIndex = 0, cacheState, isOffline, isSyncing, onNextAttention, onOpenAttention, summary }) {
  const { palette, styles } = useParentTheme()
  const confirmedOffline = useConfirmedConnectionIssue(isOffline)
  let message = ''
  let tone = 'neutral'
  if (confirmedOffline) {
    message = cacheState.source === 'cache'
      ? `Offline. Showing your last saved information.${cacheState.stale ? ' It may be out of date.' : ''}`
      : 'Offline. Connect to load information that has not been saved on this device.'
    tone = 'warning'
  } else if (isOffline || isSyncing) {
    message = 'Syncing your saved actions.'
  } else if (summary.needsAttention > 0) {
    message = `${summary.needsAttention} ${summary.needsAttention === 1 ? 'action needs' : 'actions need'} attention.`
    tone = 'warning'
  } else if (summary.waiting > 0) {
    message = `${summary.waiting} ${summary.waiting === 1 ? 'action is' : 'actions are'} waiting to sync.`
  } else if (cacheState.source === 'cache') {
    message = 'Showing saved information while the latest update is checked.'
  }

  const content = <>
      {isSyncing ? <ActivityIndicator color={palette.accent} size="small" /> : null}
      <Text style={styles.syncStatusText}>{message}</Text>
      {summary.needsAttention > 1 && onNextAttention ? <Pressable accessibilityLabel={`Show next action, ${attentionIndex + 1} of ${summary.needsAttention}`} accessibilityRole="button" onPress={(event) => { event.stopPropagation(); onNextAttention() }} style={styles.syncStatusAction}><Text style={styles.syncStatusActionText}>Next</Text></Pressable> : null}
    </>
  if (!message) return null
  return summary.needsAttention > 0 && onOpenAttention ? (
    <Pressable accessibilityHint="Opens the item that needs attention" accessibilityLiveRegion="polite" accessibilityRole="button" onPress={onOpenAttention} style={[styles.syncStatus, styles.syncStatusWarning]}>{content}</Pressable>
  ) : <View accessibilityLiveRegion="polite" style={[styles.syncStatus, tone === 'warning' && styles.syncStatusWarning]}>{content}</View>
}

function SettingsScreen({
  activeActionId,
  appBadgeEnabled,
  biometricAvailable,
  biometricEnabled,
  biometricStateStatus,
  cacheState,
  communicationPreference,
  displayTheme,
  hiddenItemCount,
  isOffline,
  isSyncing,
  lastUpdatedAt,
  links,
  notificationState,
  notificationStateStatus,
  notificationSettingsFocusRequest,
  onBiometricChange,
  onAppBadgeEnabledChange,
  onCommunicationChannelChange,
  onDisplayThemeChange,
  onDisplayNameChange,
  onNotificationModeChange,
  onNotificationSettingsFocus,
  onRetryBiometricState,
  onRetryNotificationState,
  onPasswordChange,
  onRestoreDismissedItems,
  onRetrySync,
  onSendTestNotification,
  onSignOut,
  syncSummary,
  user,
}) {
  const { palette, styles } = useParentTheme()
  const [currentPassword, setCurrentPassword] = useState('')
  const [displayName, setDisplayName] = useState(user.displayName || user.name || '')
  const [nextPassword, setNextPassword] = useState('')
  const appVersion = Application.nativeApplicationVersion || Constants.expoConfig?.version || '1.0.6'
  const buildNumber = Application.nativeBuildVersion || (Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber || '1'
    : Constants.expoConfig?.android?.versionCode || '1')
  const biometricStateReady = biometricStateStatus === MOBILE_SETTING_LOAD_STATES.READY
  const biometricStateLoading = biometricStateStatus === MOBILE_SETTING_LOAD_STATES.LOADING
  const notificationStateKnown = [MOBILE_SETTING_LOAD_STATES.READY, MOBILE_SETTING_LOAD_STATES.STALE].includes(notificationStateStatus)
  const notificationStateLoading = notificationStateStatus === MOBILE_SETTING_LOAD_STATES.LOADING
  const [notificationSectionY, setNotificationSectionY] = useState(null)
  const [settingsRootY, setSettingsRootY] = useState(null)

  useEffect(() => {
    if (!notificationSettingsFocusRequest || notificationSectionY === null || settingsRootY === null || !onNotificationSettingsFocus) return
    const frame = requestAnimationFrame(() => onNotificationSettingsFocus(settingsRootY + notificationSectionY))
    return () => cancelAnimationFrame(frame)
  }, [notificationSectionY, notificationSettingsFocusRequest, onNotificationSettingsFocus, settingsRootY])

  return (
    <View onLayout={(event) => setSettingsRootY(event.nativeEvent.layout.y)} style={styles.screenStack}>
      <ScreenIntro copy="Account, security and app information." title="Settings" />

      <InfoPanel title="Signed-in Parent">
        <TextInput
          accessibilityLabel="Display name"
          autoCapitalize="words"
          editable={activeActionId !== 'display-name'}
          onChangeText={setDisplayName}
          placeholder="Display name"
          placeholderTextColor={palette.textMuted}
          style={styles.settingsInput}
          value={displayName}
        />
        <PrimaryAction
          disabled={!displayName.trim() || displayName.trim() === (user.displayName || user.name || '').trim()}
          label="Update display name"
          loading={activeActionId === 'display-name'}
          onPress={() => { void onDisplayNameChange(displayName).catch(() => {}) }}
          secondary
        />
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

      <InfoPanel title="Display">
        <Text style={styles.bodyText}>Choose the app appearance on this device.</Text>
        <View style={styles.notificationChoices}>
          {['dark', 'light'].map((theme) => {
            const selected = displayTheme === theme
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={theme}
                onPress={() => onDisplayThemeChange(theme)}
                style={({ pressed }) => [styles.notificationChoice, selected && styles.notificationChoiceSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.notificationChoiceTitle, selected && styles.notificationChoiceTitleSelected]}>{labelize(theme)}</Text>
              </Pressable>
            )
          })}
        </View>
      </InfoPanel>

      <InfoPanel title="Password security">
        <Text style={styles.bodyText}>Confirm your current password before choosing a new one.</Text>
        <TextInput
          accessibilityLabel="Current password"
          autoCapitalize="none"
          autoComplete="current-password"
          editable={activeActionId !== 'password'}
          onChangeText={setCurrentPassword}
          placeholder="Current password"
          placeholderTextColor={palette.textMuted}
          secureTextEntry
          style={styles.settingsInput}
          value={currentPassword}
        />
        <TextInput
          accessibilityLabel="New password"
          autoCapitalize="none"
          autoComplete="new-password"
          editable={activeActionId !== 'password'}
          onChangeText={setNextPassword}
          placeholder="New password, at least 8 characters"
          placeholderTextColor={palette.textMuted}
          secureTextEntry
          style={styles.settingsInput}
          value={nextPassword}
        />
        <PrimaryAction
          disabled={!currentPassword || nextPassword.length < 8}
          label="Update password"
          loading={activeActionId === 'password'}
          onPress={() => {
            void onPasswordChange(currentPassword, nextPassword)
              .then(() => { setCurrentPassword(''); setNextPassword('') })
              .catch(() => {})
          }}
          secondary
        />
      </InfoPanel>

      <View style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={styles.cardTitle}>Biometric app lock</Text>
            <Text style={styles.bodyText}>
              Uses biometrics already enrolled on this device. It protects local app access and does not change your Football Player password.
            </Text>
            {biometricStateReady && !biometricAvailable ? <Text style={styles.helperText}>No enrolled biometric security is available on this device.</Text> : null}
            {biometricStateLoading ? <Text style={styles.helperText}>Checking this device...</Text> : null}
            {biometricStateStatus === MOBILE_SETTING_LOAD_STATES.ERROR ? <Text style={styles.helperText}>The saved biometric setting could not be read. It has not been changed.</Text> : null}
          </View>
          {activeActionId === 'biometrics' || biometricStateLoading ? <ActivityIndicator color={palette.accent} /> : biometricStateReady ? (
            <Switch
              accessibilityLabel="Biometric app lock"
              disabled={!biometricAvailable}
              onValueChange={onBiometricChange}
              trackColor={{ false: palette.borderStrong, true: palette.accentMuted }}
              thumbColor={biometricEnabled ? palette.accent : palette.textMuted}
              value={biometricEnabled}
            />
          ) : null}
        </View>
        {biometricStateStatus === MOBILE_SETTING_LOAD_STATES.ERROR ? <PrimaryAction label="Retry biometric check" onPress={onRetryBiometricState} secondary /> : null}
      </View>

      <InfoPanel title="Communication choice">
        <Text style={styles.bodyText}>Choose how Football Player sends club updates and requests. Email and app notifications are delivered independently.</Text>
        <View style={styles.notificationChoices}>
          {[
            { copy: 'Push alerts on this device.', key: 'app', label: 'App notifications' },
            { copy: 'Updates to your account email.', key: 'email', label: 'Email' },
            { copy: 'Send through both channels.', key: 'both', label: 'Both' },
          ].map((choice) => {
            const selected = communicationPreference.communicationChannel === choice.key
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                disabled={activeActionId === 'communication-channel'}
                key={choice.key}
                onPress={() => onCommunicationChannelChange(choice.key)}
                style={({ pressed }) => [styles.notificationChoice, selected && styles.notificationChoiceSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.notificationChoiceTitle, selected && styles.notificationChoiceTitleSelected]}>{choice.label}</Text>
                <Text style={styles.helperText}>{choice.copy}</Text>
              </Pressable>
            )
          })}
        </View>
      </InfoPanel>

      <InfoPanel onLayout={(event) => setNotificationSectionY(event.nativeEvent.layout.y)} title="Notifications">
        <InfoRow
          label="Status"
          value={notificationStateKnown
            ? getParentNotificationStatusLabel(notificationState)
            : notificationStateLoading ? 'Checking this device' : 'Unable to verify'}
        />
        {notificationStateStatus === MOBILE_SETTING_LOAD_STATES.STALE ? <Text style={styles.helperText}>The latest check failed. The last confirmed setting is shown and has not been changed.</Text> : null}
        {notificationStateStatus === MOBILE_SETTING_LOAD_STATES.ERROR ? <Text style={styles.helperText}>Notification status could not be read. No setting has been changed.</Text> : null}
        <Text style={styles.bodyText}>Choose Off, Minimal or Detailed. Selecting Minimal or Detailed turns Parent messages, polls and Matchday alerts on for this device.</Text>
        <Text style={styles.helperText}>Permission is requested when needed. Full Player names, message text, assessments and Coach notes are never included.</Text>
        {notificationStateKnown && !notificationState.permissionGranted && notificationState.permissionStatus === 'denied' ? (
          <Text style={styles.helperText}>Permission is blocked in device settings. The app remains fully usable.</Text>
        ) : null}
        {notificationStateKnown && notificationState.message ? <Text style={styles.helperText}>{notificationState.message}</Text> : null}
        {notificationStateStatus === MOBILE_SETTING_LOAD_STATES.ERROR ? <PrimaryAction label="Retry notification check" onPress={onRetryNotificationState} secondary /> : null}

        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={styles.cardTitle}>App icon badge</Text>
            <Text style={styles.bodyText}>Show the authoritative unread count on this device.</Text>
          </View>
          {activeActionId === 'app-icon-badge' ? <ActivityIndicator color={palette.accent} /> : (
            <Switch
              accessibilityLabel="App icon badge"
              onValueChange={onAppBadgeEnabledChange}
              trackColor={{ false: palette.borderStrong, true: palette.accentMuted }}
              thumbColor={appBadgeEnabled ? palette.accent : palette.textMuted}
              value={appBadgeEnabled}
            />
          )}
        </View>

        {notificationStateKnown && !notificationState.permissionGranted && (notificationState.permissionStatus === 'denied' || notificationState.canAskAgain === false) ? (
          <PrimaryAction label="Open device notification settings" onPress={() => Linking.openSettings()} secondary />
        ) : null}

        {activeActionId === 'notifications' || notificationStateLoading ? <ActivityIndicator color={palette.accent} /> : null}
        {notificationStateKnown ? <View style={styles.notificationChoices}>
          {[
            { copy: 'Do not send app notifications to this device.', key: 'off', label: 'Off' },
            { copy: 'General alerts with the least detail.', key: 'minimal', label: 'Minimal' },
            { copy: 'A little more context, without Player names.', key: 'detailed', label: 'Detailed' },
          ].map((choice) => {
            const selectedMode = notificationState.enabled ? notificationState.detailLevel : 'off'
            const selected = selectedMode === choice.key
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                disabled={activeActionId === 'notifications'}
                key={choice.key}
                onPress={() => onNotificationModeChange(choice.key)}
                style={({ pressed }) => [styles.notificationChoice, selected && styles.notificationChoiceSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.notificationChoiceTitle, selected && styles.notificationChoiceTitleSelected]}>{choice.label}</Text>
                <Text style={styles.helperText}>{choice.copy}</Text>
              </Pressable>
            )
          })}
        </View> : null}

        {notificationState.enabled && !config.isProduction ? (
          <View style={styles.notificationTestActions}>
            <Text style={styles.helperText}>Controlled tests send only to this authorised test installation.</Text>
            <PrimaryAction label="Try message alert" loading={activeActionId === 'notification-test'} onPress={() => onSendTestNotification('parent_message')} secondary />
            <PrimaryAction label="Try poll alert" loading={activeActionId === 'notification-test'} onPress={() => onSendTestNotification('parent_poll')} secondary />
            <PrimaryAction label="Try Matchday alert" loading={activeActionId === 'notification-test'} onPress={() => onSendTestNotification('matchday_update')} secondary />
          </View>
        ) : null}
      </InfoPanel>

      <InfoPanel title="App information">
        <InfoRow label="Build" value={getBuildClassification(config.buildProfile)} />
        <InfoRow label="Connection" value={config.isUsable ? config.isProduction ? 'Live service ready' : 'Test service ready' : 'Connection needs attention'} />
        <InfoRow label="Version" value={`${appVersion} (${buildNumber})`} />
        {lastUpdatedAt ? <InfoRow label="Last refreshed" value={formatDateTime(lastUpdatedAt)} /> : null}
        <Text style={styles.helperText}>
          {config.isProduction
            ? 'This production-backed candidate uses the live Football Player service.'
            : 'This test build cannot connect to the live Football Player service.'}
        </Text>
      </InfoPanel>

      <InfoPanel title="Hidden items">
        <InfoRow label="Removed from lists" value={String(hiddenItemCount || 0)} />
        <Text style={styles.helperText}>Removing an item hides it on this device. Club records and audit history are not deleted.</Text>
        <PrimaryAction disabled={!hiddenItemCount} label="Restore hidden items" onPress={onRestoreDismissedItems} secondary />
      </InfoPanel>

      <InfoPanel title="Offline and sync">
        <InfoRow label="Connection" value={isOffline ? 'Offline' : 'Online'} />
        <InfoRow label="Saved information" value={cacheState.source === 'cache' ? cacheState.stale ? 'Saved, may be out of date' : 'Saved on this device' : 'Up to date'} />
        <InfoRow label="Actions waiting" value={String(syncSummary.waiting)} />
        <InfoRow label="Needs attention" value={String(syncSummary.needsAttention)} />
        <Text style={styles.helperText}>Saved family information and waiting actions are encrypted on this device and removed when you sign out.</Text>
        {!isOffline && (syncSummary.waiting > 0 || syncSummary.needsAttention > 0) ? (
          <PrimaryAction label="Retry sync" loading={isSyncing} onPress={onRetrySync} secondary />
        ) : null}
      </InfoPanel>

      <PrimaryAction label="Sign out" onPress={onSignOut} secondary />
      <Text style={styles.legalText}>Football Player Parents. Private family access.</Text>
    </View>
  )
}

function ScreenIntro({ copy, title }) {
  const { styles } = useParentTheme()
  return (
    <View style={styles.screenIntro}>
      <Text accessibilityRole="header" style={styles.screenTitle}>{title}</Text>
      <Text style={styles.screenCopy}>{copy}</Text>
    </View>
  )
}

function SectionHeading({ copy, title }) {
  const { styles } = useParentTheme()
  return (
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {copy ? <Text style={styles.sectionCopy}>{copy}</Text> : null}
    </View>
  )
}

function SummaryButton({ count = null, disabled = false, iconKey, label, onPress }) {
  const { palette, styles } = useParentTheme()
  return (
    <Pressable
      accessibilityLabel={count === null ? label : `${count} ${label}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.summaryCard, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <View style={styles.summaryIconWrap}>
        <MaterialIcons color={palette.accent} name={getMobileIconName(iconKey)} size={28} />
        {count !== null ? <Text style={styles.summaryCount}>{count}</Text> : null}
      </View>
      <Text style={styles.summaryLabel}>{label}</Text>
    </Pressable>
  )
}

function InfoPanel({ children, onLayout, title }) {
  const { styles } = useParentTheme()
  return (
    <View onLayout={onLayout} style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>{title}</Text>
      <View style={styles.infoStack}>{children}</View>
    </View>
  )
}

function InfoRow({ label, value }) {
  const { styles } = useParentTheme()
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text selectable style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function Badge({ label, tone = 'neutral' }) {
  const { styles } = useParentTheme()
  return (
    <View style={[styles.badge, tone === 'accent' && styles.badgeAccent, tone === 'danger' && styles.badgeDanger]}>
      <Text style={[styles.badgeText, tone === 'accent' && styles.badgeTextAccent, tone === 'danger' && styles.badgeTextDanger]}>{label}</Text>
    </View>
  )
}

function Notice({ message, onDismiss, tone = 'success' }) {
  const { styles } = useParentTheme()
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
  const { styles } = useParentTheme()
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
  const { styles } = useParentTheme()
  return (
    <View style={styles.emptyPanel}>
      <Text accessibilityRole="header" style={styles.cardTitle}>{title}</Text>
      <Text style={styles.bodyText}>{message}</Text>
    </View>
  )
}

function LoadingPanel({ message }) {
  const { palette, styles } = useParentTheme()
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.loadingPanel}>
      <ActivityIndicator color={palette.accent} />
      <Text style={styles.bodyText}>{message}</Text>
    </View>
  )
}

function LoadingLine({ label }) {
  const { palette, styles } = useParentTheme()
  return (
    <View accessibilityLiveRegion="polite" style={styles.loadingLine}>
      <ActivityIndicator color={palette.accent} size="small" />
      <Text style={styles.helperText}>{label}</Text>
    </View>
  )
}

function PrimaryAction({ disabled = false, label, loading = false, onPress, secondary = false }) {
  const { palette, styles } = useParentTheme()
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
  const { styles } = useParentTheme()
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
      <Text style={styles.backButtonText}>{label}</Text>
    </Pressable>
  )
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

  if ([MOBILE_STARTUP_STATES.BOOTING, MOBILE_STARTUP_STATES.RESTORING_SESSION].includes(startupState)) {
    return <LoadingScreen message="Loading Football Player Parents..." />
  }
  if (startupState === MOBILE_STARTUP_STATES.RECOVERABLE_ERROR) {
    return (
      <StartupRecoveryScreen
        diagnosticCode={startupDiagnosticCode}
        message={authError}
        onReset={resetLocalAppData}
        onRetry={retryStartup}
      />
    )
  }
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

function StartupRecoveryScreen({ diagnosticCode, message, onReset, onRetry, showReset = true }) {
  const version = Constants.expoConfig?.version || Application.nativeApplicationVersion || 'unknown'
  const buildNumber = Application.nativeBuildVersion || 'unknown'
  return (
    <SafeAreaView style={styles.startupRecovery}>
      <View accessibilityLiveRegion="assertive" style={styles.startupRecoveryCard}>
        <Text style={styles.startupRecoveryKicker}>Football Player Parents</Text>
        <Text style={styles.startupRecoveryTitle}>Something went wrong</Text>
        <Text style={styles.bodyText}>{message || 'The app could not finish starting safely.'}</Text>
        <Text style={styles.startupDiagnostic}>Code {diagnosticCode || 'PARENT_STARTUP_FAILED'} | Version {version} ({buildNumber})</Text>
        <PrimaryAction label="Try again" onPress={onRetry} />
        {showReset ? <PrimaryAction label="Reset local app data" onPress={onReset} secondary /> : null}
        {showReset ? <Text style={styles.helperText}>This reset affects only saved information on this device. It does not change Football Player records.</Text> : null}
      </View>
    </SafeAreaView>
  )
}

class ParentRootErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error('Parent root render failed.', error?.name || 'unknown')
  }

  render() {
    if (this.state.hasError) {
      return (
        <StartupRecoveryScreen
          diagnosticCode="PARENT_ROOT_RENDER_FAILED"
          message="The app could not display its first screen safely."
          onReset={() => this.setState({ hasError: false })}
          onRetry={() => this.setState({ hasError: false })}
          showReset={false}
        />
      )
    }
    return this.props.children
  }
}

export default function App() {
  useMobileAutomaticUpdates()
  return (
    <SafeAreaProvider>
      <ParentRootErrorBoundary>
        <AuthProvider
          appRole="parent"
          offlineProfileStore={parentOfflineProfileStore}
          prepareStartup={prepareParentMobileStartup}
          preserveNativePushOnSignOut
        >
          <AppContent />
        </AuthProvider>
      </ParentRootErrorBoundary>
    </SafeAreaProvider>
  )
}

function createParentAppPalette(tokens) {
  return {
    accent: tokens.buttonPrimary,
    accentMuted: tokens.accentMuted,
    background: tokens.background,
    border: tokens.border,
    borderStrong: tokens.borderStrong,
    card: tokens.surface,
    cardRaised: tokens.surfaceRaised,
    danger: tokens.danger,
    dangerBackground: tokens.dangerSurface,
    ink: tokens.accentForeground,
    selectedSurface: tokens.selectedSurface,
    successBackground: tokens.successSurface,
    text: tokens.textPrimary,
    textMuted: tokens.textSecondary,
    warning: tokens.warning,
    warningBackground: tokens.warningSurface,
  }
}

function createParentAppStyles(tokens) {
  const palette = createParentAppPalette(tokens)
  return StyleSheet.create({
  backButton: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 48, paddingHorizontal: 4 },
  backButtonText: { color: palette.accent, fontSize: 15, fontWeight: '800' },
  badge: { alignSelf: 'flex-start', backgroundColor: palette.cardRaised, borderColor: palette.borderStrong, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
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
  homeCard: { borderRadius: 14, gap: 7, padding: 12 },
  homeCardTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  homeInlineAction: { alignItems: 'center', alignSelf: 'flex-start', borderColor: palette.borderStrong, borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  homeInlineActionText: { color: palette.text, fontSize: 12, fontWeight: '900' },
  notificationContent: { flex: 1, gap: 8 },
  notificationIcon: { alignItems: 'center', borderColor: palette.borderStrong, borderRadius: 24, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  notificationRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  childButton: { alignItems: 'center', backgroundColor: palette.card, borderColor: palette.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, justifyContent: 'space-between', marginTop: 8, minHeight: 58, paddingHorizontal: 12, paddingVertical: 8 },
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
  chatRouteContent: { flex: 1, gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  contentColumn: { alignSelf: 'center', maxWidth: 680, width: '100%' },
  detailScore: { color: palette.accent, fontSize: 40, fontWeight: '900', letterSpacing: -1 },
  detailTitle: { color: palette.text, fontSize: 28, fontWeight: '900', letterSpacing: -0.5, lineHeight: 34 },
  disabled: { opacity: 0.45 },
  emptyPanel: { backgroundColor: palette.card, borderColor: palette.border, borderRadius: 18, borderStyle: 'dashed', borderWidth: 1, gap: 8, padding: 20 },
  errorPanel: { backgroundColor: palette.dangerBackground, borderColor: palette.danger, borderRadius: 16, borderWidth: 1, gap: 6, padding: 14 },
  errorTitle: { color: palette.danger, fontSize: 15, fontWeight: '900' },
  eyebrow: { color: palette.accent, fontSize: 12, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  header: { backgroundColor: palette.background, borderBottomColor: palette.border, borderBottomWidth: 1, paddingBottom: 9, paddingHorizontal: 16, paddingTop: 8 },
  headerLight: { backgroundColor: palette.background, borderBottomColor: palette.border },
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
  notice: { backgroundColor: palette.successBackground, borderColor: palette.accentMuted, borderRadius: 16, borderWidth: 1, gap: 8, padding: 14 },
  noticeDismiss: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 40 },
  noticeDismissText: { color: palette.accent, fontSize: 13, fontWeight: '900' },
  noticeError: { backgroundColor: palette.dangerBackground, borderColor: palette.danger },
  noticeText: { color: palette.text, fontSize: 14, fontWeight: '800', lineHeight: 20 },
  noticeWarning: { backgroundColor: palette.warningBackground, borderColor: palette.warning },
  notificationChoice: { backgroundColor: palette.cardRaised, borderColor: palette.border, borderRadius: 14, borderWidth: 1, flex: 1, gap: 5, minHeight: 82, minWidth: 138, padding: 12 },
  notificationChoiceSelected: { backgroundColor: palette.selectedSurface, borderColor: palette.accent },
  notificationChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  notificationChoiceTitle: { color: palette.text, fontSize: 15, fontWeight: '900' },
  notificationChoiceTitleSelected: { color: palette.accent },
  notificationStatusButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  notificationTestActions: { gap: 9 },
  optionButton: { alignItems: 'center', backgroundColor: palette.cardRaised, borderColor: palette.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10 },
  optionButtonDisabled: { opacity: 0.55 },
  optionButtonSelected: { backgroundColor: palette.selectedSurface, borderColor: palette.accent },
  optionLabel: { color: palette.text, flex: 1, fontSize: 15, fontWeight: '800' },
  optionLabelSelected: { color: palette.accent },
  optionStack: { gap: 8 },
  pressed: { opacity: 0.78 },
  primaryAction: { alignItems: 'center', backgroundColor: palette.accent, borderColor: palette.accent, borderRadius: 14, borderWidth: 1, justifyContent: 'center', minHeight: 52, paddingHorizontal: 16, paddingVertical: 13 },
  primaryActionText: { color: palette.ink, fontSize: 15, fontWeight: '900' },
  radio: { borderColor: palette.borderStrong, borderRadius: 999, borderWidth: 2, height: 20, width: 20 },
  radioSelected: { backgroundColor: palette.accent, borderColor: palette.accent, borderWidth: 5 },
  safeArea: { backgroundColor: palette.background, flex: 1 },
  safeAreaLight: { backgroundColor: palette.background },
  score: { color: palette.accent, fontSize: 28, fontWeight: '900' },
  screenCopy: { color: palette.textMuted, fontSize: 15, lineHeight: 22 },
  screenIntro: { gap: 4 },
  screenStack: { gap: 14 },
  screenTitle: { color: palette.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  scrollContent: { paddingBottom: 24, paddingHorizontal: 16, paddingTop: 10 },
  secondaryAction: { backgroundColor: palette.card, borderColor: palette.borderStrong },
  secondaryActionText: { color: palette.text },
  sectionCopy: { color: palette.textMuted, fontSize: 13, lineHeight: 19 },
  sectionHeading: { gap: 2, marginTop: 4 },
  sectionStack: { gap: 10 },
  sectionTitle: { color: palette.text, fontSize: 21, fontWeight: '900' },
  startupDiagnostic: { color: palette.textMuted, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12 },
  startupRecovery: { alignItems: 'center', backgroundColor: palette.background, flex: 1, justifyContent: 'center', padding: 20 },
  startupRecoveryCard: { backgroundColor: palette.card, borderColor: palette.border, borderRadius: 20, borderWidth: 1, gap: 14, maxWidth: 520, padding: 22, width: '100%' },
  startupRecoveryKicker: { color: palette.accent, fontSize: 13, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  startupRecoveryTitle: { color: palette.text, fontSize: 28, fontWeight: '900' },
  settingCopy: { flex: 1, gap: 6 },
  settingRow: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  settingsInput: { backgroundColor: palette.background, borderColor: palette.borderStrong, borderRadius: 12, borderWidth: 1, color: palette.text, fontSize: 16, minHeight: 50, paddingHorizontal: 14, paddingVertical: 11 },
  summaryCard: { alignItems: 'center', flex: 1, gap: 4, justifyContent: 'center', minHeight: 76, minWidth: 58, paddingHorizontal: 2, paddingVertical: 7 },
  summaryCount: { backgroundColor: palette.card, borderColor: palette.accent, borderRadius: 999, borderWidth: 1, color: palette.accent, fontSize: 9, fontWeight: '900', minWidth: 17, overflow: 'hidden', paddingHorizontal: 4, paddingVertical: 1, position: 'absolute', right: -8, textAlign: 'center', top: -5 },
  summaryDetail: { color: palette.textMuted, fontSize: 12, lineHeight: 17 },
  summaryGrid: { borderBottomColor: palette.border, borderBottomWidth: 1, borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: 2, justifyContent: 'space-between', paddingVertical: 3 },
  summaryIconWrap: { position: 'relative' },
  summaryLabel: { color: palette.text, fontSize: 10, fontWeight: '900', textAlign: 'center' },
  syncStatus: { alignItems: 'center', backgroundColor: palette.card, borderColor: palette.borderStrong, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, marginBottom: 12, minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
  syncStatusAction: { alignItems: 'center', borderColor: palette.warning, borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 34, paddingHorizontal: 10 },
  syncStatusActionText: { color: palette.text, fontSize: 12, fontWeight: '900' },
  syncStatusText: { color: palette.text, flex: 1, fontSize: 13, fontWeight: '800', lineHeight: 18 },
  syncStatusWarning: { backgroundColor: palette.warningBackground, borderColor: palette.warning },
  tabBar: { backgroundColor: palette.card, borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: 4, paddingBottom: Platform.OS === 'ios' ? 4 : 8, paddingHorizontal: 8, paddingTop: 8 },
  tabBarLight: { backgroundColor: palette.card, borderTopColor: palette.border },
  tabButton: { alignItems: 'center', borderColor: 'transparent', borderRadius: 12, borderWidth: 1, flex: 1, gap: 3, justifyContent: 'center', minHeight: 52, paddingHorizontal: 4, paddingVertical: 7 },
  tabButtonActive: { backgroundColor: palette.selectedSurface, borderColor: palette.accentMuted },
  tabButtonActiveLight: { backgroundColor: palette.selectedSurface, borderColor: palette.accentMuted },
  tabCount: { backgroundColor: palette.accent, borderRadius: 999, color: palette.ink, fontSize: 10, fontWeight: '900', minWidth: 19, overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 2, textAlign: 'center' },
  tabCountActive: { backgroundColor: palette.text },
  tabLabel: { color: palette.textMuted, fontSize: 11, fontWeight: '800' },
  tabLabelActive: { color: palette.accent },
  surfaceLight: { backgroundColor: palette.card, borderColor: palette.border },
  textLight: { color: palette.text },
  textMutedLight: { color: palette.textMuted },
  unreadCard: { borderColor: palette.accentMuted },
  })
}

const styles = createParentAppStyles(DEFAULT_PARENT_MOBILE_THEME.tokens)
