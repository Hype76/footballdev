import InstallAppButton from './InstallAppButton.jsx'

export default function GlobalInstallAppButton() {
  return (
    <InstallAppButton
      wrapperClassName="fixed bottom-4 right-4 z-[9999] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 lg:hidden"
      className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#067a46] bg-[#067a46] px-5 py-3 text-sm font-black text-white shadow-lg shadow-[#10231a]/10 transition hover:bg-[#05603a]"
      helpClassName="max-w-xs rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-xs font-black leading-5 text-[#456653] shadow-lg shadow-[#10231a]/10"
    />
  )
}
