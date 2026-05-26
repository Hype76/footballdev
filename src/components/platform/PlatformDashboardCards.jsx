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
            <div key={planName} className="rounded-lg border border-[#bddcca] bg-white p-4 shadow-sm shadow-[#067a46]/10">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-black text-[#10231a]">{planName}</p>
                <p className="text-lg font-black text-[#067a46]">{count}</p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e0f3e8]">
                <div
                  className="h-full rounded-full bg-[#067a46] transition-all duration-700"
                  style={{
                    width: `${Math.max(8, Math.round((count / Math.max(1, platformTotals.clubs ?? 1)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-4 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10">
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
        <div className="rounded-lg border border-[#bddcca] bg-white p-4 shadow-sm shadow-[#067a46]/10">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#456653]">Active players</p>
          <p className="mt-2 text-3xl font-black text-[#10231a]">{platformTotals.players ?? 0}</p>
          <p className="mt-1 text-sm font-semibold text-[#456653]">{platformTotals.archivedPlayers ?? 0} archived records excluded</p>
        </div>
        <div className="rounded-lg border border-[#bddcca] bg-white p-4 shadow-sm shadow-[#067a46]/10">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#456653]">Share rows</p>
          <p className="mt-2 text-3xl font-black text-[#10231a]">{platformTotals.communications ?? 0}</p>
          <p className="mt-1 text-sm font-semibold text-[#456653]">{platformTotals.communicationRows ?? 0} total communication rows</p>
        </div>
      </div>
    </SectionCard>
  )
}
