import { StatusPill } from '../ui/StatusPill.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function PlatformAdminStaffSection({
  form,
  isSaving,
  onChange,
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
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Name</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => onChange('name', event.target.value)}
              placeholder="Staff member name"
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => onChange('email', event.target.value)}
              required
              placeholder="admin@example.com"
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Temporary password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => onChange('password', event.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
          </label>
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? 'Saving...' : 'Add Platform Admin'}
          </button>
          <p className="text-sm leading-6 text-[var(--text-muted)]">
            This creates or promotes the account to platform admin access on this environment.
          </p>
        </form>

        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Current platform admins</p>
          <div className="mt-3 space-y-2">
            {platformAdmins.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
                No platform admins found.
              </p>
            ) : (
              platformAdmins.map((admin) => (
                <div key={admin.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-[var(--text-primary)]">
                        {admin.name || 'No name entered'}
                      </p>
                      <p className="mt-1 break-words text-sm text-[var(--text-muted)]">{admin.email}</p>
                    </div>
                    <StatusPill status={admin.status} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
