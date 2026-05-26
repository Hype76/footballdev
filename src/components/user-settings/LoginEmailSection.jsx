import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#10231a]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5] disabled:cursor-not-allowed disabled:opacity-60'

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
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSavingEmail ? 'Requesting...' : 'Update login email'}
        </button>
      </form>
    </SectionCard>
  )
}
