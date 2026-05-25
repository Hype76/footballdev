import { SectionCard } from '../ui/SectionCard.jsx'

export function PasswordSettingsSection({
  isDemoSettings,
  isSavingPassword,
  isSendingReset,
  onPasswordDataChange,
  onResetPassword,
  onShowPasswordChange,
  onSubmit,
  passwordData,
  showPassword,
}) {
  return (
    <SectionCard
      title="Password"
      description="Change your password while signed in, or send yourself a reset email."
      tourId="password-settings"
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-950">New password</span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={passwordData.password}
              onChange={(event) => onPasswordDataChange('password', event.target.value)}
              disabled={isDemoSettings}
              title={isDemoSettings ? 'Demo accounts cannot change password.' : undefined}
              minLength={8}
              autoComplete="new-password"
              className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-950">Confirm password</span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={passwordData.confirmPassword}
              onChange={(event) => onPasswordDataChange('confirmPassword', event.target.value)}
              disabled={isDemoSettings}
              title={isDemoSettings ? 'Demo accounts cannot change password.' : undefined}
              minLength={8}
              autoComplete="new-password"
              className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
        </div>

        <label className="inline-flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-950">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(event) => onShowPasswordChange(event.target.checked)}
            disabled={isDemoSettings}
            title={isDemoSettings ? 'Demo accounts cannot change password.' : undefined}
            className="h-4 w-4 rounded border-slate-200"
          />
          <span>Show password</span>
        </label>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            type="submit"
            disabled={isSavingPassword || isDemoSettings || !passwordData.password || !passwordData.confirmPassword}
            title={
              isSavingPassword
                ? 'Please wait while your password is being updated.'
                : isDemoSettings
                  ? 'Demo accounts cannot change password.'
                  : !passwordData.password || !passwordData.confirmPassword
                    ? 'Enter and confirm your new password before saving.'
                    : undefined
            }
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingPassword ? 'Updating...' : 'Update password'}
          </button>

          <button
            type="button"
            onClick={onResetPassword}
            disabled={isSendingReset || isDemoSettings}
            title={
              isSendingReset
                ? 'Please wait while the reset email is being sent.'
                : isDemoSettings
                  ? 'Demo accounts cannot reset password.'
                  : undefined
            }
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSendingReset ? 'Sending...' : 'Send reset email'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}
