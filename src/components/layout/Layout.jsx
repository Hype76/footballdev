import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useMatches } from 'react-router-dom'
import { canCreateEvaluation, canManagePolls, isClubAdmin, isParentPortalUser, isSuperAdmin, useAuth } from '../../lib/auth.js'
import {
  assignPlayerStaffNote,
  createAuditLog,
  createPlayerStaffNote,
  getPlayers,
} from '../../lib/supabase.js'
import { getRecorderOptions } from '../../lib/session-page-utils.js'
import {
  THEME_ACCENT_STORAGE_KEY,
  THEME_BUTTON_STYLE_STORAGE_KEY,
  THEME_CHANGED_EVENT,
  THEME_MODE_STORAGE_KEY,
  getStoredThemeAccent,
  getStoredThemeButtonStyle,
  getStoredThemeMode,
  getSystemTheme,
  normalizeThemeAccent,
  normalizeThemeButtonStyle,
  normalizeThemeMode,
} from '../../lib/theme.js'
import { isParentPortalHost } from '../../lib/app-origins.js'
import { isParentIntentPath } from '../../lib/parent-auth-intent.js'
import { CAPABILITIES } from '../../lib/paywall-access.js'
import { canUseUiFeature } from '../../lib/paywall-ui.js'
import { isRecoveryPathVisible } from '../../lib/recovery-phase.js'
import { Sidebar } from './Sidebar.jsx'
import { Topbar } from './Topbar.jsx'
import { OnboardingProvider } from '../onboarding/OnboardingProvider.jsx'

const QUICK_ACTION_POSITION_STORAGE_KEY = 'football-player:quick-action-position'
const QUICK_ACTION_EDGE_GAP = 16
const QUICK_ACTION_BUTTON_SIZE = 56
const QUICK_ACTION_MENU_WIDTH = 288
const QUICK_ACTION_MENU_GAP = 12
const QUICK_ACTION_MENU_BREAKPOINT = 640

