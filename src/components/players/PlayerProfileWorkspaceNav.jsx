import { playerProfilePanels, playerProfileSections } from '../../lib/player-profile-workspace.js'

export function PlayerProfileWorkspaceNav({ activePanel, activeSection, onPanelChange, onSectionChange }) {
  const panels = playerProfilePanels[activeSection] || []

  return (
    <div className="space-y-3">
      <nav aria-label="Player profile sections" className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-2 shadow-sm shadow-black/10">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {playerProfileSections.map((section) => {
            const isActive = section.key === activeSection
            return (
              <button
                key={section.key}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSectionChange(section.key)}
                className={`min-h-16 rounded-lg border px-3 py-3 text-left transition ${
                  isActive
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                    : 'border-[var(--border-color)] bg-[var(--panel-alt)] text-[var(--text-muted)] hover:border-[var(--accent)]'
                }`}
              >
                <span className="block text-sm font-black">{section.label}</span>
                <span className="mt-1 hidden text-xs font-semibold leading-5 sm:block">{section.description}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {panels.length > 0 ? (
        <nav aria-label={`${playerProfileSections.find((section) => section.key === activeSection)?.label || 'Player profile'} views`} className="flex flex-wrap gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-2">
          {panels.map((panel) => {
            const isActive = panel.key === activePanel
            return (
              <button
                key={panel.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => onPanelChange(panel.key)}
                className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-black transition ${
                  isActive
                    ? 'border-[var(--accent)] bg-[var(--panel-bg)] text-[var(--text-primary)] shadow-sm'
                    : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-color)] hover:bg-[var(--panel-bg)]'
                }`}
              >
                {panel.label}
              </button>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}
