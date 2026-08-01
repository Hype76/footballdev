import { MATCH_DAY_WORKSPACE_SECTIONS } from '../../lib/matchday-workspace.js'

export function MatchDayWorkspaceTabs({ activeSection, onChange }) {
  return (
    <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-3 pt-3 sm:px-5" data-testid="game-day-workspace-tabs">
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
              className={`inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border px-3 py-2 text-xs font-black transition sm:text-sm ${
                isActive
                  ? 'border-[#047857] bg-[#047857] text-white'
                  : 'border-[#d7e5dc] bg-white text-[#101828] hover:border-[#047857] hover:bg-[#ecfdf5]'
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
