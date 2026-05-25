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
      title="Send staff access"
      tourId="allocate-role-section"
      description={
        canAddMoreUsers
          ? 'Invite one staff member at a time and choose the role they need for club work.'
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
        <form className="rounded-lg border border-slate-200 bg-white p-5" onSubmit={onSubmit}>
          <div className="mb-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Invite details</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              Use a real staff email. Access should match the work they are expected to do this week.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
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
          </div>

          <div className="mt-5">
            <button
              type="submit"
              disabled={isSaving || !canAddMoreUsers}
              title={
                isSaving
                  ? 'Please wait while this user access is being saved.'
                  : canAddMoreUsers ? undefined : staffLimitMessage
              }
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? 'Sending...' : 'Send role invite'}
            </button>
          </div>
        </form>
      )}
    </SectionCard>
  )
}
