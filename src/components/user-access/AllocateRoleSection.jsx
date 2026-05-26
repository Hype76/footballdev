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
    'min-h-11 w-full rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-bold text-[#10231a] outline-none transition focus:border-[#067a46] focus:ring-2 focus:ring-[#d7f8e5]'
  const labelClass = 'mb-2 block text-sm font-black text-[#10231a]'
  const bodyTextClass = 'text-sm font-semibold leading-6 text-[#456653]'
  const panelClass = 'rounded-lg border border-[#bddcca] bg-[#f6fbf8] shadow-sm shadow-[#067a46]/10'

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
        <div className={`${panelClass} px-4 py-4 text-sm font-semibold text-[#456653]`}>
          Loading roles...
        </div>
      ) : assignableRoles.length === 0 ? (
        <div className={`${panelClass} px-4 py-6 text-sm font-semibold text-[#456653]`}>
          No role data entered yet, or role data could not be loaded.
        </div>
      ) : (
        <form className={`${panelClass} p-5`} onSubmit={onSubmit}>
          <div className="mb-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Invite details</p>
            <p className={`mt-2 ${bodyTextClass}`}>
              Use the staff member email they will actually sign in with. Access should match the work they are expected to do this week.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Email</span>
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
              <span className={labelClass}>Role</span>
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
                <span className={labelClass}>Custom role</span>
                <input
                  type="text"
                  name="customRoleLabel"
                  value={formState.customRoleLabel}
                  onChange={onChange}
                  required={formState.roleKey === '__custom__'}
                  className={inputClass}
                />
                <p className="mt-2 text-xs font-semibold leading-5 text-[#456653]">
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
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? 'Sending...' : 'Send role invite'}
            </button>
          </div>
        </form>
      )}
    </SectionCard>
  )
}
