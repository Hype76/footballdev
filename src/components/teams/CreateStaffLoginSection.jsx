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
  return (
    <section className="border border-slate-200 bg-white p-5 sm:p-6" data-tour-id="create-staff-section">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Step 2</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Invite staff with team access</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          {canCreateMoreStaff
            ? 'Send a staff invite, choose the role, and attach the login to one team. Staff should only see the teams they work with.'
            : staffLimitMessage}
        </p>
      </div>

      <form className="mt-5 space-y-4" onSubmit={onCreateCoach}>
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="block">
            <span className="mb-2 block text-sm font-black text-slate-950">Staff email</span>
            <input
              type="email"
              name="email"
              value={coachForm.email}
              onChange={onCoachFormChange}
              required
              className="min-h-12 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-black text-slate-950">Role</span>
            <select
              name="roleKey"
              value={coachForm.roleKey}
              onChange={onCoachFormChange}
              required
              className="min-h-12 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
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
            <span className="mb-2 block text-sm font-black text-slate-950">Team access</span>
            <select
              name="teamId"
              value={coachForm.teamId}
              onChange={onCoachFormChange}
              required
              className="min-h-12 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
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
            <span className="mb-2 block text-sm font-black text-slate-950">Custom role</span>
            <input
              type="text"
              name="customRoleLabel"
              value={coachForm.customRoleLabel}
              onChange={onCoachFormChange}
              required
              className="min-h-12 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
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
          className="inline-flex min-h-12 w-full items-center justify-center border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          Send staff invite
        </button>
      </form>
    </section>
  )
}
