import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#0f172a]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#dbeafe] disabled:cursor-not-allowed disabled:opacity-60'

export function LoginEmailSection({
  email,
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
        <button
          type="submit"
          disabled={isSavingEmail || isDemoSettings}
          title={
            isSavingEmail
              ? 'Please wait while your login email request is being sent.'
              : isDemoSettings
                ? 'Demo accounts cannot change login email.'
                : undefined
          }
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#2563eb] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSavingEmail ? 'Requesting...' : 'Update login email'}
        </button>
      </form>
    </SectionCard>
  )
}
