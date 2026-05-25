import { StatusPill } from '../ui/StatusPill.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

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
            <span className="mb-2 block text-sm font-bold text-slate-950">Name</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => onChange('name', event.target.value)}
              placeholder="Staff member name"
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => onChange('email', event.target.value)}
              required
              placeholder="admin@example.com"
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Temporary password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => onChange('password', event.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white"
            />
          </label>
          <button
            type="submit"
            disabled={isSaving}
            title={isSaving ? 'Please wait while this platform admin is being saved.' : undefined}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? 'Saving...' : 'Add Platform Admin'}
          </button>
          <p className="text-sm leading-6 text-slate-600">
            This creates or promotes the account to platform admin access on this environment.
          </p>
        </form>

        <div>
          <p className="text-sm font-black text-slate-950">Current platform admins</p>
          <div className="mt-3 space-y-2">
            {platformAdmins.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                No platform admins found.
              </p>
            ) : (
              platformAdmins.map((admin) => {
                const isCurrentUser = String(admin.id) === String(currentUserId)

                  return (
                <div key={admin.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-200/80">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-black text-slate-950">
                        {admin.name || 'No name entered'}
                      </p>
                      <p className="mt-1 break-words text-sm text-slate-600">{admin.email}</p>
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
                        className="inline-flex min-h-9 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
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
