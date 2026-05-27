import { SectionCard } from '../ui/SectionCard.jsx'

export function PlatformPlanMixSection({ planBreakdown, platformTotals }) {
  return (
    <SectionCard
      title="Plan mix"
      description="How active club workspaces are currently distributed."
    >
      <div className="space-y-3">
        {Object.entries(planBreakdown).length > 0 ? (
          Object.entries(planBreakdown).map(([planName, count]) => (
            <div key={planName} className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-black text-[#101828]">{planName}</p>
                <p className="text-lg font-black text-[#047857]">{count}</p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-lg bg-[#e0f3e8]">
                <div
                  className="h-full rounded-lg bg-[#047857] transition-all duration-700"
                  style={{
                    width: `${Math.max(8, Math.round((count / Math.max(1, platformTotals.clubs ?? 1)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
            No plan data is available yet.
          </p>
        )}
      </div>
    </SectionCard>
  )
}

export function PlatformDataHygieneSection({ platformTotals }) {
  return (
    <SectionCard
      title="Data hygiene"
      description="Separated live records from archived and internal platform records."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Active players</p>
          <p className="mt-2 text-3xl font-black text-[#101828]">{platformTotals.players ?? 0}</p>
          <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{platformTotals.archivedPlayers ?? 0} archived records excluded</p>
        </div>
        <div className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Share rows</p>
          <p className="mt-2 text-3xl font-black text-[#101828]">{platformTotals.communications ?? 0}</p>
          <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{platformTotals.communicationRows ?? 0} total communication rows</p>
        </div>
      </div>
    </SectionCard>
  )
}
