import InstallAppButton from './InstallAppButton.jsx'

export default function GlobalInstallAppButton() {
  return (
    <InstallAppButton
      wrapperClassName="fixed bottom-4 right-4 z-[9999] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 lg:hidden"
      className="inline-flex min-h-12 items-center justify-center rounded-lg border border-sky-600 bg-sky-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-950/10 transition hover:bg-sky-700"
      helpClassName="max-w-xs rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs font-black leading-5 text-slate-600 shadow-lg shadow-slate-950/10"
    />
  )
}
