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
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">New login email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            disabled={isDemoSettings}
            required
            autoComplete="email"
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <button
          type="submit"
          disabled={isSavingEmail || isDemoSettings}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSavingEmail ? 'Requesting...' : 'Update login email'}
        </button>
      </form>
    </SectionCard>
  )
}
