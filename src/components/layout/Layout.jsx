import { useEffect, useState } from 'react'
import { Outlet, useMatches } from 'react-router-dom'
import { Sidebar } from './Sidebar.jsx'
import { Topbar } from './Topbar.jsx'

export function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [theme, setTheme] = useState(() => window.localStorage.getItem('app-theme') || 'light')
  const matches = useMatches()
  const activeTitle = [...matches].reverse().find((match) => match.handle?.title)?.handle?.title ?? 'Dashboard'

  useEffect(() => {
    document.body.classList.remove('theme-light', 'theme-dark')
    document.body.classList.add(theme === 'dark' ? 'theme-dark' : 'theme-light')
    window.localStorage.setItem('app-theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--app-bg)] text-[var(--text-primary)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px]">
        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-72">
          <Topbar title={activeTitle} onMenuClick={() => setIsSidebarOpen(true)} theme={theme} onToggleTheme={toggleTheme} />

          <main className="flex-1 px-3 py-4 sm:px-4 sm:py-5 md:px-6 md:py-6 xl:px-8">
            <div className="mx-auto w-full max-w-7xl">
              <div className="overflow-hidden rounded-[24px] border border-[var(--border-color)] bg-[var(--shell-card)] p-3 shadow-sm shadow-slate-900/10 sm:rounded-[28px] sm:p-5 md:p-6">
                <Outlet />
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
