import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#10231a]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-5 py-3 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10 transition hover:border-[#20a464] hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60'

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
            <span className={labelClass}>New password</span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={passwordData.password}
              onChange={(event) => onPasswordDataChange('password', event.target.value)}
              disabled={isDemoSettings}
              title={isDemoSettings ? 'Demo accounts cannot change password.' : undefined}
              minLength={8}
              autoComplete="new-password"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Confirm password</span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={passwordData.confirmPassword}
              onChange={(event) => onPasswordDataChange('confirmPassword', event.target.value)}
              disabled={isDemoSettings}
              title={isDemoSettings ? 'Demo accounts cannot change password.' : undefined}
              minLength={8}
              autoComplete="new-password"
              className={inputClass}
            />
          </label>
        </div>

        <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(event) => onShowPasswordChange(event.target.checked)}
            disabled={isDemoSettings}
            title={isDemoSettings ? 'Demo accounts cannot change password.' : undefined}
            className="h-4 w-4 rounded border-[#bddcca] accent-[#067a46]"
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
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60"
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
            className={secondaryButtonClass}
          >
            {isSendingReset ? 'Sending...' : 'Send reset email'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}
