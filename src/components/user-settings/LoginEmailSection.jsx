import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5] disabled:cursor-not-allowed disabled:opacity-60'

export function LoginEmailSection({
  currentEmail,
  email,
  isEmailUnchanged,
  isDemoSettings,
  isSavingEmail,
  onEmailChange,
  onSubmit,
}) {
  return (
    <SectionCard
      title="Login email"
      description="Change the email address used for signing in."
      tourId="login-email-settings"
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className={labelClass}>New login email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            disabled={isDemoSettings}
            title={isDemoSettings ? 'Demo accounts cannot change login email.' : undefined}
            required
            autoComplete="email"
            className={inputClass}
          />
        </label>
        {isEmailUnchanged && !isDemoSettings ? (
          <p className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm font-black text-[#92400e]">
            No change made. Enter a different login email.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={isSavingEmail || isDemoSettings || isEmailUnchanged}
          title={
            isSavingEmail
              ? 'Please wait while your login email request is being sent.'
              : isDemoSettings
                ? 'Demo accounts cannot change login email.'
                : isEmailUnchanged
                  ? `Current login email is ${currentEmail}. Enter a different email to update it.`
                  : undefined
          }
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSavingEmail ? 'Requesting...' : 'Update login email'}
        </button>
      </form>
    </SectionCard>
  )
}
