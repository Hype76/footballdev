import 'react-native-url-polyfill/auto'
import NetInfo from '@react-native-community/netinfo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
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
  TextInput,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { AuthProvider, useMobileAuth } from '../mobile-core/src/auth'
import { getBiometricAvailability, getBiometricEnabled, setBiometricEnabled } from '../mobile-core/src/biometrics'
import { getMobileRuntimeConfig } from '../mobile-core/src/config'
import { getParentCalendarEvents, getParentMessages, getParentPolls } from '../mobile-core/src/data'
import { getParentPortalLinks, getSelectedParentLink, withSelectedParentLink } from '../mobile-core/src/parentLinks'
import {
  getParentNotificationStatusLabel,
  resolveParentNotificationOpen,
} from '../mobile-core/src/parentNotificationsCore'
import { AccessScreen, LoadingScreen, LockedScreen, MobileLoginScreen } from '../mobile-core/src/ui'
import {
  canSubmitParentPoll,
  getBuildClassification,
  getParentFriendlyError,
  getParentHomeModel,
  getPollDraftOption,
} from './src/parentExperience'
import {
  addParentScorerGoal,
  correctParentScorerGoal,
  deleteParentChatMessage,
  expressParentScorerInterest,
  getParentChatMessages,
  getParentChatHistory,
  getParentChatRooms,
  getParentDevelopmentHistory,
  getParentInvitations,
  getParentPortalMatchDays,
  getParentResources,
  markParentChatRoomRead,
  openParentDevelopmentReport,
  openParentResource,
  recordParentScorerShootoutKick,
  respondToParentInvitation,
  sendParentChatMessage,
  setParentScorerExtendedState,
  setParentScorerTimer,
  startParentScorerMatch,
  updateParentPassword,
  updateParentScorerScore,
  voidParentScorerGoal,
  voidParentScorerShootoutKick,
} from './src/parentPortalData'
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
  queueParentMessageRead,
  queueParentPollVote,
  readParentOfflineView,
  saveParentOfflineResources,
  saveParentOfflineSelection,
  syncParentOfflineCommands,
} from './src/offline'
import {
  addParentPushTokenListener,
  enableParentNotifications,
  initializeParentNotifications,
  loadParentNotificationState,
  sendParentTestNotification,
  unbindParentNotifications,
  updateParentNotificationPreference,
} from './src/notifications'

const config = getMobileRuntimeConfig('parent')
const resourceNames = ['calendar', 'chatHistory', 'chatRooms', 'development', 'invitations', 'matches', 'messages', 'polls', 'resources']
const resourceFallbacks = {
  calendar: 'Calendar information could not be loaded.',
  chatHistory: 'Saved Parent Chat history could not be loaded.',
  chatRooms: 'Parent Chat could not be loaded.',
  development: 'Development history could not be loaded.',
  invitations: 'Invitations could not be loaded.',
  matches: 'Matchday information could not be loaded.',
  messages: 'Messages could not be loaded.',
  polls: 'Polls could not be loaded.',
  resources: 'Resources could not be loaded.',
}

