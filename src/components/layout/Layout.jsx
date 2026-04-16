import { useState } from 'react'
import { Outlet, useMatches } from 'react-router-dom'
import { Sidebar } from './Sidebar.jsx'
import { Topbar } from './Topbar.jsx'

export function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const matches = useMatches()
  const activeTitle = [...matches].reverse().find((match) => match.handle?.title)?.handle?.title ?? 'Dashboard'

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f5f7f3] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px]">
        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-72">
          <Topbar title={activeTitle} onMenuClick={() => setIsSidebarOpen(true)} />

          <main className="flex-1 px-3 py-4 sm:px-4 sm:py-5 md:px-6 md:py-6 xl:px-8">
            <div className="mx-auto w-full max-w-7xl">
              <div className="overflow-hidden rounded-[24px] border border-[#dbe3d6] bg-[#fbfcf9] p-3 shadow-sm shadow-slate-200/40 sm:rounded-[28px] sm:p-5 md:p-6">
                <Outlet />
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
