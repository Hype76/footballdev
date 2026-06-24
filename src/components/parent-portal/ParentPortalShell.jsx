import { Link } from 'react-router-dom'
import { isRecoveryPathVisible } from '../../lib/recovery-phase.js'

const parentPortalSections = [
  { id: 'overview', label: 'Overview', description: 'Start here', to: '/parent-portal?section=overview' },
  { id: 'calendar', label: 'Calendar', description: 'Shared dates', to: '/parent-portal?section=calendar' },
  { id: 'invites', label: 'Invites', description: 'Sessions and events', to: '/parent-portal?section=invites' },
  { id: 'matches', label: 'Match cards', description: 'Live and upcoming', to: '/parent-portal?section=matches' },
  { id: 'results', label: 'Results', description: 'Previous games', to: '/parent-portal?section=results' },
  { id: 'messages', label: 'Messages', description: 'Club messages', to: '/parent-messages', recoveryPath: '/parent-messages' },
  { id: 'polls', label: 'Polls', description: 'Questions to answer', to: '/parent-polls', recoveryPath: '/parent-polls' },
  { id: 'family', label: 'Family', description: 'Shared access', to: '/friends-family', recoveryPath: '/friends-family' },
  { id: 'settings', label: 'Settings', description: 'Profile and preferences', to: '/parent-portal?section=settings' },
]

export function ParentPortalSectionNav({
  activeSection,
  className = '',
  counts = {},
  onSelect,
  user,
  variant = 'desktop',
}) {
  const visibleSections = parentPortalSections.filter((section) =>
    !section.recoveryPath || isRecoveryPathVisible(section.recoveryPath, { user }))
  const itemClass = (isActive) => [
    'flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition',
    variant === 'mobile' ? 'w-[8.5rem] shrink-0' : 'w-full',
    isActive
      ? 'border-[#047857] bg-[#ecfdf5] text-[#101828]'
      : 'border-[#d7e5dc] bg-[#f7faf8] text-[#101828] hover:border-[#047857] hover:bg-white',
  ].join(' ')
  const wrapperClass = variant === 'mobile'
    ? `fixed inset-x-0 bottom-0 z-[60] border-t border-[#d7e5dc] bg-white/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl shadow-[#047857]/15 backdrop-blur ${className}`.trim()
    : `rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#047857]/10 ${className}`.trim()
  const listClass = variant === 'mobile'
    ? 'flex gap-2 overflow-x-auto overscroll-x-contain pb-1'
    : 'grid gap-2'

  return (
    <nav aria-label="Parent portal sections" className={wrapperClass}>
      <div className={listClass}>
        {visibleSections.map((section) => {
          const isActive = activeSection === section.id
          const count = counts[section.id]
          const content = (
            <>
              <span className="min-w-0">
                <span className="block text-sm font-black">{section.label}</span>
                <span className="mt-0.5 block text-xs font-semibold text-[#4b5f55]">{section.description}</span>
              </span>
              {typeof count === 'number' ? (
                <span className="shrink-0 rounded-full border border-[#d7e5dc] bg-white px-2 py-1 text-xs font-black text-[#047857]">
                  {count}
                </span>
              ) : null}
            </>
          )

          return (
            <Link
              key={section.id}
              to={section.to}
              onClick={(event) => {
                if (!onSelect) {
                  return
                }

                const nextUrl = new URL(section.to, window.location.origin)
                if (nextUrl.pathname === window.location.pathname) {
                  event.preventDefault()
                  onSelect(section.id)
                  window.history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}`)
                }
              }}
              className={itemClass(isActive)}
              aria-current={isActive ? 'page' : undefined}
            >
              {content}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export function ParentPortalRouteShell({
  activeSection,
  children,
  counts,
  user,
}) {
  return (
    <div className="space-y-4 pb-28 sm:space-y-5 lg:pb-0">
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)]">
        <ParentPortalSectionNav
          activeSection={activeSection}
          className="hidden lg:block lg:sticky lg:top-5 lg:self-start"
          counts={counts}
          user={user}
          variant="desktop"
        />
        <main className="min-w-0">
          {children}
        </main>
      </div>
      <ParentPortalSectionNav
        activeSection={activeSection}
        className="lg:hidden"
        counts={counts}
        user={user}
        variant="mobile"
      />
    </div>
  )
}
