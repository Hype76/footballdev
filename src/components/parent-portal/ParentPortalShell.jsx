import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import fallbackLogo from '../../assets/football-player-logo.png'
import { useAuth } from '../../lib/auth.js'
import { buildMainAppUrl } from '../../lib/app-origins.js'
import { rememberParentAccessIntent } from '../../lib/parent-auth-intent.js'
import { resolveParentPortalBranding } from '../../lib/parent-portal-branding.js'
import {
  getParentPortalStaffReturnMode,
  PARENT_PORTAL_STAFF_RETURN_LABEL,
  resolveParentPortalShellContext,
} from '../../lib/parent-portal-shell.js'
import { resolveOwnParentStaffReturnMode } from '../../lib/parent-staff-return-access.js'
import {
  PARENT_PORTAL_MOBILE_NAV_PREFERENCE_EVENT,
  PARENT_PORTAL_MOBILE_NAV_STORAGE_KEY,
  readParentPortalMobileNavCollapsed,
  writeParentPortalMobileNavCollapsed,
} from '../../lib/parent-portal-mobile-nav.js'
import { isRecoveryPathVisible } from '../../lib/recovery-phase.js'
import { getStoredThemeMode, saveThemePreferences } from '../../lib/theme.js'
import {
  MOBILE_ACTION_DOCK_LAYOUT_EVENT,
  isMobileVirtualKeyboardOpen,
} from '../../lib/mobile-action-dock.js'
import { switchToMainAppWorkspace } from '../../lib/workspace-session-bridge.jsx'
import { TEAM_WORKSPACE_HOME_PATH } from '../../lib/workspace-routes.js'

const parentPortalSections = [
  { id: 'overview', label: 'Overview', description: 'Start here', to: '/parent-portal?section=overview' },
  { id: 'calendar', label: 'Calendar', description: 'Shared dates', to: '/parent-portal?section=calendar' },
  { id: 'invites', label: 'Invites', description: 'Sessions and events', to: '/parent-portal?section=invites' },
  { id: 'matches', label: 'Match cards', description: 'Live and upcoming', to: '/parent-portal?section=matches' },
  { id: 'results', label: 'Results', description: 'Previous games', to: '/parent-portal?section=results' },
  { id: 'development', label: 'Development', description: 'Shared reports', to: '/parent-portal?section=development' },
  { id: 'resources', label: 'Resources', description: 'Shared links', to: '/parent-portal?section=resources' },
  { id: 'chat', label: 'Chat', description: 'Child, team and match chat', to: '/parent-chat', recoveryPath: '/parent-chat' },
  { id: 'polls', label: 'Polls', description: 'Questions to answer', to: '/parent-polls', recoveryPath: '/parent-polls' },
  { id: 'settings', label: 'Settings', description: 'Profile and preferences', to: '/parent-portal?section=settings' },
]

