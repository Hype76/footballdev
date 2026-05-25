import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function PendingAllocationsSection({
  invitePage,
  isLoading,
  isSaving,
  onDeleteInvite,
  onInvitePageChange,
  pageSize,
  paginatedInvites,
  pendingInvites,
}) {
  return (
    <SectionCard
      title="Pending allocations"
      tourId="pending-allocations-section"
      description="Invited or pre-assigned emails will receive the saved role when they sign in."
    >
      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          Loading pending allocations...
        </div>
      ) : pendingInvites.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          No pending allocations.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedInvites.items.map((invite) => (
            <div
              key={invite.id}
              className="rounded-lg border border-slate-200 bg-white px-4 py-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="break-words text-sm font-semibold text-slate-950">{invite.email}</p>
                  <p className="mt-1 text-sm text-slate-600">{invite.roleLabel}</p>
                </div>
                <button
                  type="button"
                  disabled={isSaving}
                  title={isSaving ? 'Please wait while this allocation is being removed.' : undefined}
                  onClick={() => onDeleteInvite(invite)}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <Pagination
            currentPage={invitePage}
            onPageChange={onInvitePageChange}
            pageSize={pageSize}
            totalItems={pendingInvites.length}
          />
        </div>
      )}
    </SectionCard>
  )
}
