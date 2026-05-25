import { canRemoveClubUser, canUpdateClubUserName } from '../../lib/supabase.js'
import { getRoleLabel } from '../../lib/auth.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

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
  const buttonClass =
    'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <SectionCard
      title="Active users"
      tourId="active-users-section"
      description="Review who already has workspace access and keep display names readable for staff records."
    >
      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          Loading active users...
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          No active users found for this club.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedMembers.items.map((member) => (
            <div
              key={member.id}
              className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="break-words text-sm font-semibold text-slate-950">{member.email}</p>
                  <p className="mt-1 text-sm text-slate-600">{member.name || 'No display name yet'}</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                    {getRoleLabel(member)}
                  </div>
                  {canRemoveClubUser(user, member) ? (
                    <button
                      type="button"
                      disabled={isSaving}
                      title={isSaving ? 'Please wait while user access is being updated.' : undefined}
                      onClick={() => onRemoveMember(member)}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
              {canUpdateClubUserName(user, member) ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <label className="block">
                    <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                      Display name
                    </span>
                    <input
                      type="text"
                      value={nameDrafts[member.id] ?? ''}
                      onChange={(event) => onNameDraftChange(member.id, event.target.value)}
                      className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
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
                    className={buttonClass}
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