export function Layout() {
  const { accessModeOptions, authError, clubOptions, isProfileLoading, selectAccessMode, selectClub, selectTeam, teamOptions, user } = useAuth()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [clubSelectionError, setClubSelectionError] = useState('')
  const [themeMode, setThemeMode] = useState(getStoredThemeMode)
  const [themeAccent, setThemeAccent] = useState(getStoredThemeAccent)
  const [themeButtonStyle, setThemeButtonStyle] = useState(getStoredThemeButtonStyle)
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)
  const lastClickAuditRef = useRef({ key: '', timestamp: 0 })
  const location = useLocation()
  const matches = useMatches()
  const isParentShellHost = isParentPortalHost()
  const isParentIntentRoute = isParentIntentPath(location.pathname)
  const shouldBypassMainShell = isParentShellHost || isParentIntentRoute
  const activeTitle = [...matches].reverse().find((match) => match.handle?.title)?.handle?.title ?? 'Dashboard'
  const resolvedTheme = useMemo(
    () => (themeMode === 'system' ? systemTheme : themeMode),
    [systemTheme, themeMode],
  )
  const effectiveTheme = resolvedTheme

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemThemeChange = () => {
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', handleSystemThemeChange)
    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange)
    }
  }, [])

  useEffect(() => {
    const handleThemeChange = (event) => {
      setThemeMode(normalizeThemeMode(event.detail?.mode ?? getStoredThemeMode()))
      setThemeAccent(normalizeThemeAccent(event.detail?.accent ?? getStoredThemeAccent()))
      setThemeButtonStyle(normalizeThemeButtonStyle(event.detail?.buttonStyle ?? getStoredThemeButtonStyle()))
    }

    window.addEventListener(THEME_CHANGED_EVENT, handleThemeChange)
    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, handleThemeChange)
    }
  }, [])

  useEffect(() => {
    if (!user?.id) {
      return
    }

    const hasSavedTheme = Boolean(user.themeMode || user.themeAccent || user.themeButtonStyle)

    if (!hasSavedTheme) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setThemeMode(normalizeThemeMode(user.themeMode || getStoredThemeMode()))
      setThemeAccent(normalizeThemeAccent(user.themeAccent || getStoredThemeAccent()))
      setThemeButtonStyle(normalizeThemeButtonStyle(user.themeButtonStyle || getStoredThemeButtonStyle()))
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [user?.id, user?.themeAccent, user?.themeButtonStyle, user?.themeMode])

  useEffect(() => {
    document.documentElement.classList.remove(
      'theme-light',
      'theme-dark',
      'accent-yellow',
      'accent-blue',
      'accent-green',
      'accent-red',
      'accent-purple',
      'button-style-solid',
      'button-style-gradient',
    )
    document.body.classList.remove(
      'theme-light',
      'theme-dark',
      'accent-yellow',
      'accent-blue',
      'accent-green',
      'accent-red',
      'accent-purple',
      'button-style-solid',
      'button-style-gradient',
    )
    document.documentElement.classList.add(effectiveTheme === 'dark' ? 'theme-dark' : 'theme-light')
    document.documentElement.classList.add(`accent-${themeAccent}`)
    document.documentElement.classList.add(`button-style-${themeButtonStyle}`)
    document.body.classList.add(effectiveTheme === 'dark' ? 'theme-dark' : 'theme-light')
    document.body.classList.add(`accent-${themeAccent}`)
    document.body.classList.add(`button-style-${themeButtonStyle}`)
    document.documentElement.dataset.themeAccent = themeAccent
    document.documentElement.dataset.buttonStyle = themeButtonStyle
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode)
    window.localStorage.setItem(THEME_ACCENT_STORAGE_KEY, themeAccent)
    window.localStorage.setItem(THEME_BUTTON_STYLE_STORAGE_KEY, themeButtonStyle)
  }, [effectiveTheme, themeAccent, themeButtonStyle, themeMode])

  useEffect(() => {
    const legacyTheme = window.localStorage.getItem('app-theme')

    if (legacyTheme) {
      window.localStorage.removeItem('app-theme')
    }
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  useEffect(() => {
    if (shouldBypassMainShell || !user?.id) {
      return
    }

    void createAuditLog({
      user,
      action: 'page_viewed',
      entityType: 'page',
      metadata: {
        path: location.pathname,
        search: location.search,
        title: activeTitle,
      },
    })
  }, [activeTitle, location.pathname, location.search, shouldBypassMainShell, user])

  useEffect(() => {
    if (shouldBypassMainShell || !user?.id) {
      return undefined
    }

    const handleTrackedClick = (event) => {
      const target = event.target instanceof Element ? event.target.closest('button, a, [role="button"]') : null

      if (!target) {
        return
      }

      const label =
        String(target.getAttribute('aria-label') ?? '').trim() ||
        String(target.textContent ?? '').replace(/\s+/g, ' ').trim() ||
        String(target.getAttribute('href') ?? '').trim() ||
        'Unlabelled action'
      const href = target instanceof HTMLAnchorElement ? target.getAttribute('href') : ''
      const key = `${location.pathname}:${label}:${href || ''}`
      const now = Date.now()

      if (lastClickAuditRef.current.key === key && now - lastClickAuditRef.current.timestamp < 2000) {
        return
      }

      lastClickAuditRef.current = {
        key,
        timestamp: now,
      }

      void createAuditLog({
        user,
        action: 'ui_clicked',
        entityType: 'ui',
        metadata: {
          label: label.slice(0, 160),
          path: location.pathname,
          href,
          tag: target.tagName.toLowerCase(),
        },
      })
    }

    document.addEventListener('click', handleTrackedClick, true)
    return () => {
      document.removeEventListener('click', handleTrackedClick, true)
    }
  }, [location.pathname, shouldBypassMainShell, user])

  const handleClubSelect = async (clubId) => {
    setClubSelectionError('')

    try {
      await selectClub(clubId)
    } catch (error) {
      console.error(error)
      setClubSelectionError(error.message || 'Could not open this club.')
    }
  }

  const handleAccessModeSelect = async (accessMode) => {
    setClubSelectionError('')

    try {
      await selectAccessMode(accessMode)
    } catch (error) {
      console.error(error)
      setClubSelectionError(error.message || 'Could not open this access.')
    }
  }

  const handleTeamSelect = async (teamId) => {
    setClubSelectionError('')

    try {
      await selectTeam(teamId)
    } catch (error) {
      console.error(error)
      setClubSelectionError(error.message || 'Could not open this team.')
    }
  }

  const needsAccessModeSelection = !user && accessModeOptions.length > 0
  const needsClubSelection = !needsAccessModeSelection && !isSuperAdmin(user) && clubOptions.length > 1
  const needsTeamSelection = !needsAccessModeSelection && clubOptions.length === 0 && teamOptions.length > 1 && !user?.activeTeamId && !isClubAdmin(user)
  const shouldSuppressOnboardingSetup = false

  if (shouldBypassMainShell) {
    return (
      <div className="min-h-screen overflow-x-hidden bg-[var(--app-bg)] text-[var(--text-primary)]">
        <div className="fixed inset-0 -z-10 bg-[var(--app-bg)]" />
        <main className="min-h-screen px-4 py-5 sm:px-6 md:px-8 xl:px-10">
          <div className="mx-auto w-full max-w-[108rem]">
            <Outlet />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--app-bg)] text-[var(--text-primary)]">
      <div className="fixed inset-0 -z-10 bg-[var(--app-bg)]" />
      <div className="flex min-h-screen w-full">
        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-[20.5rem]">
          <Topbar
            title={activeTitle}
            onMenuClick={() => setIsSidebarOpen(true)}
          />

          <main className="flex-1 px-4 py-5 sm:px-6 md:px-8 xl:px-10">
            <div className="mx-auto w-full max-w-[108rem]">
              <OnboardingProvider suppressSetup={shouldSuppressOnboardingSetup}>
                {needsAccessModeSelection ? (
                  <WorkspaceSelection
                    eyebrow="Workspace access"
                    title="Choose the work area for this session."
                    description="This login can open more than one football workspace. Pick the access mode before using team tools, parent messages, or setup actions."
                    error={clubSelectionError || authError}
                    isLoading={isProfileLoading}
                    options={accessModeOptions.map((option) => ({
                      ...option,
                      action: 'Open access',
                    }))}
                    onSelect={handleAccessModeSelect}
                  />
                ) : needsClubSelection ? (
                  <WorkspaceSelection
                    eyebrow="Club access"
                    title="Choose the club workspace to open."
                    description="This email is linked to more than one club. Pick the club before changing players, teams, staff, parents, or billing details."
                    error={clubSelectionError || authError}
                    isLoading={isProfileLoading}
                    options={clubOptions.map((option) => ({
                      id: option.clubId,
                      label: option.clubName || 'Unnamed club',
                      meta: option.roleLabel || option.role || 'Club user',
                      action: 'Open club',
                    }))}
                    onSelect={handleClubSelect}
                  />
                ) : needsTeamSelection ? (
                  <WorkspaceSelection
                    eyebrow="Team access"
                    title="Choose your team"
                    description="You are linked to more than one team. Select the team you want to work with."
                    error={clubSelectionError || authError}
                    hideExplainer
                    isLoading={isProfileLoading}
                    options={teamOptions.map((option) => ({
                      id: option.id,
                      label: option.name || 'Unnamed team',
                      meta: option.roleLabel || option.role || option.accessLabel || 'Team access',
                      action: 'Open team',
                    }))}
                    onSelect={handleTeamSelect}
                  />
                ) : (
                  <Outlet />
                )}
              </OnboardingProvider>
            </div>
          </main>
        </div>
      </div>
      <QuickActionHotbar user={user} />
    </div>
  )
}

