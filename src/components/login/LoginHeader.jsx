import InstallAppButton from '../pwa/InstallAppButton.jsx'

const navItems = [
  ['/', 'Home'],
  ['/features', 'Features'],
  ['/parents', 'Parents'],
  ['/pricing', 'Pricing'],
]

export function LoginHeader({ logo }) {
  return (
    <>
      <header className="border-b border-white/10 bg-[#061009]/90 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur sm:px-6 sm:py-4 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <a href="/" className="flex min-w-0 items-center gap-3 lg:order-1">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#d8ff2f]/30 bg-black/50 shadow-lg shadow-[#d8ff2f]/10 sm:h-16 sm:w-16">
              <img src={logo} alt="Football Player" className="h-full w-full object-contain p-1" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-black tracking-tight sm:text-xl">Football Player</p>
              <p className="hidden truncate text-xs text-slate-400 min-[420px]:block sm:text-sm">Football club management software</p>
            </div>
          </a>
          <div className="flex items-center gap-2 lg:order-3">
            <a
              href="/sign-in"
              className="hidden min-h-11 items-center justify-center rounded-lg border border-[#d8ff2f]/30 bg-[#d8ff2f] px-4 py-3 text-sm font-black text-black transition hover:opacity-90 sm:inline-flex"
            >
              Login
            </a>
            <InstallAppButton
              wrapperClassName="lg:hidden"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white sm:min-h-11 sm:px-4 sm:py-3 sm:text-sm"
            />
          </div>
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
        </div>
      </header>

      <nav className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex items-center gap-1 rounded-[1.5rem] border border-white/10 bg-black/78 p-2 shadow-2xl shadow-black/60 backdrop-blur-xl sm:inset-x-6 lg:hidden">
        <div className="grid w-full grid-cols-5 gap-1">
          {navItems.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl px-2 py-2 text-center text-[11px] font-black text-slate-200 transition hover:bg-white/[0.08] hover:text-white min-[390px]:text-xs"
            >
              {label}
            </a>
          ))}
          <a
            href="/sign-in"
            className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#d8ff2f] px-2 py-2 text-center text-[11px] font-black text-black transition hover:opacity-90 min-[390px]:text-xs"
          >
            Login
          </a>
        </div>
      </nav>
    </>
  )
}
