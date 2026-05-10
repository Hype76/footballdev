import { SectionCard } from '../ui/SectionCard.jsx'

export function CreateStaffLoginSection({
  assignableRoles,
  canCreateMoreStaff,
  coachForm,
  isCoachPasswordVisible,
  isSaving,
  onCoachFormChange,
  onCreateCoach,
  onTogglePasswordVisibility,
  staffLimitMessage,
  teams,
}) {
  return (
    <SectionCard
      title="Create staff login"
      description={
        canCreateMoreStaff
          ? 'Create a staff login, choose the role, and give that login access to a team.'
          : staffLimitMessage
      }
    >
      <form className="space-y-3" onSubmit={onCreateCoach}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Staff email</span>
            <input
              type="email"
              name="email"
              value={coachForm.email}
              onChange={onCoachFormChange}
              required
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Initial password</span>
            <div className="flex rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] focus-within:border-[var(--accent)]">
              <input
                type={isCoachPasswordVisible ? 'text' : 'password'}
                name="password"
                value={coachForm.password}
                onChange={onCoachFormChange}
                required
                minLength={8}
                autoComplete="new-password"
                className="min-h-11 min-w-0 flex-1 rounded-l-2xl bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <button
                type="button"
                onClick={onTogglePasswordVisibility}
                className="min-h-11 rounded-r-2xl px-4 py-3 text-sm font-semibold text-[var(--text-secondary)]"
              >
                {isCoachPasswordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Role</span>
            <select
              name="roleKey"
              value={coachForm.roleKey}
              onChange={onCoachFormChange}
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

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team access</span>
            <select
              name="teamId"
              value={coachForm.teamId}
              onChange={onCoachFormChange}
              required
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
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
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Custom role</span>
            <input
              type="text"
              name="customRoleLabel"
              value={coachForm.customRoleLabel}
              onChange={onCoachFormChange}
              required
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
        ) : null}

        <button
          type="submit"
          disabled={isSaving || assignableRoles.length === 0 || !canCreateMoreStaff}
          title={canCreateMoreStaff ? undefined : staffLimitMessage}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          Add Staff Access
        </button>
      </form>
    </SectionCard>
  )
}
