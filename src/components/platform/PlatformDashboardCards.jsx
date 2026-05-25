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
            <div key={planName} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/80">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-bold text-slate-950">{planName}</p>
                <p className="text-lg font-black text-emerald-700">{count}</p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-emerald-700 transition-all duration-700"
                  style={{
                    width: `${Math.max(8, Math.round((count / Math.max(1, platformTotals.clubs ?? 1)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
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
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/80">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Active players</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{platformTotals.players ?? 0}</p>
          <p className="mt-1 text-sm text-slate-600">{platformTotals.archivedPlayers ?? 0} archived records excluded</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/80">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Share rows</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{platformTotals.communications ?? 0}</p>
          <p className="mt-1 text-sm text-slate-600">{platformTotals.communicationRows ?? 0} total communication rows</p>
        </div>
      </div>
    </SectionCard>
  )
}
