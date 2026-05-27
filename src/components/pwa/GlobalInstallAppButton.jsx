import InstallAppButton from './InstallAppButton.jsx'

export default function GlobalInstallAppButton() {
  return (
    <InstallAppButton
      wrapperClassName="fixed bottom-4 right-4 z-[9999] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 lg:hidden"
      className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#047857] bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-lg shadow-[#047857]/15 transition hover:bg-[#065f46]"
      helpClassName="max-w-xs rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-xs font-black leading-5 text-[#4b5f55] shadow-lg shadow-[#047857]/10"
    />
  )
}
