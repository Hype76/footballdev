export function CreateStaffLoginSection({
  assignableRoles,
  canCreateMoreStaff,
  coachForm,
  isSaving,
  onCoachFormChange,
  onCreateCoach,
  staffLimitMessage,
  teams,
}) {
  const labelClass = 'mb-2 block text-sm font-black text-[#0f172a]'
  const fieldClass = 'min-h-12 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#dbeafe]'

  return (
    <section className="overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10" data-tour-id="create-staff-section">
      <div className="border-b border-[#cbd5e1] bg-[#f8fafc] px-5 py-5 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Step 2: Scoped access</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[#0f172a]">Invite staff with team access</h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#475569]">
          {canCreateMoreStaff
            ? 'Send a staff invite, choose the role, and attach the login to one team. Coaches should only see the squads they work with.'
            : staffLimitMessage}
        </p>
      </div>

      <form className="space-y-4 px-5 py-5 sm:px-6" onSubmit={onCreateCoach}>
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="block">
            <span className={labelClass}>Staff email</span>
            <input
              type="email"
              name="email"
              value={coachForm.email}
              onChange={onCoachFormChange}
              required
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Role</span>
            <select
              name="roleKey"
              value={coachForm.roleKey}
              onChange={onCoachFormChange}
              required
              className={fieldClass}
            >
              {assignableRoles.map((role) => (
                <option key={role.roleKey} value={role.roleKey}>
                  {role.roleLabel}
                </option>
              ))}
              <option value="__custom__">Other</option>
            </select>
          </label>

          <label className="block">
            <span className={labelClass}>Team access</span>
            <select
              name="teamId"
              value={coachForm.teamId}
              onChange={onCoachFormChange}
              required
              className={fieldClass}
            >
              <option value="">Select team access</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {coachForm.roleKey === '__custom__' ? (
          <label className="block max-w-xl">
            <span className={labelClass}>Custom role</span>
            <input
              type="text"
              name="customRoleLabel"
              value={coachForm.customRoleLabel}
              onChange={onCoachFormChange}
              required
              className={fieldClass}
            />
          </label>
        ) : null}

        <button
          type="submit"
          disabled={isSaving || assignableRoles.length === 0 || !canCreateMoreStaff}
          title={
            isSaving
              ? 'Please wait while staff access is being saved.'
              : assignableRoles.length === 0
                ? 'Create an assignable staff role before adding staff access.'
                : canCreateMoreStaff ? undefined : staffLimitMessage
          }
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[#cbd5e1] bg-white px-5 py-3 text-sm font-black text-[#0f172a] shadow-sm shadow-[#2563eb]/10 transition hover:border-[#2563eb] hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          Send staff invite
        </button>
      </form>
    </section>
  )
}
