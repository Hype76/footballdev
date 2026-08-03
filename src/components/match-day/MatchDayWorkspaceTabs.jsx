import { MATCH_DAY_WORKSPACE_SECTIONS } from '../../lib/matchday-workspace.js'

export function MatchDayWorkspaceTabs({ activeSection, onChange }) {
  return (
    <div className="border-b border-[var(--border-color)] bg-[var(--panel-alt)] px-3 pt-3 sm:px-5" data-testid="game-day-workspace-tabs">
      <div className="flex gap-2 overflow-x-auto pb-3" role="tablist" aria-label="Selected fixture sections">
        {MATCH_DAY_WORKSPACE_SECTIONS.map((section) => {
          const isActive = activeSection === section.id

          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`game-day-workspace-${section.id}`}
              onClick={() => onChange(section.id)}
              className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border px-3 py-2 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:text-sm ${
                isActive
                  ? 'border-[var(--button-primary)] bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                  : 'border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]'
              }`}
            >
              {section.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
