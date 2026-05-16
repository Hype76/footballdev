import { getRoleLabel } from '../../lib/auth.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function AccountProfileSection({
  authUser,
  canEditEmailClubName,
  displayName,
  emailClubName,
  emailTeamName,
  isDemoSettings,
  isSavingProfile,
  onDisplayNameChange,
  onEmailClubNameChange,
  onEmailTeamNameChange,
  onReplyToEmailChange,
  onSubmit,
  onUsernameChange,
  replyToEmail,
  senderPreview,
  user,
  username,
}) {
  return (
    <SectionCard
      title="Account profile"
      description="This is how your name appears inside assessments and the workspace."
      tourId="account-profile-settings"
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Username</span>
          <input
            type="text"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            required
            autoComplete="nickname"
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>

        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Parent email identity</p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
            Emails will be sent from feedback@playerfeedback.online. Parent replies will go to your reply-to email.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Display Name</span>
              <input
                type="text"
                value={displayName}
                onChange={(event) => onDisplayNameChange(event.target.value)}
                required
                autoComplete="name"
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team Name</span>
              <input
                type="text"
                value={emailTeamName}
                onChange={(event) => onEmailTeamNameChange(event.target.value)}
                required
                placeholder="U12"
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Club Name</span>
              <input
                type="text"
                value={emailClubName}
                onChange={(event) => {
                  if (canEditEmailClubName) {
                    onEmailClubNameChange(event.target.value)
                  }
                }}
                required
                disabled={!canEditEmailClubName}
                placeholder="Cambourne FC"
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              />
              {!canEditEmailClubName ? (
                <span className="mt-2 block text-xs leading-5 text-[var(--text-muted)]">
                  Only the top role for this plan can change the club name used in sender details.
                </span>
              ) : null}
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Reply-to Email</span>
              <input
                type="email"
                value={replyToEmail}
                onChange={(event) => onReplyToEmailChange(event.target.value)}
                required
                autoComplete="email"
                placeholder="coach@club.com"
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
          </div>

          <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Sender preview</p>
            <p className="mt-2 break-words text-sm font-medium text-[var(--text-primary)]">
              {senderPreview} &lt;feedback@playerfeedback.online&gt;
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Email</p>
            <p className="mt-2 break-words text-sm font-medium text-[var(--text-primary)]">
              {user?.email || authUser?.email || 'No email found'}
            </p>
          </div>

          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Role</p>
            <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{getRoleLabel(user)}</p>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Workspace</p>
          <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
            {user?.role === 'super_admin' ? 'Platform' : user?.clubName || 'No club assigned'}
          </p>
        </div>

        <button
          type="submit"
          disabled={isSavingProfile || isDemoSettings}
          title={
            isSavingProfile
              ? 'Please wait while your account is being saved.'
              : isDemoSettings
                ? 'Demo accounts cannot change account details.'
                : undefined
          }
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSavingProfile ? 'Saving...' : 'Save account'}
        </button>
      </form>
    </SectionCard>
  )
}
