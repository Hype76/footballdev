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
      description="Invited emails receive the saved role when they sign in. Remove stale invites before sending new ones."
    >
      {isLoading ? (
        <div className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] px-4 py-4 text-sm font-semibold text-[#5f7468]">
          Loading pending allocations...
        </div>
      ) : pendingInvites.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#bddcca] bg-[#f8fdf9] px-4 py-6 text-sm font-semibold text-[#5f7468]">
          No pending allocations.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedInvites.items.map((invite) => (
            <div
              key={invite.id}
              className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] px-4 py-4 shadow-sm shadow-[#d7eadf]/60"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="break-words text-sm font-black text-[#10231a]">{invite.email}</p>
                  <p className="mt-1 text-sm font-semibold text-[#067a46]">{invite.roleLabel}</p>
                </div>
                <button
                  type="button"
                  disabled={isSaving}
                  title={isSaving ? 'Please wait while this allocation is being removed.' : undefined}
                  onClick={() => onDeleteInvite(invite)}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-black text-[#10231a] transition hover:bg-[#f8fdf9] disabled:cursor-not-allowed disabled:opacity-60"
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
