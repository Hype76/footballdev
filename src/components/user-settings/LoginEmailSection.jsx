import { SectionCard } from '../ui/SectionCard.jsx'

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
          <span className="mb-2 block text-sm font-semibold text-slate-950">New login email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            disabled={isDemoSettings}
            title={isDemoSettings ? 'Demo accounts cannot change login email.' : undefined}
            required
            autoComplete="email"
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
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
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSavingEmail ? 'Requesting...' : 'Update login email'}
        </button>
      </form>
    </SectionCard>
  )
}
