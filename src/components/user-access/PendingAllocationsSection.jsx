import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] shadow-sm shadow-[#047857]/10'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'

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
        <div className={`${panelClass} px-4 py-4 text-sm font-semibold text-[#4b5f55]`}>
          Loading pending allocations...
        </div>
      ) : pendingInvites.length === 0 ? (
        <div className={`${panelClass} px-4 py-6 text-sm font-semibold text-[#4b5f55]`}>
          No pending allocations.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedInvites.items.map((invite) => (
            <div
              key={invite.id}
              className={`${panelClass} px-4 py-4`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="break-words text-sm font-black text-[#101828]">{invite.email}</p>
                  <p className="mt-1 text-sm font-semibold text-[#047857]">{invite.roleLabel}</p>
                </div>
                <button
                  type="button"
                  disabled={isSaving}
                  title={isSaving ? 'Please wait while this allocation is being removed.' : undefined}
                  onClick={() => onDeleteInvite(invite)}
                  className={secondaryButtonClass}
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