const PARENT_THEME_STORAGE_KEY = 'fp.parent.display-theme.v1'

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
  const lastNotificationResponse = Notifications.useLastNotificationResponse()
  const [activeTab, setActiveTab] = useState('home')
  const [activeActionId, setActiveActionId] = useState('')
  const [biometricAvailable, setBiometricAvailableState] = useState(false)
  const [biometricEnabled, setBiometricEnabledState] = useState(false)
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
  const [chatMessages, setChatMessages] = useState({ error: '', items: [], loading: false })
  const [displayTheme, setDisplayTheme] = useState('dark')
  const [moreSection, setMoreSection] = useState('')
  const [pollDrafts, setPollDrafts] = useState({})
  const [resources, setResources] = useState(createResourceState)
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [selectedMessageId, setSelectedMessageId] = useState('')
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [syncSummary, setSyncSummary] = useState({ needsAttention: 0, state: 'synced', waiting: 0 })
  const requestIdRef = useRef(0)
  const notificationResponseIdRef = useRef('')
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
  const selectedRoom = resources.chatRooms.items.find((room) => room.id === selectedRoomId) || null

  const loadParentData = useCallback(async ({ reset = false } = {}) => {
    const requestId = ++requestIdRef.current

    if (!selectedMobileUser?.id || !selectedLink?.id) {
      setResources(Object.fromEntries(resourceNames.map((name) => [name, {
        error: '',
        items: [],
        loading: false,
      }])))
      setLastUpdatedAt('')
      setOfflineCacheState({ source: '', stale: false })
      return { failed: 0 }
    }

    let cachedView = null
    try {
      cachedView = await readParentOfflineView(selectedMobileUser.id, selectedLink.id)
    } catch (error) {
      console.warn(error)
    }
    if (requestId !== requestIdRef.current) return { failed: 0, stale: true }

    if (cachedView?.cache) {
      setResources(Object.fromEntries(resourceNames.map((name) => [name, {
        error: '',
        items: cachedView.cache.resources[name],
        loading: !isOffline,
      }])))
      setLastUpdatedAt(cachedView.cache.retrievedAt)
      setOfflineCacheState({ source: 'cache', stale: cachedView.cache.stale })
    } else {
      setResources((current) => Object.fromEntries(resourceNames.map((name) => [name, {
        error: isOffline ? 'No saved information is available for this section yet.' : '',
        items: reset ? [] : current[name].items,
        loading: !isOffline,
      }])))
      setOfflineCacheState({ source: '', stale: false })
    }

    if (cachedView?.sync) setSyncSummary(cachedView.sync)
    if (isOffline) return { cached: Boolean(cachedView?.cache), failed: cachedView?.cache ? 0 : resourceNames.length }

    const loaders = {
      calendar: () => getParentCalendarEvents(selectedMobileUser),
      chatHistory: () => getParentChatHistory(selectedMobileUser),
      chatRooms: () => getParentChatRooms(selectedMobileUser),
      development: () => getParentDevelopmentHistory(selectedMobileUser),
      invitations: () => getParentInvitations(selectedMobileUser),
      matches: () => getParentPortalMatchDays(selectedMobileUser),
      messages: () => getParentMessages(selectedMobileUser),
      polls: () => getParentPolls(selectedMobileUser),
      resources: () => getParentResources(selectedMobileUser),
    }
    const results = await Promise.allSettled(resourceNames.map((name) => loaders[name]()))

    if (requestId !== requestIdRef.current) return { failed: 0, stale: true }

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

    if (failed < resourceNames.length) {
      setLastUpdatedAt(new Date().toISOString())
      setOfflineCacheState({ source: failed === 0 ? 'online' : cachedView?.cache ? 'cache' : 'online', stale: false })
    }
    if (failed === 0) {
      try {
        await saveParentOfflineResources(selectedMobileUser, selectedLink.id, Object.fromEntries(
          resourceNames.map((name, index) => [name, results[index].value]),
        ))
      } catch (error) {
        console.warn(error)
      }
    }
    return { failed }
  }, [isOffline, selectedLink?.id, selectedMobileUser])

  const runParentSync = useCallback(async ({ explicitRetry = false } = {}) => {
    if (isOffline || !selectedMobileUser?.id) return null
    setIsSyncing(true)
    try {
      const result = await syncParentOfflineCommands(selectedMobileUser, { explicitRetry })
      setSyncSummary({
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

  useEffect(() => {
    const nextSelectedLinkId = selectedLink?.id || ''
    if (selectedLinkId !== nextSelectedLinkId) {
      setSelectedLinkId(nextSelectedLinkId)
    }
  }, [selectedLink?.id, selectedLinkId])

  useEffect(() => {
    const subscription = NetInfo.addEventListener((state) => {
      const offline = state.isConnected === false || state.isInternetReachable === false
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
    setSelectedMessageId('')
    setSelectedRoomId('')
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
    void Promise.all([
      getBiometricAvailability(),
      getBiometricEnabled(),
      initializeParentNotifications(),
    ])
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
    if (!selectedMobileUser?.id) return undefined

    let mounted = true
    void loadParentNotificationState({ apiBaseUrl: config.apiBaseUrl })
      .then((notificationsState) => {
        if (mounted) setNotificationState(notificationsState)
      })
      .catch(() => {})

    return () => {
      mounted = false
    }
  }, [selectedMobileUser?.id])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && selectedLink?.id) {
        void runParentSync().then(() => loadParentData())
        void loadParentNotificationState({ apiBaseUrl: config.apiBaseUrl })
          .then(setNotificationState)
          .catch(() => {})
      }
    })
    return () => subscription.remove()
  }, [loadParentData, runParentSync, selectedLink?.id])

  useEffect(() => {
    if (!notificationState.enabled || !selectedLink?.id) return undefined
    const subscription = addParentPushTokenListener(() => {
      void enableParentNotifications({
        apiBaseUrl: config.apiBaseUrl,
        easProjectId: config.easProjectId,
        parentLinkId: selectedLink.id,
      }).then(setNotificationState).catch(() => {})
    })
    return () => subscription.remove()
  }, [notificationState.enabled, selectedLink?.id])

  useEffect(() => {
    const request = lastNotificationResponse?.notification?.request
    const responseId = normalizeText(request?.identifier)
    if (!responseId || notificationResponseIdRef.current === responseId) return
    notificationResponseIdRef.current = responseId

    const destination = resolveParentNotificationOpen(request.content?.data, {
      calendar: resources.calendar.items.map((item) => item.id),
      chat: resources.chatRooms.items.map((item) => item.id),
      development: resources.development.items.map((item) => item.id),
      invites: resources.invitations.items.map((item) => item.invitationId),
      matchday: resources.matches.items.map((item) => item.id),
      messages: resources.messages.items.map((item) => item.id),
      polls: resources.polls.items.map((item) => item.id),
      resources: resources.resources.items.map((item) => item.id),
      results: resources.matches.items.filter((item) => item.status === 'full_time').map((item) => item.id),
    })
    if (!destination) return

    void loadParentData().then(() => {
      const nestedSection = ['development', 'invites', 'messages', 'polls', 'resources', 'results', 'settings'].includes(destination.tab)
        ? destination.tab
        : ''
      setSelectedMatchId(destination.tab === 'matchday' ? destination.targetId : '')
      setSelectedMessageId(destination.tab === 'messages' ? destination.targetId : '')
      setSelectedRoomId(destination.tab === 'chat' ? destination.targetId : '')
      setMoreSection(nestedSection)
      setActiveTab(nestedSection ? 'more' : destination.tab)
    })
  }, [lastNotificationResponse, loadParentData, resources])

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
        : { message: 'You are up to date.', tone: 'success' })
    } finally {
      setIsRefreshing(false)
    }
  }

  function handleTabChange(tab) {
    setSelectedMatchId('')
    setSelectedMessageId('')
    setSelectedRoomId('')
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
          items: current.polls.items.map((item) => item.id === poll.id
            ? {
                ...item,
                currentOptionId: item.allowMultiple ? item.currentOptionId : optionId,
                currentOptionIds: item.allowMultiple
                  ? [...new Set([...(item.currentOptionIds || []), optionId])]
                  : [optionId],
              }
            : item),
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

  async function handleOpenParentItem(type, item) {
    if (isOffline || activeActionId) return
    setActiveActionId(`${type}:${item.id}`)
    setNotice(null)
    try {
      const result = type === 'development'
        ? await openParentDevelopmentReport(selectedMobileUser, item.id)
        : await openParentResource(selectedMobileUser, item.id)
      if (result.externalUrl) await openExternalParentUrl(result.externalUrl)
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, `This ${type === 'development' ? 'Development report' : 'resource'} could not be opened.`), tone: 'warning' })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleOpenChatRoom(room) {
    setSelectedRoomId(room.id)
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

  async function reloadSelectedChatRoom() {
    if (!selectedRoomId) return
    const items = await getParentChatMessages(selectedMobileUser, selectedRoomId)
    setChatMessages({ error: '', items, loading: false })
  }

  async function handleSendChatMessage(body) {
    if (isOffline || activeActionId || !selectedRoomId) return
    setActiveActionId('chat-send')
    setNotice(null)
    try {
      await sendParentChatMessage(selectedMobileUser, selectedRoomId, body)
      await reloadSelectedChatRoom()
      setNotice({ message: 'Your Chat message has been sent.', tone: 'success' })
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
      setNotice({ message: 'The Chat message has been deleted.', tone: 'success' })
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
      setNotice({ message: 'Your scorer interest has been registered with staff.', tone: 'success' })
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'Scorer interest could not be registered.'), tone: 'error' })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleScorerAction(match, action, value) {
    if (isOffline || activeActionId || !match.isScorer) return
    setActiveActionId(`scorer:${match.id}:${action}`)
    setNotice(null)
    try {
      if (action === 'start') await startParentScorerMatch(match.id)
      if (action === 'timer') await setParentScorerTimer(match.id, value)
      if (action === 'extended') await setParentScorerExtendedState(match.id, value)
      if (action === 'score') await updateParentScorerScore(selectedMobileUser, match.id, value.homeScore, value.awayScore)
      if (action === 'goal') await addParentScorerGoal(selectedMobileUser, match.id, value)
      if (action === 'correct-goal') await correctParentScorerGoal(selectedMobileUser, match, value.event, value.goal, value.reason)
      if (action === 'void-goal') await voidParentScorerGoal(selectedMobileUser, match.id, value.eventId, value.reason)
      if (action === 'shootout') await recordParentScorerShootoutKick(match.id, value)
      if (action === 'void-shootout') await voidParentScorerShootoutKick(match.id, value.kickId, value.reason)
      await loadParentData()
      setNotice({ message: 'Game Day has been updated.', tone: 'success' })
    } catch (error) {
      setNotice({ message: getParentFriendlyError(error, 'This Game Day change could not be saved.'), tone: 'error' })
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

  async function handleNotificationEnabledChange(enabled) {
    if (activeActionId || !selectedLink?.id) return
    setActiveActionId('notifications')
    setNotice(null)
    try {
      const nextState = enabled
        ? await enableParentNotifications({
            apiBaseUrl: config.apiBaseUrl,
            easProjectId: config.easProjectId,
            parentLinkId: selectedLink.id,
          })
        : await updateParentNotificationPreference({
            apiBaseUrl: config.apiBaseUrl,
            detailLevel: notificationState.detailLevel,
            enabled: false,
          })
      setNotificationState(nextState)
      setNotice({
        message: nextState.enabled
          ? `Notifications are on with ${nextState.detailLevel === 'detailed' ? 'Detailed' : 'Minimal'} content.`
          : nextState.message || 'Notifications are off. The rest of the app is unchanged.',
        tone: nextState.enabled ? 'success' : 'warning',
      })
    } catch (error) {
      console.warn('Parent notification setup failed.', normalizeText(error?.code) || 'unknown')
      setNotice({
        message: getParentFriendlyError(error, 'Notification settings could not be changed.'),
        tone: 'warning',
      })
    } finally {
      setActiveActionId('')
    }
  }

  async function handleNotificationDetailChange(detailLevel) {
    if (activeActionId || detailLevel === notificationState.detailLevel) return
    setActiveActionId('notifications')
    setNotice(null)
    try {
      const nextState = await updateParentNotificationPreference({
        apiBaseUrl: config.apiBaseUrl,
        detailLevel,
        enabled: notificationState.enabled,
      })
      setNotificationState(nextState)
      setNotice({
        message: `${detailLevel === 'detailed' ? 'Detailed' : 'Minimal'} notification content selected. Full Player names are never included.`,
        tone: 'success',
      })
    } catch (error) {
      setNotice({
        message: getParentFriendlyError(error, 'Notification detail could not be changed.'),
        tone: 'warning',
      })
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
  const unansweredInvites = resources.invitations.items.filter((invitation) => invitation.canRespond && ['awaiting_response', 'no_response'].includes(invitation.responseState)).length
  const unreadChat = resources.chatRooms.items.reduce((total, room) => total + Number(room.unreadCount || 0), 0)
  const tabs = [
    { key: 'home', label: 'Home' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'matchday', label: 'Matchday' },
    { count: unreadChat, key: 'chat', label: 'Chat' },
    { count: homeModel.unreadMessages + homeModel.unansweredPolls + unansweredInvites, key: 'more', label: 'More' },
  ]

  return (
    <SafeAreaView style={[styles.safeArea, displayTheme === 'light' && styles.safeAreaLight]}>
      <StatusBar style={displayTheme === 'light' ? 'dark' : 'light'} />
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
          theme={displayTheme}
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
            <SyncStatus
              cacheState={offlineCacheState}
              isOffline={isOffline}
              isSyncing={isSyncing}
              summary={syncSummary}
            />
            {notice ? <Notice message={notice.message} onDismiss={() => setNotice(null)} tone={notice.tone} /> : null}

            {activeTab === 'home' ? (
              <HomeScreen
                calendar={resources.calendar}
                homeModel={homeModel}
                link={selectedLink}
                matches={resources.matches}
                messages={resources.messages}
                onOpenMatch={(match) => setSelectedMatchId(match.id)}
                onOpenMessages={() => { setMoreSection('messages'); setActiveTab('more') }}
                onOpenPolls={() => { setMoreSection('polls'); setActiveTab('more') }}
                onRetry={handleRefresh}
                selectedMatch={selectedMatch}
              />
            ) : null}
            {activeTab === 'calendar' ? <CalendarScreen link={selectedLink} resource={resources.calendar} theme={displayTheme} /> : null}
            {activeTab === 'matchday' ? (
              <MatchdayScreen
                activeActionId={activeActionId}
                isOffline={isOffline}
                link={selectedLink}
                onBack={() => setSelectedMatchId('')}
                onOpen={(match) => setSelectedMatchId(match.id)}
                onScorerAction={handleScorerAction}
                onVolunteer={handleScorerInterest}
                resource={resources.matches}
                selectedMatch={selectedMatch}
                theme={displayTheme}
              />
            ) : null}
            {activeTab === 'chat' ? (
              <ChatScreen
                activeActionId={activeActionId}
                isOffline={isOffline}
                link={selectedLink}
                messages={chatMessages}
                onBack={() => setSelectedRoomId('')}
                onDelete={handleDeleteChatMessage}
                onOpenRoom={handleOpenChatRoom}
                onSend={handleSendChatMessage}
                rooms={resources.chatRooms}
                selectedRoom={selectedRoom}
                theme={displayTheme}
              />
            ) : null}
            {activeTab === 'more' && !moreSection ? (
              <MoreScreen
                onOpen={setMoreSection}
                theme={displayTheme}
                unansweredInvites={unansweredInvites}
                unansweredPolls={homeModel.unansweredPolls}
                unreadMessages={homeModel.unreadMessages}
              />
            ) : null}
            {activeTab === 'more' && moreSection ? <BackButton label="Back to More" onPress={() => { setMoreSection(''); setSelectedMessageId('') }} /> : null}
            {activeTab === 'more' && moreSection === 'invites' ? (
              <InvitationsScreen activeActionId={activeActionId} isOffline={isOffline} link={selectedLink} onRespond={handleInvitationResponse} resource={resources.invitations} theme={displayTheme} />
            ) : null}
            {activeTab === 'more' && moreSection === 'results' ? <ResultsScreen link={selectedLink} resource={resources.matches} theme={displayTheme} /> : null}
            {activeTab === 'more' && moreSection === 'development' ? <DevelopmentScreen isOffline={isOffline} onOpen={(report) => handleOpenParentItem('development', report)} resource={resources.development} theme={displayTheme} /> : null}
            {activeTab === 'more' && moreSection === 'resources' ? <ResourcesScreen isOffline={isOffline} onOpen={(item) => handleOpenParentItem('resource', item)} resource={resources.resources} theme={displayTheme} /> : null}
            {activeTab === 'more' && moreSection === 'messages' ? (
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
            {activeTab === 'more' && moreSection === 'polls' ? (
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
            {activeTab === 'more' && moreSection === 'settings' ? (
              <SettingsScreen
                activeActionId={activeActionId}
                biometricAvailable={biometricAvailable}
                biometricEnabled={biometricEnabled}
                cacheState={offlineCacheState}
                isOffline={isOffline}
                isSyncing={isSyncing}
                lastUpdatedAt={lastUpdatedAt}
                links={parentLinks}
                onBiometricChange={handleBiometricChange}
                displayTheme={displayTheme}
                notificationState={notificationState}
                onNotificationDetailChange={handleNotificationDetailChange}
                onNotificationEnabledChange={handleNotificationEnabledChange}
                onDisplayThemeChange={handleDisplayThemeChange}
                onPasswordChange={handlePasswordChange}
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
                user={user}
              />
            ) : null}
          </View>
        </ScrollView>

        <BottomTabs activeTab={activeTab} onChange={handleTabChange} tabs={tabs} theme={displayTheme} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function AppHeader({ childCount, childSwitcherOpen, links, onChildChange, onToggleChildSwitcher, selectedLink, theme }) {
  const isLight = theme === 'light'
  return (
    <View style={[styles.header, isLight && styles.headerLight]}>
      <View style={styles.brandRow}>
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel="Football Player Parents"
          source={require('./assets/football-player-logo.png')}
          style={styles.headerLogo}
        />
        <View style={styles.brandCopy}>
          <Text style={[styles.brandName, isLight && styles.textLight]}>Football Player Parents</Text>
          <Text numberOfLines={1} style={[styles.brandMeta, isLight && styles.textMutedLight]}>
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
            style={({ pressed }) => [styles.childButton, isLight && styles.surfaceLight, pressed && styles.pressed]}
          >
            <View style={styles.childButtonCopy}>
              <Text style={[styles.childButtonEyebrow, isLight && styles.textMutedLight]}>Active child</Text>
              <Text numberOfLines={1} style={[styles.childButtonName, isLight && styles.textLight]}>{selectedLink?.playerName || 'Choose a child'}</Text>
              <Text numberOfLines={1} style={[styles.childButtonTeam, isLight && styles.textMutedLight]}>{selectedLink?.teamName || 'No Team assigned'}</Text>
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

function BottomTabs({ activeTab, onChange, tabs, theme }) {
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
            <Text style={[styles.tabLabel, isLight && styles.textMutedLight, active && styles.tabLabelActive]}>{tab.label}</Text>
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

function SyncStatus({ cacheState, isOffline, isSyncing, summary }) {
  let message = ''
  let tone = 'neutral'
  if (isOffline) {
    message = cacheState.source === 'cache'
      ? `Offline. Showing your last saved information.${cacheState.stale ? ' It may be out of date.' : ''}`
      : 'Offline. Connect to load information that has not been saved on this device.'
    tone = 'warning'
  } else if (isSyncing) {
    message = 'Syncing your saved actions.'
  } else if (summary.needsAttention > 0) {
    message = `${summary.needsAttention} ${summary.needsAttention === 1 ? 'action needs' : 'actions need'} attention.`
    tone = 'warning'
  } else if (summary.waiting > 0) {
    message = `${summary.waiting} ${summary.waiting === 1 ? 'action is' : 'actions are'} waiting to sync.`
  } else if (cacheState.source === 'cache') {
    message = 'Showing saved information while the latest update is checked.'
  }

  return message ? (
    <View accessibilityLiveRegion="polite" style={[styles.syncStatus, tone === 'warning' && styles.syncStatusWarning]}>
      {isSyncing ? <ActivityIndicator color={palette.accent} size="small" /> : null}
      <Text style={styles.syncStatusText}>{message}</Text>
    </View>
  ) : null
}

function SettingsScreen({
  activeActionId,
  biometricAvailable,
  biometricEnabled,
  cacheState,
  displayTheme,
  isOffline,
  isSyncing,
  lastUpdatedAt,
  links,
  notificationState,
  onBiometricChange,
  onDisplayThemeChange,
  onNotificationDetailChange,
  onNotificationEnabledChange,
  onPasswordChange,
  onRetrySync,
  onSendTestNotification,
  onSignOut,
  syncSummary,
  user,
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const appVersion = Application.nativeApplicationVersion || Constants.expoConfig?.version || '1.0.1'
  const buildNumber = Application.nativeBuildVersion || (Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber || '1'
    : Constants.expoConfig?.android?.versionCode || '1')

  return (
    <View style={styles.screenStack}>
      <ScreenIntro copy="Account, security and app information." title="Settings" />

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

      <InfoPanel title="Notifications">
        <InfoRow label="Status" value={getParentNotificationStatusLabel(notificationState)} />
        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={styles.cardTitle}>Parent updates</Text>
            <Text style={styles.bodyText}>Receive Parent messages, polls and Matchday updates. You can turn this off at any time.</Text>
            <Text style={styles.helperText}>Permission is requested only when you turn notifications on. Full Player names, message text, assessments and staff notes are never included.</Text>
            {!notificationState.permissionGranted && notificationState.permissionStatus === 'denied' ? (
              <Text style={styles.helperText}>Permission is blocked in device settings. The app remains fully usable.</Text>
            ) : null}
          </View>
          {activeActionId === 'notifications' ? <ActivityIndicator color={palette.accent} /> : (
            <Switch
              accessibilityLabel="Parent notifications"
              onValueChange={onNotificationEnabledChange}
              trackColor={{ false: palette.borderStrong, true: palette.accentMuted }}
              thumbColor={notificationState.enabled ? palette.accent : palette.textMuted}
              value={notificationState.enabled}
            />
          )}
        </View>

        <View style={styles.notificationChoices}>
          {[
            { copy: 'General alerts with the least detail.', key: 'minimal', label: 'Minimal' },
            { copy: 'A little more context, without Player names.', key: 'detailed', label: 'Detailed' },
          ].map((choice) => {
            const selected = notificationState.detailLevel === choice.key
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                disabled={activeActionId === 'notifications'}
                key={choice.key}
                onPress={() => onNotificationDetailChange(choice.key)}
                style={({ pressed }) => [styles.notificationChoice, selected && styles.notificationChoiceSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.notificationChoiceTitle, selected && styles.notificationChoiceTitleSelected]}>{choice.label}</Text>
                <Text style={styles.helperText}>{choice.copy}</Text>
              </Pressable>
            )
          })}
        </View>

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
      <AuthProvider
        appRole="parent"
        offlineProfileStore={parentOfflineProfileStore}
        onBeforeSignOut={unbindParentNotifications}
      >
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
  headerLight: { backgroundColor: '#ffffff', borderBottomColor: '#cad8d4' },
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
  notificationChoice: { backgroundColor: palette.cardRaised, borderColor: palette.border, borderRadius: 14, borderWidth: 1, flex: 1, gap: 5, minHeight: 82, padding: 12 },
  notificationChoiceSelected: { backgroundColor: '#26360c', borderColor: palette.accent },
  notificationChoices: { flexDirection: 'row', gap: 10 },
  notificationChoiceTitle: { color: palette.text, fontSize: 15, fontWeight: '900' },
  notificationChoiceTitleSelected: { color: palette.accent },
  notificationTestActions: { gap: 9 },
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
  safeAreaLight: { backgroundColor: '#f3f7f6' },
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
  settingsInput: { backgroundColor: palette.background, borderColor: palette.borderStrong, borderRadius: 12, borderWidth: 1, color: palette.text, fontSize: 16, minHeight: 50, paddingHorizontal: 14, paddingVertical: 11 },
  summaryCard: { backgroundColor: palette.card, borderColor: palette.border, borderRadius: 18, borderWidth: 1, flex: 1, gap: 4, minHeight: 132, minWidth: 145, padding: 16 },
  summaryCount: { color: palette.accent, fontSize: 32, fontWeight: '900' },
  summaryDetail: { color: palette.textMuted, fontSize: 12, lineHeight: 17 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryLabel: { color: palette.text, fontSize: 14, fontWeight: '900' },
  syncStatus: { alignItems: 'center', backgroundColor: palette.card, borderColor: palette.borderStrong, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, marginBottom: 12, minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
  syncStatusText: { color: palette.text, flex: 1, fontSize: 13, fontWeight: '800', lineHeight: 18 },
  syncStatusWarning: { backgroundColor: palette.warningBackground, borderColor: palette.warning },
  tabBar: { backgroundColor: '#071009', borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: 4, paddingBottom: Platform.OS === 'ios' ? 4 : 8, paddingHorizontal: 8, paddingTop: 8 },
  tabBarLight: { backgroundColor: '#ffffff', borderTopColor: '#cad8d4' },
  tabButton: { alignItems: 'center', borderColor: 'transparent', borderRadius: 12, borderWidth: 1, flex: 1, gap: 3, justifyContent: 'center', minHeight: 52, paddingHorizontal: 4, paddingVertical: 7 },
  tabButtonActive: { backgroundColor: '#1a2b0c', borderColor: palette.accentMuted },
  tabButtonActiveLight: { backgroundColor: '#e9f3c9', borderColor: '#718c16' },
  tabCount: { backgroundColor: palette.accent, borderRadius: 999, color: palette.ink, fontSize: 10, fontWeight: '900', minWidth: 19, overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 2, textAlign: 'center' },
  tabCountActive: { backgroundColor: palette.text },
  tabLabel: { color: palette.textMuted, fontSize: 11, fontWeight: '800' },
  tabLabelActive: { color: palette.accent },
  surfaceLight: { backgroundColor: '#ffffff', borderColor: '#cad8d4' },
  textLight: { color: '#13231f' },
  textMutedLight: { color: '#536461' },
  unreadCard: { borderColor: palette.accentMuted },
})
