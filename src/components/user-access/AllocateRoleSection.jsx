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
  const inputClass =
    'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100'

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
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          Loading roles...
        </div>
      ) : assignableRoles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          No role data entered yet, or role data could not be loaded.
        </div>
      ) : (
        <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-950">Email</span>
            <input
              type="email"
              name="email"
              value={formState.email}
              onChange={onChange}
              required
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-950">Role</span>
            <select
              name="roleKey"
              value={formState.roleKey}
              onChange={onChange}
              required
              className={inputClass}
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
              <span className="mb-2 block text-sm font-semibold text-slate-950">Custom role</span>
              <input
                type="text"
                name="customRoleLabel"
                value={formState.customRoleLabel}
                onChange={onChange}
                required={formState.roleKey === '__custom__'}
                className={inputClass}
              />
              <p className="mt-2 text-xs leading-5 text-slate-600">
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
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? 'Sending...' : 'Send Role Invite'}
            </button>
          </div>
        </form>
      )}
    </SectionCard>
  )
}
