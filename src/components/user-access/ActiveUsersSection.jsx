import { canRemoveClubUser, canUpdateClubUserName } from '../../lib/supabase.js'
import { getRoleLabel } from '../../lib/auth.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

const bodyTextClass = 'text-sm font-semibold text-[#456653]'
const panelClass = 'rounded-lg border border-[#bddcca] bg-[#f6fbf8] shadow-sm shadow-[#067a46]/10'
const fieldClass = 'min-h-11 w-full rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-bold text-[#10231a] outline-none transition focus:border-[#067a46] focus:ring-2 focus:ring-[#d7f8e5]'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10 transition hover:border-[#20a464] hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60'

export function ActiveUsersSection({
  isLoading,
  isSaving,
  memberPage,
  members,
  nameDrafts,
  onMemberPageChange,
  onNameDraftChange,
  onRemoveMember,
  onUpdateMemberName,
  pageSize,
  paginatedMembers,
  user,
}) {
  return (
    <SectionCard
      title="Active users"
      tourId="active-users-section"
      description="Review who already has workspace access and keep display names readable for staff records."
    >
      {isLoading ? (
        <div className={`${panelClass} px-4 py-4 text-sm font-semibold text-[#456653]`}>
          Loading active users...
        </div>
      ) : members.length === 0 ? (
        <div className={`${panelClass} px-4 py-6 text-sm font-semibold text-[#456653]`}>
          No active users found for this club.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedMembers.items.map((member) => (
            <div
              key={member.id}
              className={`${panelClass} px-4 py-4`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="break-words text-sm font-black text-[#10231a]">{member.email}</p>
                  <p className={`mt-1 ${bodyTextClass}`}>{member.name || 'No display name yet'}</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="rounded-lg border border-[#b7efce] bg-[#ecfdf3] px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">
                    {getRoleLabel(member)}
                  </div>
                  {canRemoveClubUser(user, member) ? (
                    <button
                      type="button"
                      disabled={isSaving}
                      title={isSaving ? 'Please wait while user access is being updated.' : undefined}
                      onClick={() => onRemoveMember(member)}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#f2b8b5] bg-[#fff4f3] px-4 py-3 text-sm font-black text-[#9b1c17] transition hover:bg-[#ffe7e5] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
              {canUpdateClubUserName(user, member) ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <label className="block">
                    <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-[#456653]">
                      Display name
                    </span>
                    <input
                      type="text"
                      value={nameDrafts[member.id] ?? ''}
                      onChange={(event) => onNameDraftChange(member.id, event.target.value)}
                      className={fieldClass}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={isSaving || String(nameDrafts[member.id] ?? '').trim() === String(member.name ?? '').trim()}
                    title={
                      isSaving
                        ? 'Please wait while user access is being updated.'
                        : String(nameDrafts[member.id] ?? '').trim() === String(member.name ?? '').trim()
                          ? 'Change the display name before saving.'
                          : undefined
                    }
                    onClick={() => onUpdateMemberName(member)}
                    className={secondaryButtonClass}
                  >
                    Save name
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          <Pagination
            currentPage={memberPage}
            onPageChange={onMemberPageChange}
            pageSize={pageSize}
            totalItems={members.length}
          />
        </div>
      )}
    </SectionCard>
  )
}
