import { StatusPill } from '../ui/StatusPill.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#10231a]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition placeholder:text-[#8da59a] focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const primaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-9 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-3 py-2 text-xs font-black text-[#b42318] transition hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-50'
const emptyStateClass = 'rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-5 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10'

export function PlatformAdminStaffSection({
  currentUserId,
  deletingAdminId,
  form,
  isSaving,
  onChange,
  onDelete,
  onSubmit,
  platformAdmins,
}) {
  return (
    <SectionCard
      title="Platform admin staff"
      description="Create owner level staff accounts for trusted platform operators."
    >
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <form className="grid gap-4" onSubmit={onSubmit}>
          <label className="block">
            <span className={labelClass}>Name</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => onChange('name', event.target.value)}
              placeholder="Staff member name"
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => onChange('email', event.target.value)}
              required
              placeholder="admin@example.com"
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Temporary password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => onChange('password', event.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              className={fieldClass}
            />
          </label>
          <button
            type="submit"
            disabled={isSaving}
            title={isSaving ? 'Please wait while this platform admin is being saved.' : undefined}
            className={primaryButtonClass}
          >
            {isSaving ? 'Saving...' : 'Add platform admin'}
          </button>
          <p className="text-sm font-semibold leading-6 text-[#456653]">
            This creates or promotes the account to platform admin access on this environment.
          </p>
        </form>

        <div>
          <p className="text-sm font-black text-[#10231a]">Current platform admins</p>
          <div className="mt-3 space-y-2">
            {platformAdmins.length === 0 ? (
              <p className={emptyStateClass}>
                No platform admins found.
              </p>
            ) : (
              platformAdmins.map((admin) => {
                const isCurrentUser = String(admin.id) === String(currentUserId)

                  return (
                <div key={admin.id} className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 shadow-sm shadow-[#067a46]/10">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-black text-[#10231a]">
                        {admin.name || 'No name entered'}
                      </p>
                      <p className="mt-1 break-words text-sm font-semibold text-[#456653]">{admin.email}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                      <StatusPill status={admin.status} />
                      <button
                        type="button"
                        disabled={isCurrentUser || deletingAdminId === admin.id}
                        title={
                          deletingAdminId === admin.id
                            ? 'Please wait while this platform admin is being deleted.'
                            : isCurrentUser
                              ? 'You cannot delete your own platform admin account.'
                              : 'Delete platform admin'
                        }
                        onClick={() => onDelete(admin)}
                        className={dangerButtonClass}
                      >
                        {deletingAdminId === admin.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
