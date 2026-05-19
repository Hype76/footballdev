import InstallAppButton from '../pwa/InstallAppButton.jsx'

const navItems = [
  ['/login', 'Home'],
  ['/features', 'Features'],
  ['/parents', 'Parents'],
  ['/pricing', 'Pricing'],
]

export function LoginHeader({ logo }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-white/10 bg-[#061009]/90 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
      <a href="/login" className="flex min-w-0 items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#d8ff2f]/30 bg-black/50 shadow-lg shadow-[#d8ff2f]/10 sm:h-16 sm:w-16">
          <img src={logo} alt="Player Feedback" className="h-full w-full object-contain p-1" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-black tracking-tight sm:text-xl">Player Feedback</p>
          <p className="truncate text-xs text-slate-400 sm:text-sm">Football club management software</p>
        </div>
      </a>
      <nav className="hidden items-center gap-1 lg:flex">
        {navItems.map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="rounded-lg px-3 py-2 text-sm font-bold text-slate-200 transition hover:bg-white/[0.07] hover:text-white"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <a
          href="/sign-in"
          className="hidden min-h-11 items-center justify-center rounded-lg border border-[#d8ff2f]/30 bg-[#d8ff2f] px-4 py-3 text-sm font-black text-black transition hover:opacity-90 sm:inline-flex"
        >
          Login
        </a>
        <InstallAppButton
          wrapperClassName="lg:hidden"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-black text-white"
        />
      </div>
    </header>
  )
}
