export function TestSiteBanner() {
  const isTestSite = String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'

  if (!isTestSite) {
    return null
  }

  return (
    <div className="sticky top-0 z-[1000] border-b border-[#7f1d1d] bg-[#b91c1c] px-3 py-1.5 text-center text-xs font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-black/25 sm:px-4 sm:py-2 sm:text-sm">
      Test Site Only. Not Live.
    </div>
  )
}