function ParentPortalContext({
  collapseButtonRef,
  collapseControlsId,
  links,
  onCollapse,
  onParentLinkSelect,
  selectedLink,
  selectedParentLinkId,
  variant,
}) {
  const {
    activeLink,
    allowedLinks,
    childName,
    clubLogoUrl,
    clubName,
    teamName,
  } = resolveParentPortalShellContext({
    links,
    selectedLink,
    selectedParentLinkId,
  })
  const logoUrl = clubLogoUrl || fallbackLogo
  const isMobile = variant === 'mobile'

  return (
    <section
      aria-label="Family Portal context"
      data-testid={`parent-portal-context-${variant}`}
      className={isMobile
        ? 'mb-1.5 flex min-w-0 items-center gap-2 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-2'
        : 'mb-3 shrink-0 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-3'}
    >
      <div className={isMobile ? 'flex min-w-0 flex-1 items-center gap-2' : 'flex min-w-0 items-center gap-3'}>
        <div className={isMobile
          ? 'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#d7e5dc] bg-white'
          : 'flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10'}
        >
          <img
            src={logoUrl}
            alt={clubLogoUrl ? `${clubName} logo` : 'Football Player logo'}
            className="h-full w-full object-contain p-1.5"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#047857] sm:text-[11px]">
            Family Portal
          </p>
          <p className={isMobile
            ? 'truncate text-sm font-black text-[#101828]'
            : 'mt-1 truncate text-lg font-black tracking-tight text-[#101828]'}
          >
            {clubName}
          </p>
          {isMobile ? (
            <p className="truncate text-[11px] font-semibold text-[#4b5f55]">
              {childName} | {teamName}
            </p>
          ) : null}
        </div>
      </div>

      {!isMobile ? (
        <div className="mt-3 grid gap-2">
          <label className="grid gap-1" htmlFor="parent-portal-shell-child">
            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-[#4b5f55]">
              Child
            </span>
            <select
              id="parent-portal-shell-child"
              value={activeLink?.id || ''}
              onChange={(event) => onParentLinkSelect?.(event.target.value)}
              disabled={allowedLinks.length === 0}
              className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828] outline-none transition focus:border-[#047857] focus:ring-2 focus:ring-[#bbf7d0] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {allowedLinks.length > 0 ? allowedLinks.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.playerName || 'Linked child'}
                </option>
              )) : <option value="">No linked child</option>}
            </select>
          </label>
          <div className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-2">
            <p className="truncate text-xs font-black text-[#101828]">{childName}</p>
            <p className="mt-1 truncate text-[11px] font-semibold text-[#4b5f55]">{teamName}</p>
          </div>
        </div>
      ) : allowedLinks.length > 1 ? (
        <label className="shrink-0" htmlFor="parent-portal-shell-child-mobile">
          <span className="sr-only">Child</span>
          <select
            id="parent-portal-shell-child-mobile"
            value={activeLink?.id || ''}
            onChange={(event) => onParentLinkSelect?.(event.target.value)}
            aria-label="Choose child"
            className="min-h-11 max-w-[8.5rem] rounded-lg border border-[#d7e5dc] bg-white px-2 py-2 text-xs font-black text-[#101828] outline-none focus:border-[#047857] focus:ring-2 focus:ring-[#bbf7d0]"
          >
            {allowedLinks.map((link) => (
              <option key={link.id} value={link.id}>
                {link.playerName || 'Linked child'}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {isMobile && onCollapse ? (
        <button
          ref={collapseButtonRef}
          type="button"
          aria-controls={collapseControlsId}
          aria-expanded="true"
          aria-label="Collapse Parent Portal navigation"
          onClick={onCollapse}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#f7faf8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bbf7d0] motion-reduce:transition-none"
        >
          <span aria-hidden="true">v</span>
          <span className="sr-only">Collapse Parent Portal navigation</span>
        </button>
      ) : null}
    </section>
  )
}

function ParentPortalMobileSectionNav(props) {
  const {
    activeSection,
    className,
  } = props
  const dockId = useId()
  const dockRef = useRef(null)
  const collapseButtonRef = useRef(null)
  const expandButtonRef = useRef(null)
  const pendingFocusRef = useRef('')
  const [isCollapsed, setIsCollapsed] = useState(readParentPortalMobileNavCollapsed)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const activeSectionLabel = parentPortalSections.find((section) => section.id === activeSection)?.label || 'Portal menu'

  const setCollapsedPreference = useCallback((nextCollapsed) => {
    setIsCollapsed(nextCollapsed)
    writeParentPortalMobileNavCollapsed(nextCollapsed)
    window.dispatchEvent(new CustomEvent(PARENT_PORTAL_MOBILE_NAV_PREFERENCE_EVENT, {
      detail: { collapsed: nextCollapsed },
    }))
    setAnnouncement(nextCollapsed ? 'Parent Portal navigation collapsed' : 'Parent Portal navigation expanded')
    pendingFocusRef.current = nextCollapsed ? 'expand' : 'collapse'
  }, [])

  useEffect(() => {
    const syncPreference = (event) => {
      if (event.type === 'storage' && event.key && event.key !== PARENT_PORTAL_MOBILE_NAV_STORAGE_KEY) {
        return
      }

      const nextCollapsed = event.type === 'storage'
        ? readParentPortalMobileNavCollapsed()
        : Boolean(event.detail?.collapsed)
      setIsCollapsed(nextCollapsed)
    }

    window.addEventListener('storage', syncPreference)
    window.addEventListener(PARENT_PORTAL_MOBILE_NAV_PREFERENCE_EVENT, syncPreference)
    return () => {
      window.removeEventListener('storage', syncPreference)
      window.removeEventListener(PARENT_PORTAL_MOBILE_NAV_PREFERENCE_EVENT, syncPreference)
    }
  }, [])

  useEffect(() => {
    if (!pendingFocusRef.current) return
    const target = pendingFocusRef.current === 'expand' ? expandButtonRef.current : collapseButtonRef.current
    pendingFocusRef.current = ''
    window.requestAnimationFrame(() => target?.focus())
  }, [isCollapsed])

  useEffect(() => {
    const updateKeyboardState = () => setIsKeyboardOpen(isMobileVirtualKeyboardOpen())
    const viewport = window.visualViewport

    viewport?.addEventListener('resize', updateKeyboardState)
    viewport?.addEventListener('scroll', updateKeyboardState)
    window.addEventListener('resize', updateKeyboardState)
    document.addEventListener('focusin', updateKeyboardState)
    document.addEventListener('focusout', updateKeyboardState)
    updateKeyboardState()

    return () => {
      viewport?.removeEventListener('resize', updateKeyboardState)
      viewport?.removeEventListener('scroll', updateKeyboardState)
      window.removeEventListener('resize', updateKeyboardState)
      document.removeEventListener('focusin', updateKeyboardState)
      document.removeEventListener('focusout', updateKeyboardState)
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const previousContentPadding = root.style.getPropertyValue('--parent-portal-mobile-nav-content-padding')
    const previousFloatingClearance = root.style.getPropertyValue('--mobile-floating-bottom-clearance')
    const previousState = root.dataset.parentPortalMobileNavState
    let frameId = 0

    const updateClearance = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        const dockTop = dockRef.current?.getBoundingClientRect().top
        if (!Number.isFinite(dockTop)) return
        const clearance = Math.max(24, Math.ceil(window.innerHeight - dockTop + 12))
        root.style.setProperty('--parent-portal-mobile-nav-content-padding', `${clearance}px`)
        root.style.setProperty('--mobile-floating-bottom-clearance', `${clearance}px`)
        root.dataset.parentPortalMobileNavState = isCollapsed ? 'collapsed' : 'expanded'
        window.dispatchEvent(new CustomEvent(MOBILE_ACTION_DOCK_LAYOUT_EVENT))
      })
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updateClearance) : null

    if (dockRef.current) observer?.observe(dockRef.current)
    window.addEventListener('resize', updateClearance)
    updateClearance()

    return () => {
      window.cancelAnimationFrame(frameId)
      observer?.disconnect()
      window.removeEventListener('resize', updateClearance)
      if (previousContentPadding) {
        root.style.setProperty('--parent-portal-mobile-nav-content-padding', previousContentPadding)
      } else {
        root.style.removeProperty('--parent-portal-mobile-nav-content-padding')
      }
      if (previousFloatingClearance) {
        root.style.setProperty('--mobile-floating-bottom-clearance', previousFloatingClearance)
      } else {
        root.style.removeProperty('--mobile-floating-bottom-clearance')
      }
      if (previousState) {
        root.dataset.parentPortalMobileNavState = previousState
      } else {
        delete root.dataset.parentPortalMobileNavState
      }
      window.dispatchEvent(new CustomEvent(MOBILE_ACTION_DOCK_LAYOUT_EVENT))
    }
  }, [isCollapsed])

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      {isCollapsed ? (
        <div
          ref={dockRef}
          id={dockId}
          className={`fixed right-0 z-[60] lg:hidden ${isKeyboardOpen ? 'pointer-events-none translate-x-full opacity-0' : 'transition duration-150 motion-reduce:transition-none'} ${className}`.trim()}
          style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          data-parent-portal-mobile-nav="collapsed"
          data-testid="parent-portal-mobile-nav"
        >
          <button
            ref={expandButtonRef}
            type="button"
            aria-controls={dockId}
            aria-expanded="false"
            aria-label="Expand Parent Portal navigation"
            onClick={() => setCollapsedPreference(false)}
            className="flex min-h-12 min-w-12 max-w-28 items-center gap-2 rounded-l-xl border border-r-0 border-[#d7e5dc] bg-white px-3 py-2 text-[#101828] shadow-xl transition hover:bg-[#f7faf8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bbf7d0] motion-reduce:transition-none"
          >
            <span aria-hidden="true" className="text-lg font-black leading-none">&lt;</span>
            <span className="truncate text-xs font-black">{activeSectionLabel}</span>
          </button>
        </div>
      ) : (
        <ParentPortalSectionNav
          {...props}
          collapseButtonRef={collapseButtonRef}
          collapseControlsId={dockId}
          dockRef={dockRef}
          id={dockId}
          isKeyboardOpen={isKeyboardOpen}
          onCollapse={() => setCollapsedPreference(true)}
          renderMobileDock={false}
        />
      )}
    </>
  )
}