function QuickActionHotbar({ user }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isVoiceNoteOpen, setIsVoiceNoteOpen] = useState(false)
  const [hasActiveOverlay, setHasActiveOverlay] = useState(false)
  const [quickActionPosition, setQuickActionPosition] = useState(getStoredQuickActionPosition)
  const [isDraggingQuickAction, setIsDraggingQuickAction] = useState(false)
  const panelRef = useRef(null)
  const dragStateRef = useRef(null)
  const suppressNextQuickActionClickRef = useRef(false)
  const canUseEvaluationQuickActions = canCreateEvaluation(user)
  const canUseClubCalendarQuickAction =
    isClubAdmin(user) && canUseUiFeature(user, CAPABILITIES.clubWideEvents) && isRecoveryPathVisible('/calendar', { user })
  const canUsePollQuickAction = canManagePolls(user) && isRecoveryPathVisible('/polls', { user })
  const canShowQuickActions =
    Boolean(user?.clubId)
    && !isSuperAdmin(user)
    && !isParentPortalUser(user)
    && Number(user?.roleRank ?? 0) >= 20
    && (canUseEvaluationQuickActions || canUseClubCalendarQuickAction || canUsePollQuickAction)

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const handlePointerDown = (event) => {
      if (panelRef.current?.contains(event.target)) {
        return
      }

      setIsOpen(false)
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    const updateOverlayState = () => {
      const nextHasActiveOverlay = Boolean(document.querySelector('[aria-modal="true"], [role="dialog"]'))
      setHasActiveOverlay(nextHasActiveOverlay)
      if (nextHasActiveOverlay) {
        setIsOpen(false)
      }
    }
    const observer = new MutationObserver(updateOverlayState)

    updateOverlayState()
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    })
    document.addEventListener('focusin', updateOverlayState)

    return () => {
      observer.disconnect()
      document.removeEventListener('focusin', updateOverlayState)
    }
  }, [])

  useEffect(() => {
    const handleResize = () => {
      setQuickActionPosition((current) => {
        const nextPosition = clampQuickActionPosition(current ?? getDefaultQuickActionPosition())
        saveQuickActionPosition(nextPosition)
        return nextPosition
      })
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  if (!canShowQuickActions) {
    return null
  }

  const handleQuickActionPointerDown = (event) => {
    if (event.button !== 0) {
      return
    }

    const buttonRect = event.currentTarget.getBoundingClientRect()
    const startPosition = quickActionPosition ?? {
      x: buttonRect.left,
      y: buttonRect.top,
    }

    dragStateRef.current = {
      moved: false,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: startPosition.x,
      startY: startPosition.y,
    }

    const handlePointerMove = (moveEvent) => {
      const dragState = dragStateRef.current

      if (!dragState || dragState.pointerId !== moveEvent.pointerId) {
        return
      }

      const deltaX = moveEvent.clientX - dragState.startClientX
      const deltaY = moveEvent.clientY - dragState.startClientY
      const movedEnough = Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4

      if (movedEnough) {
        dragState.moved = true
        setIsDraggingQuickAction(true)
        setIsOpen(false)
      }

      if (!dragState.moved) {
        return
      }

      moveEvent.preventDefault()
      setQuickActionPosition(clampQuickActionPosition({
        x: dragState.startX + deltaX,
        y: dragState.startY + deltaY,
      }))
    }

    const handlePointerUp = (upEvent) => {
      const dragState = dragStateRef.current

      if (dragState?.pointerId === upEvent.pointerId && dragState.moved) {
        const finalPosition = clampQuickActionPosition({
          x: dragState.startX + upEvent.clientX - dragState.startClientX,
          y: dragState.startY + upEvent.clientY - dragState.startClientY,
        })
        suppressNextQuickActionClickRef.current = true
        setQuickActionPosition(finalPosition)
        saveQuickActionPosition(finalPosition)
        window.setTimeout(() => {
          suppressNextQuickActionClickRef.current = false
        }, 0)
      }

      dragStateRef.current = null
      setIsDraggingQuickAction(false)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  const actions = [
    { label: 'Add Player', href: '/add-player', isVisible: canUseEvaluationQuickActions },
    { label: 'Add Session', href: '/sessions/start?action=create-session', isVisible: canUseEvaluationQuickActions },
    { label: 'Add Assessment', href: '/assess-player/new?choosePlayer=1', isVisible: canUseEvaluationQuickActions },
    { label: 'Add Event', href: '/calendar?action=add-event', isVisible: canUseEvaluationQuickActions || canUseClubCalendarQuickAction },
    { label: 'Create Poll', href: '/polls?action=create-poll', isVisible: canUsePollQuickAction },
    { label: 'Add Voice Note', type: 'voice-note', isVisible: canUseEvaluationQuickActions },
  ]
  const visibleActions = actions.filter((action) => action.isVisible !== false)
  const quickActionMenuStyle = getQuickActionMenuStyle(quickActionPosition, visibleActions.length)

  return (
    <>
      <div
        ref={panelRef}
        className={[
          'fixed z-[70] flex flex-col items-end gap-3 transition duration-150',
          hasActiveOverlay ? 'pointer-events-none translate-y-2 opacity-0' : 'opacity-100',
        ].join(' ')}
        style={{
          left: `${quickActionPosition.x}px`,
          top: `${quickActionPosition.y}px`,
        }}
        aria-hidden={hasActiveOverlay ? 'true' : undefined}
      >
        {isOpen ? (
          <div
            className="fixed rounded-lg border border-[#d7e5dc] bg-white p-2 shadow-2xl shadow-[#047857]/20"
            style={quickActionMenuStyle}
          >
            <p className="px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Quick add</p>
            <div className="grid gap-1.5">
              {visibleActions.map((action) => (
                action.href ? (
                  <Link
                    key={action.href}
                    to={action.href}
                    onClick={() => setIsOpen(false)}
                    className="flex min-h-12 items-center justify-between rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5]"
                  >
                    <span>{action.label}</span>
                    <span aria-hidden="true">+</span>
                  </Link>
                ) : (
                  <button
                    key={action.type}
                    type="button"
                    onClick={() => {
                      setIsOpen(false)
                      setIsVoiceNoteOpen(true)
                    }}
                    className="flex min-h-12 items-center justify-between rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-left text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5]"
                  >
                    <span>{action.label}</span>
                    <span aria-hidden="true">+</span>
                  </button>
                )
              ))}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onPointerDown={handleQuickActionPointerDown}
          onClick={(event) => {
            if (suppressNextQuickActionClickRef.current) {
              event.preventDefault()
              return
            }

            setIsOpen((current) => !current)
          }}
          aria-expanded={isOpen}
          aria-label={isOpen ? 'Close quick actions' : 'Open quick actions'}
          className={`inline-flex h-14 w-14 touch-none items-center justify-center rounded-full border border-[#bbf7d0] bg-[#047857] text-3xl font-black leading-none text-white shadow-xl shadow-[#047857]/30 transition hover:bg-[#065f46] focus:outline-none focus:ring-2 focus:ring-[#0f9f6e] focus:ring-offset-2 focus:ring-offset-[var(--app-bg)] ${isDraggingQuickAction ? 'cursor-grabbing' : 'cursor-grab'}`}
        >
          +
        </button>
      </div>

      <QuickVoiceNoteModal
        isOpen={isVoiceNoteOpen}
        onClose={() => setIsVoiceNoteOpen(false)}
        user={user}
      />
    </>
  )
}

function getDefaultQuickActionPosition() {
  if (typeof window === 'undefined') {
    return {
      x: QUICK_ACTION_EDGE_GAP,
      y: QUICK_ACTION_EDGE_GAP,
    }
  }

  return {
    x: Math.max(QUICK_ACTION_EDGE_GAP, window.innerWidth - QUICK_ACTION_BUTTON_SIZE - 20),
    y: Math.max(QUICK_ACTION_EDGE_GAP, window.innerHeight - QUICK_ACTION_BUTTON_SIZE - 20),
  }
}

function clampQuickActionPosition(position) {
  if (typeof window === 'undefined') {
    return position
  }

  return {
    x: Math.min(
      Math.max(Number(position?.x ?? 0), QUICK_ACTION_EDGE_GAP),
      Math.max(QUICK_ACTION_EDGE_GAP, window.innerWidth - QUICK_ACTION_BUTTON_SIZE - QUICK_ACTION_EDGE_GAP),
    ),
    y: Math.min(
      Math.max(Number(position?.y ?? 0), QUICK_ACTION_EDGE_GAP),
      Math.max(QUICK_ACTION_EDGE_GAP, window.innerHeight - QUICK_ACTION_BUTTON_SIZE - QUICK_ACTION_EDGE_GAP),
    ),
  }
}

function getQuickActionMenuStyle(position, actionCount = 0) {
  if (typeof window === 'undefined') {
    return {
      maxHeight: `calc(100vh - ${QUICK_ACTION_EDGE_GAP * 2}px)`,
      overflowY: 'auto',
      width: `${QUICK_ACTION_MENU_WIDTH}px`,
    }
  }

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  if (viewportWidth < QUICK_ACTION_MENU_BREAKPOINT) {
    return {
      bottom: `${QUICK_ACTION_EDGE_GAP}px`,
      left: `${QUICK_ACTION_EDGE_GAP}px`,
      maxHeight: `calc(100vh - ${QUICK_ACTION_EDGE_GAP * 2}px)`,
      overflowY: 'auto',
      right: `${QUICK_ACTION_EDGE_GAP}px`,
      width: 'auto',
    }
  }

  const safePosition = clampQuickActionPosition(position ?? getDefaultQuickActionPosition())
  const menuWidth = Math.min(QUICK_ACTION_MENU_WIDTH, Math.max(0, viewportWidth - QUICK_ACTION_EDGE_GAP * 2))
  const estimatedMenuHeight = Math.min(
    viewportHeight - QUICK_ACTION_EDGE_GAP * 2,
    58 + Math.max(1, Number(actionCount) || 1) * 54 + Math.max(0, Number(actionCount) - 1) * 6,
  )
  const maxLeft = Math.max(QUICK_ACTION_EDGE_GAP, viewportWidth - menuWidth - QUICK_ACTION_EDGE_GAP)
  const left = Math.min(
    Math.max(safePosition.x + QUICK_ACTION_BUTTON_SIZE - menuWidth, QUICK_ACTION_EDGE_GAP),
    maxLeft,
  )
  const belowTop = safePosition.y + QUICK_ACTION_BUTTON_SIZE + QUICK_ACTION_MENU_GAP
  const aboveTop = safePosition.y - QUICK_ACTION_MENU_GAP - estimatedMenuHeight
  const hasRoomBelow = belowTop + estimatedMenuHeight <= viewportHeight - QUICK_ACTION_EDGE_GAP
  const preferredTop = hasRoomBelow ? belowTop : aboveTop
  const maxTop = Math.max(QUICK_ACTION_EDGE_GAP, viewportHeight - estimatedMenuHeight - QUICK_ACTION_EDGE_GAP)
  const top = Math.min(Math.max(preferredTop, QUICK_ACTION_EDGE_GAP), maxTop)

  return {
    left: `${left}px`,
    maxHeight: `calc(100vh - ${QUICK_ACTION_EDGE_GAP * 2}px)`,
    overflowY: 'auto',
    top: `${top}px`,
    width: `${menuWidth}px`,
  }
}

function getStoredQuickActionPosition() {
  if (typeof window === 'undefined') {
    return getDefaultQuickActionPosition()
  }

  try {
    const storedPosition = JSON.parse(window.localStorage.getItem(QUICK_ACTION_POSITION_STORAGE_KEY) || 'null')

    if (storedPosition && Number.isFinite(storedPosition.x) && Number.isFinite(storedPosition.y)) {
      return clampQuickActionPosition(storedPosition)
    }
  } catch {
    window.localStorage.removeItem(QUICK_ACTION_POSITION_STORAGE_KEY)
  }

  return getDefaultQuickActionPosition()
}

function saveQuickActionPosition(position) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(QUICK_ACTION_POSITION_STORAGE_KEY, JSON.stringify(position))
}

function formatVoiceNoteDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(value / 60)
  const remainder = String(value % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

function stopVoiceNoteStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop())
}

function getVoiceNoteDurationSeconds({ accumulatedMilliseconds, startedAt }) {
  const currentSegment = startedAt ? Date.now() - startedAt : 0
  return Math.max(1, Math.round((accumulatedMilliseconds + currentSegment) / 1000))
}

function getVoiceNoteErrorMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return 'Microphone access is needed to record a voice note.'
  }

  return error?.message || 'Voice note could not be recorded.'
}

function QuickVoiceNoteModal({ isOpen, onClose, user }) {
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [savedNote, setSavedNote] = useState(null)
  const [assignedPlayerName, setAssignedPlayerName] = useState('')
  const [players, setPlayers] = useState([])
  const [playerSearch, setPlayerSearch] = useState('')
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)
  const mediaRecorderRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingStartedAtRef = useRef(0)
  const accumulatedRecordingMillisecondsRef = useRef(0)
  const streamRef = useRef(null)
  const canPauseRecording = Boolean(mediaRecorderRef.current?.pause && mediaRecorderRef.current?.resume)

  const resetModal = () => {
    const recorder = mediaRecorderRef.current
    if (recorder?.state === 'recording' || recorder?.state === 'paused') {
      recorder.onstop = null
      recorder.stop()
    }

    stopVoiceNoteStream(streamRef.current)
    streamRef.current = null
    mediaRecorderRef.current = null
    recordingChunksRef.current = []
    recordingStartedAtRef.current = 0
    accumulatedRecordingMillisecondsRef.current = 0
    setStatus('idle')
    setErrorMessage('')
    setAudioBlob(null)
    setAudioUrl((currentUrl) => {
      if (currentUrl) {
        globalThis.URL?.revokeObjectURL?.(currentUrl)
      }
      return ''
    })
    setDurationSeconds(0)
    setElapsedSeconds(0)
    setSavedNote(null)
    setAssignedPlayerName('')
    setPlayers([])
    setPlayerSearch('')
    setIsLoadingPlayers(false)
    setIsSaving(false)
    setIsAssigning(false)
  }

  const handleClose = () => {
    resetModal()
    onClose()
  }

  useEffect(() => {
    return () => {
      stopVoiceNoteStream(streamRef.current)
    }
  }, [])

  useEffect(() => {
    if (status !== 'recording') {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds(getVoiceNoteDurationSeconds({
        accumulatedMilliseconds: accumulatedRecordingMillisecondsRef.current,
        startedAt: recordingStartedAtRef.current,
      }))
    }, 500)

    return () => window.clearInterval(intervalId)
  }, [status])

  useEffect(() => {
    return () => {
      if (audioUrl) {
        globalThis.URL?.revokeObjectURL?.(audioUrl)
      }
    }
  }, [audioUrl])

  useEffect(() => {
    if (!isOpen) {
      resetModal()
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const filteredPlayers = players.filter((player) => {
    const searchValue = playerSearch.trim().toLowerCase()
    if (!searchValue) {
      return true
    }

    return [player.playerName, player.section, player.team]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(searchValue))
  })

  const startRecording = async () => {
    setErrorMessage('')

    if (!globalThis.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Voice recording is not supported in this browser.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new globalThis.MediaRecorder(stream, getRecorderOptions())
      streamRef.current = stream
      recordingChunksRef.current = []
      recordingStartedAtRef.current = Date.now()
      accumulatedRecordingMillisecondsRef.current = 0
      setAudioBlob(null)
      setSavedNote(null)
      setDurationSeconds(0)
      setElapsedSeconds(0)

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          recordingChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const chunks = recordingChunksRef.current
        const nextDurationSeconds = getVoiceNoteDurationSeconds({
          accumulatedMilliseconds: accumulatedRecordingMillisecondsRef.current,
          startedAt: recorder.state === 'inactive' ? 0 : recordingStartedAtRef.current,
        })
        stopVoiceNoteStream(stream)
        streamRef.current = null
        mediaRecorderRef.current = null
        recordingChunksRef.current = []
        recordingStartedAtRef.current = 0
        accumulatedRecordingMillisecondsRef.current = 0

        if (chunks.length === 0) {
          setStatus('idle')
          setErrorMessage('No audio was captured. Try recording again.')
          return
        }

        const nextBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        const nextAudioUrl = globalThis.URL?.createObjectURL?.(nextBlob) || ''
        setAudioBlob(nextBlob)
        setAudioUrl((currentUrl) => {
          if (currentUrl) {
            globalThis.URL?.revokeObjectURL?.(currentUrl)
          }
          return nextAudioUrl
        })
        setDurationSeconds(nextDurationSeconds)
        setStatus('recorded')
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setStatus('recording')
      setElapsedSeconds(1)
    } catch (error) {
      console.error(error)
      stopVoiceNoteStream(streamRef.current)
      streamRef.current = null
      setStatus('idle')
      setErrorMessage(getVoiceNoteErrorMessage(error))
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      accumulatedRecordingMillisecondsRef.current += Date.now() - recordingStartedAtRef.current
      recordingStartedAtRef.current = 0
      setDurationSeconds(Math.max(1, Math.round(accumulatedRecordingMillisecondsRef.current / 1000)))
      mediaRecorderRef.current.stop()
    } else if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.stop()
    }
  }

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state !== 'recording' || !canPauseRecording) {
      return
    }

    accumulatedRecordingMillisecondsRef.current += Date.now() - recordingStartedAtRef.current
    recordingStartedAtRef.current = 0
    setElapsedSeconds(Math.max(1, Math.round(accumulatedRecordingMillisecondsRef.current / 1000)))
    mediaRecorderRef.current.pause()
    setStatus('paused')
  }

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state !== 'paused' || !canPauseRecording) {
      return
    }

    recordingStartedAtRef.current = Date.now()
    mediaRecorderRef.current.resume()
    setStatus('recording')
  }

  const discardRecording = () => {
    if (audioBlob && !window.confirm('This will discard the current recording. Continue?')) {
      return
    }

    setAudioBlob(null)
    setAudioUrl((currentUrl) => {
      if (currentUrl) {
        globalThis.URL?.revokeObjectURL?.(currentUrl)
      }
      return ''
    })
    setDurationSeconds(0)
    setElapsedSeconds(0)
    setStatus('idle')
  }

  const saveVoiceNote = async () => {
    if (!audioBlob || isSaving) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      const nextNote = await createPlayerStaffNote({
        user,
        playerId: '',
        sessionId: '',
        note: 'Unassigned staff voice note',
        audioBlob,
        audioDurationSeconds: durationSeconds,
      })
      setSavedNote(nextNote)
      setStatus('saved')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Voice note could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  const loadPlayersForAssign = async () => {
    setIsLoadingPlayers(true)
    setErrorMessage('')

    try {
      const nextPlayers = await getPlayers({ user })
      setPlayers(nextPlayers)
      setStatus('assigning')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Players could not be loaded.')
    } finally {
      setIsLoadingPlayers(false)
    }
  }

  const assignToPlayer = async (player) => {
    if (!savedNote?.id || !player?.id || isAssigning) {
      return
    }

    setIsAssigning(true)
    setErrorMessage('')

    try {
      const nextNote = await assignPlayerStaffNote({
        user,
        noteId: savedNote.id,
        playerId: player.id,
      })
      setSavedNote(nextNote)
      setAssignedPlayerName(player.playerName || 'the selected player')
      setStatus('assigned')
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not assign the voice note. Please try again.')
    } finally {
      setIsAssigning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 px-3 py-4 backdrop-blur-sm sm:items-center">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--shell-card)] p-4 text-[var(--text-primary)] shadow-2xl shadow-black/40 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--accent)]">Staff only</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight">Add voice note</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-[var(--text-muted)]">
              Capture a quick staff note now. It stays private until you assign it to a player record.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)]"
          >
            X
          </button>
        </div>

        <div className="mt-5 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
          {status === 'recording' ? (
            <div>
              <p className="text-lg font-black text-[var(--text-primary)]">Recording now</p>
              <p className="mt-2 text-sm font-semibold text-[var(--text-muted)]">Duration {formatVoiceNoteDuration(elapsedSeconds)}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {canPauseRecording ? (
                  <button
                    type="button"
                    onClick={pauseRecording}
                    className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)]"
                  >
                    Pause
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={stopRecording}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-black text-[var(--button-primary-text)] transition hover:opacity-90"
                >
                  Stop
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {status === 'paused' ? (
            <div>
              <p className="text-lg font-black text-[var(--text-primary)]">Recording paused</p>
              <p className="mt-2 text-sm font-semibold text-[var(--text-muted)]">Duration {formatVoiceNoteDuration(elapsedSeconds)}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={resumeRecording}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-black text-[var(--button-primary-text)] transition hover:opacity-90"
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={stopRecording}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)]"
                >
                  Stop
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {status === 'idle' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={startRecording}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-black text-[var(--button-primary-text)] transition hover:opacity-90"
              >
                Start recording
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)]"
              >
                Cancel
              </button>
            </div>
          ) : null}

          {status === 'recorded' ? (
            <div className="space-y-4">
              <div>
                <p className="text-lg font-black text-[var(--text-primary)]">Preview voice note</p>
                <p className="mt-1 text-sm font-semibold text-[var(--text-muted)]">Length {formatVoiceNoteDuration(durationSeconds)}</p>
              </div>
              {audioUrl ? <audio controls src={audioUrl} className="w-full" /> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={saveVoiceNote}
                  disabled={isSaving}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-black text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? 'Saving...' : 'Save voice note'}
                </button>
                <button
                  type="button"
                  onClick={discardRecording}
                  disabled={isSaving}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Discard and record new
                </button>
              </div>
            </div>
          ) : null}

          {status === 'saved' ? (
            <div className="space-y-4">
              <div>
                <p className="text-lg font-black text-[var(--text-primary)]">Voice note saved</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[var(--text-muted)]">
                  You can assign it to a player now or find it later in unassigned voice notes.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={loadPlayersForAssign}
                  disabled={isLoadingPlayers}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-black text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoadingPlayers ? 'Loading players...' : 'Assign to player'}
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)]"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {status === 'assigning' ? (
            <div className="space-y-4">
              <div>
                <p className="text-lg font-black text-[var(--text-primary)]">Assign to player</p>
                <p className="mt-2 text-sm font-semibold text-[var(--text-muted)]">Choose a squad or trial player from this team.</p>
              </div>
              <input
                type="search"
                value={playerSearch}
                onChange={(event) => setPlayerSearch(event.target.value)}
                placeholder="Search players"
                className="min-h-12 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm font-bold text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
              />
              <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
                {filteredPlayers.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => assignToPlayer(player)}
                    disabled={isAssigning}
                    className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-left transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span>
                      <span className="block text-sm font-black text-[var(--text-primary)]">{player.playerName}</span>
                      <span className="mt-1 block text-xs font-bold text-[var(--text-muted)]">{player.section || 'Squad'} | {player.team || user?.activeTeamName || 'Current team'}</span>
                    </span>
                    <span className="text-xs font-black uppercase tracking-[0.12em] text-[var(--accent)]">Assign</span>
                  </button>
                ))}
                {!isLoadingPlayers && filteredPlayers.length === 0 ? (
                  <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-4 text-sm font-bold text-[var(--text-muted)]">
                    No players found for this team.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {status === 'assigned' ? (
            <div className="space-y-4">
              <div>
                <p className="text-lg font-black text-[var(--text-primary)]">Voice note assigned</p>
                <p className="mt-2 text-sm font-semibold text-[var(--text-muted)]">The voice note has been linked to {assignedPlayerName || 'the selected player'}.</p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-black text-[var(--button-primary-text)] transition hover:opacity-90"
              >
                Continue
              </button>
            </div>
          ) : null}
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-bold text-[var(--danger-text)]">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function WorkspaceSelection({ description, error, eyebrow, hideExplainer = false, isLoading, onSelect, options, title }) {
  return (
    <section className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="border-b border-[#d7e5dc] bg-[#ecfdf5] p-5 sm:p-7 lg:border-b-0 lg:border-r">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#047857]">{eyebrow}</p>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-[#101828] sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-sm font-semibold leading-7 text-[#4b5f55]">{description}</p>
          {!hideExplainer ? (
          <div className="mt-6 rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10">
            <p className="text-sm font-black text-[#101828]">Before you continue</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
              The workspace selection controls what data loads, which actions are available, and where saved football records belong.
            </p>
          </div>
          ) : null}
        </div>

        <div className="p-4 sm:p-6">
          <div className="grid gap-3">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelect(option.id)}
                disabled={isLoading}
                title={isLoading ? 'Please wait while the workspace opens.' : undefined}
                className="group flex min-h-20 w-full items-center justify-between gap-4 rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 text-left shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#f7faf8] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] text-sm font-black text-[#047857]">
                    {String(option.label || 'W').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-black text-[#101828]">{option.label}</span>
                    <span className="mt-1 block text-sm font-semibold text-[#4b5f55]">{option.meta}</span>
                  </span>
                </span>
                <span className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 text-sm font-black text-[#047857] transition group-hover:border-[#047857] group-hover:bg-[#047857] group-hover:text-white">
                  {isLoading ? 'Opening...' : option.action || 'Open'}
                </span>
              </button>
            ))}
          </div>

          {error ? (
            <div className="mt-4 rounded-lg border border-[#f4b6b6] bg-[#fff5f5] px-4 py-3 text-sm font-bold text-[#b42318]">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
