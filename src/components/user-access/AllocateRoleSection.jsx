import { SectionCard } from '../ui/SectionCard.jsx'

export function AllocateRoleSection({
  assignableRoles,
  canAddMoreUsers,
  formState,
  isLoading,
  isSaving,
  onChange,
  onSubmit,
  staffLimitMessage,
}) {
  return (
    <SectionCard
      title="Allocate role"
      tourId="allocate-role-section"
      description={
        canAddMoreUsers
            ? 'Admins and managers can email role invites at their level or below. Custom roles are saved to this club.'
          : staffLimitMessage
      }
    >
      {isLoading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
          Loading roles...
        </div>
      ) : assignableRoles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          No role data entered yet, or role data could not be loaded.
        </div>
      ) : (
        <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email</span>
            <input
              type="email"
              name="email"
              value={formState.email}
              onChange={onChange}
              required
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Role</span>
            <select
              name="roleKey"
              value={formState.roleKey}
              onChange={onChange}
              required
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              {assignableRoles.map((role) => (
                <option key={role.roleKey} value={role.roleKey}>
                  {role.roleLabel}
                </option>
              ))}
              <option value="__custom__">Other</option>
            </select>
          </label>

          {formState.roleKey === '__custom__' ? (
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Custom role</span>
              <input
                type="text"
                name="customRoleLabel"
                value={formState.customRoleLabel}
                onChange={onChange}
                required={formState.roleKey === '__custom__'}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                Custom roles are saved at the support level and can be reused later.
              </p>
            </label>
          ) : null}

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={isSaving || !canAddMoreUsers}
              title={
                isSaving
                  ? 'Please wait while this user access is being saved.'
                  : canAddMoreUsers ? undefined : staffLimitMessage
              }
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? 'Sending...' : 'Send Role Invite'}
            </button>
          </div>
        </form>
      )}
    </SectionCard>
  )
}