export function ParentPortalSectionNav({
  activeSection,
  collapseButtonRef,
  collapseControlsId,
  className = '',
  dockRef,
  id,
  isKeyboardOpen = false,
  isSigningOut = false,
  links = [],
  newStateByCategory = {},
  onParentLinkSelect,
  onCollapse,
  onSelect,
  onSignOut,
  selectedLink,
  selectedParentLinkId,
  showAccountActions = true,
  user,
  variant = 'desktop',
  renderMobileDock = true,
}) {
  if (variant === 'mobile' && renderMobileDock) {
    return <ParentPortalMobileSectionNav {...{
      activeSection,
      className,
      isSigningOut,
      links,
      newStateByCategory,
      onParentLinkSelect,
      onSelect,
      onSignOut,
      selectedLink,
      selectedParentLinkId,
      showAccountActions,
      user,
      variant,
    }} />
  }

  const visibleSections = parentPortalSections.filter((section) =>
    !section.recoveryPath || isRecoveryPathVisible(section.recoveryPath, { user }))
  const itemClass = (isActive) => [
    'relative flex items-center justify-between gap-3 rounded-lg border px-3 text-left transition',
    variant === 'mobile' ? 'min-h-11 w-[5.75rem] shrink-0 justify-center py-2 text-center' : 'min-h-12 w-full py-2',
    isActive
      ? 'border-[#047857] bg-[#ecfdf5] text-[#101828]'
      : 'border-[#d7e5dc] bg-[#f7faf8] text-[#101828] hover:border-[#047857] hover:bg-white',
  ].join(' ')
  const wrapperClass = variant === 'mobile'
    ? `fixed inset-x-0 bottom-0 z-[60] max-h-[38dvh] overflow-y-auto border-t border-[#d7e5dc] bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl shadow-[#047857]/15 backdrop-blur ${isKeyboardOpen ? 'pointer-events-none translate-y-full opacity-0' : 'transition duration-150 motion-reduce:transition-none'} ${className}`.trim()
    : `flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#047857]/10 ${className}`.trim()
  const listClass = variant === 'mobile'
    ? 'flex gap-2 overflow-x-auto overscroll-x-contain pb-1'
    : 'grid h-full min-h-0 gap-2 overflow-y-auto overscroll-contain pr-1'

  return (
    <div ref={dockRef} id={id} className={wrapperClass} data-parent-portal-mobile-nav={variant === 'mobile' ? 'expanded' : undefined} data-testid={variant === 'mobile' ? 'parent-portal-mobile-nav' : undefined}>
      <ParentPortalContext
        collapseButtonRef={collapseButtonRef}
        collapseControlsId={collapseControlsId}
        links={links}
        onCollapse={onCollapse}
        onParentLinkSelect={onParentLinkSelect}
        selectedLink={selectedLink}
        selectedParentLinkId={selectedParentLinkId}
        variant={variant}
      />
      <nav aria-label="Parent portal sections" className={variant === 'desktop' ? 'min-h-0 flex-1 overflow-hidden' : ''}>
        <div className={listClass}>
          {visibleSections.map((section) => {
            const isActive = activeSection === section.id
            const isNew = Boolean(newStateByCategory[section.id])
            const sectionUrl = new URL(section.to, window.location.origin)
            if (selectedParentLinkId) {
              sectionUrl.searchParams.set('parentLinkId', selectedParentLinkId)
            }
            const sectionTo = `${sectionUrl.pathname}${sectionUrl.search}`
            const content = (
              <>
                <span className="min-w-0">
                  <span className="block text-xs font-black sm:text-sm">{section.label}</span>
                  {variant === 'mobile' ? null : (
                    <span className="mt-0.5 block text-xs font-semibold text-[#4b5f55]">{section.description}</span>
                  )}
                </span>
                <span
                  className={variant === 'mobile'
                    ? 'pointer-events-none absolute right-1 top-1 flex min-w-8 justify-end'
                    : 'pointer-events-none flex min-w-12 shrink-0 justify-end'}
                >
                  {isNew ? (
                    <span
                      aria-label={`${section.label} has new activity`}
                      className="rounded-full border border-[#047857] bg-[#ecfdf5] px-2 py-0.5 text-[0.6875rem] font-black uppercase tracking-wide text-[#047857]"
                    >
                      New
                    </span>
                  ) : null}
                </span>
              </>
            )

            return (
              <Link
                key={section.id}
                to={sectionTo}
                onClick={(event) => {
                  if (!onSelect) {
                    return
                  }

                  const nextUrl = new URL(sectionTo, window.location.origin)
                  if (nextUrl.pathname === window.location.pathname) {
                    event.preventDefault()
                    onSelect(section.id)
                    window.history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}`)
                  }
                }}
                className={itemClass(isActive)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={isNew ? `${section.label}, New activity` : section.label}
              >
                {content}
              </Link>
            )
          })}
        </div>
      </nav>
      {showAccountActions ? (
        <div className={variant === 'mobile' ? 'mt-1 border-t border-[#d7e5dc] pt-1.5' : 'mt-auto shrink-0 border-t border-[#d7e5dc] pt-3'}>
          <ParentPortalAccountActions
            isSigningOut={isSigningOut}
            onSignOut={onSignOut}
            variant={variant}
          />
        </div>
      ) : null}
    </div>
  )
}

export function ParentPortalAccountActions({
  isSigningOut: externalIsSigningOut = false,
  onSignOut,
  variant = 'desktop',
}) {
  const { accessModeOptions, isProfileLoading, selectAccessMode, session, signOut, user } = useAuth()
  const [internalIsSigningOut, setInternalIsSigningOut] = useState(false)
  const [isOpeningTeam, setIsOpeningTeam] = useState(false)
  const [verifiedStaffReturn, setVerifiedStaffReturn] = useState({ mode: '', userId: '' })
  const [switchError, setSwitchError] = useState('')
  const isSigningOut = externalIsSigningOut || internalIsSigningOut
  const declaredStaffReturnMode = getParentPortalStaffReturnMode({ accessModeOptions, user })
  const authUserId = String(session?.user?.id ?? '').trim()
  const verifiedStaffReturnMode = verifiedStaffReturn.userId === authUserId
    ? verifiedStaffReturn.mode
    : ''
  const staffReturnMode = declaredStaffReturnMode || verifiedStaffReturnMode
  const canOpenTeamWorkspace = staffReturnMode === 'team'
  const buttonClass = [
    'inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#f2b8b5] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:bg-[#fff4f3] disabled:cursor-not-allowed disabled:opacity-60',
    variant === 'mobile' ? 'px-3 py-2 text-xs' : '',
  ].filter(Boolean).join(' ')

  useEffect(() => {
    if (declaredStaffReturnMode === 'team' || !authUserId) {
      return undefined
    }

    let isCurrent = true

    resolveOwnParentStaffReturnMode({ id: authUserId })
      .then((mode) => {
        if (isCurrent) {
          setVerifiedStaffReturn({ mode, userId: authUserId })
        }
      })
      .catch(() => {
        if (isCurrent) {
          setVerifiedStaffReturn({ mode: '', userId: authUserId })
        }
      })

    return () => {
      isCurrent = false
    }
  }, [authUserId, declaredStaffReturnMode])
  const switchButtonClass = [
    'inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#047857] bg-[#047857] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/10 transition hover:bg-[#036c4a] disabled:cursor-not-allowed disabled:opacity-60',
    variant === 'mobile' ? 'px-3 py-2 text-xs' : '',
  ].filter(Boolean).join(' ')

  const handleOpenTeamWorkspace = async () => {
    setIsOpeningTeam(true)
    setSwitchError('')

    try {
      await selectAccessMode('team', { deferCommit: true })
      await switchToMainAppWorkspace({ session, targetPath: TEAM_WORKSPACE_HOME_PATH })
    } catch (error) {
      console.error(error)
      setSwitchError(error.message || 'The club workspace could not be opened. Try again or ask a club admin to review this account.')
      setIsOpeningTeam(false)
    }
  }

  const handleSignOut = async () => {
    if (!onSignOut) {
      setInternalIsSigningOut(true)
    }

    try {
      if (onSignOut) {
        await onSignOut()
      } else {
        await signOut()
        rememberParentAccessIntent()
        window.location.assign(buildMainAppUrl('/sign-in?tab=parent'))
      }
    } catch (error) {
      console.error(error)
      setInternalIsSigningOut(false)
    }
  }

  return (
    <div
      className={variant === 'mobile' && canOpenTeamWorkspace ? 'grid grid-cols-2 gap-2' : 'grid gap-2'}
      aria-label="Parent account actions"
    >
      {isProfileLoading && !canOpenTeamWorkspace ? (
        <p aria-live="polite" className={variant === 'mobile' ? 'col-span-2 text-center text-xs font-bold text-[#4b5f55]' : 'text-center text-xs font-bold text-[#4b5f55]'}>
          Checking staff access...
        </p>
      ) : null}
      {canOpenTeamWorkspace ? (
        <button
          type="button"
          onClick={handleOpenTeamWorkspace}
          disabled={isOpeningTeam || isSigningOut || isProfileLoading}
          aria-label={PARENT_PORTAL_STAFF_RETURN_LABEL}
          className={switchButtonClass}
        >
          {isOpeningTeam ? 'Opening club workspace...' : PARENT_PORTAL_STAFF_RETURN_LABEL}
        </button>
      ) : null}
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut || isOpeningTeam}
        aria-label="Sign out of the parent portal"
        className={buttonClass}
      >
        {isSigningOut ? 'Signing out...' : 'Sign out'}
      </button>
      {switchError ? (
        <p role="alert" className={variant === 'mobile' ? 'col-span-2 text-xs font-bold text-[#b42318]' : 'text-sm font-bold text-[#b42318]'}>
          {switchError}
        </p>
      ) : null}
    </div>
  )
}

export function ParentPortalRouteShell({
  activeSection,
  children,
  isSigningOut = false,
  links = [],
  newStateByCategory,
  onSelectedParentLinkChange,
  onSelect,
  onSignOut,
  selectedLink,
  selectedParentLinkId,
  user,
}) {
  const profileLinks = user?.parentPortalLinks
  const resolvedLinks = useMemo(
    () => (Array.isArray(links) && links.length > 0
      ? links
      : (Array.isArray(profileLinks) ? profileLinks : [])),
    [links, profileLinks],
  )
  const resolvedSelectedLink = useMemo(
    () => selectedLink
      ?? resolvedLinks.find((link) => link.id === selectedParentLinkId)
      ?? resolvedLinks[0],
    [resolvedLinks, selectedLink, selectedParentLinkId],
  )

  useEffect(() => {
    if (!resolvedSelectedLink?.id) {
      return
    }

    const branding = resolveParentPortalBranding({
      selectedLink: resolvedSelectedLink,
      links: resolvedLinks,
    })
    saveThemePreferences({
      mode: getStoredThemeMode(),
      accent: branding.accent,
      buttonStyle: branding.buttonStyle,
    })
  }, [resolvedLinks, resolvedSelectedLink])

  return (
    <div
      className="parent-portal-theme-scope space-y-4 pb-[var(--parent-portal-mobile-nav-content-padding,18rem)] transition-[padding-bottom] duration-150 motion-reduce:transition-none sm:space-y-5 lg:h-full lg:min-h-0 lg:space-y-0 lg:pb-0"
      data-testid="parent-portal-route-shell"
    >
      <div className="grid gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)]">
        <ParentPortalSectionNav
          activeSection={activeSection}
          className="hidden lg:flex"
          isSigningOut={isSigningOut}
          links={resolvedLinks}
          newStateByCategory={newStateByCategory}
          onParentLinkSelect={onSelectedParentLinkChange}
          onSelect={onSelect}
          onSignOut={onSignOut}
          selectedLink={resolvedSelectedLink}
          selectedParentLinkId={resolvedSelectedLink?.id || selectedParentLinkId}
          user={user}
          variant="desktop"
        />
        <main className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:scroll-pb-6 lg:pr-1">
          {children}
        </main>
      </div>
      <ParentPortalSectionNav
        activeSection={activeSection}
        className="lg:hidden"
        isSigningOut={isSigningOut}
        links={resolvedLinks}
        newStateByCategory={newStateByCategory}
        onParentLinkSelect={onSelectedParentLinkChange}
        onSelect={onSelect}
        onSignOut={onSignOut}
        selectedLink={resolvedSelectedLink}
        selectedParentLinkId={resolvedSelectedLink?.id || selectedParentLinkId}
        user={user}
        variant="mobile"
      />
    </div>
  )
}
