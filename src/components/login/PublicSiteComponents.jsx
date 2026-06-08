export const publicPageClass = 'min-h-screen bg-[#06110a] pb-[max(5.5rem,env(safe-area-inset-bottom))] text-white lg:pb-0'
export const publicSectionClass = 'mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8'
export const publicEyebrowClass = 'text-xs font-black uppercase tracking-[0.2em] text-[#c6ff1a]'
export const publicHeadingClass = 'text-4xl font-black leading-[1.04] tracking-tight text-white sm:text-5xl'
export const publicSubheadingClass = 'text-base font-semibold leading-7 text-white/72 sm:text-lg sm:leading-8'
export const publicCardClass = 'rounded-lg border border-white/10 bg-white/[0.055] p-5 shadow-sm shadow-black/20'
export const publicPrimaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#c6ff1a] px-5 py-3 text-sm font-black text-[#06110a] shadow-sm shadow-[#c6ff1a]/20 transition hover:bg-[#dbff66]'
export const publicSecondaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg border border-white/16 bg-white/[0.06] px-5 py-3 text-sm font-black text-white transition hover:bg-white/[0.12]'

export function PublicScreenshot({ alt, image }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/12 bg-[#102016] shadow-2xl shadow-black/35">
      <img src={image} alt={alt} className="w-full" />
    </div>
  )
}

export function PublicFeatureCard({ copy, title }) {
  return (
    <article className={publicCardClass}>
      <span className="mb-4 block h-1.5 w-8 rounded-full bg-[#c6ff1a]" />
      <h2 className="text-lg font-black tracking-tight text-white">{title}</h2>
      <p className="mt-3 text-sm font-semibold leading-6 text-white/68">{copy}</p>
    </article>
  )
}

export function PublicFinalCta({ copy, primaryLabel = 'Start free', secondaryLabel = 'Contact us', title }) {
  const openContactModal = () => {
    window.dispatchEvent(new CustomEvent('football-player:open-contact'))
  }

  return (
    <section className="mx-auto max-w-7xl px-4 pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
      <div className="grid gap-6 rounded-lg border border-[#c6ff1a]/22 bg-[#0b1a10] p-6 shadow-2xl shadow-black/25 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h2>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-white/70">{copy}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <a href="/sign-in" className={publicPrimaryButtonClass}>{primaryLabel}</a>
          <button type="button" onClick={openContactModal} className={publicSecondaryButtonClass}>{secondaryLabel}</button>
        </div>
      </div>
    </section>
  )
}
