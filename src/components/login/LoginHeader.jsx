import InstallAppButton from '../pwa/InstallAppButton.jsx'

export function LoginHeader({ logo }) {
  return (
    <header className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-4 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#d8ff2f]/30 bg-black/50 shadow-lg shadow-[#d8ff2f]/10 sm:h-24 sm:w-24">
          <img src={logo} alt="Player Feedback" className="h-full w-full object-contain p-1" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-black tracking-tight sm:text-xl">Player Feedback</p>
          <p className="truncate text-xs text-slate-400 sm:text-sm">Club operations and player feedback software</p>
        </div>
      </div>
      <div className="hidden items-center gap-2 rounded-full border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-2 text-xs font-semibold text-[#d8ff2f] sm:flex">
        Built for football clubs
      </div>
      <InstallAppButton
        wrapperClassName="lg:hidden"
        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d8ff2f]/30 bg-[#d8ff2f] px-4 py-3 text-sm font-black text-black"
      />
    </header>
  )
}
