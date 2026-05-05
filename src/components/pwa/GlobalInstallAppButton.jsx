import InstallAppButton from './InstallAppButton.jsx'

export default function GlobalInstallAppButton() {
  return (
    <InstallAppButton
      wrapperClassName="fixed bottom-4 right-4 z-[9999] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 lg:hidden"
      className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-lime-300/50 bg-lime-300 px-5 py-3 text-sm font-black text-black shadow-2xl shadow-lime-300/20 transition hover:bg-lime-200"
      helpClassName="max-w-xs rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-xs font-semibold leading-5 text-[var(--text-primary)] shadow-2xl shadow-black/30"
    />
  )
}
