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
  showEmailIdentity = true,
  user,
  username,
  workspaceLabel,
}) {
  return (
    <SectionCard
      title="Account profile"
      description="This is how your name appears inside development records and the workspace."
      tourId="account-profile-settings"
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Username</span>
          <input
            type="text"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            required
            autoComplete="nickname"
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </label>

        {!showEmailIdentity ? (
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-950">Display Name</span>
            <input
              type="text"
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              required
              autoComplete="name"
              className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
        ) : null}

        {showEmailIdentity ? (
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-950">Parent email identity</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Emails will be sent from feedback@footballplayer.online. Parent replies will go to your reply-to email.
            </p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-950">Display Name</span>
              <input
                type="text"
                value={displayName}
                onChange={(event) => onDisplayNameChange(event.target.value)}
                required
                autoComplete="name"
                className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-950">Team Name</span>
              <input
                type="text"
                value={emailTeamName}
                onChange={(event) => onEmailTeamNameChange(event.target.value)}
                required
                placeholder="U12"
                className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-950">Club Name</span>
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
                className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
              {!canEditEmailClubName ? (
                <span className="mt-2 block text-xs leading-5 text-slate-600">
                  Only the top role for this plan can change the club name used in sender details.
                </span>
              ) : null}
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-950">Reply-to Email</span>
              <input
                type="email"
                value={replyToEmail}
                onChange={(event) => onReplyToEmailChange(event.target.value)}
                required
                autoComplete="email"
                placeholder="coach@club.com"
                className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </label>
          </div>

          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Sender preview</p>
            <p className="mt-2 break-words text-sm font-medium text-slate-950">
              {senderPreview} &lt;feedback@footballplayer.online&gt;
            </p>
          </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Email</p>
            <p className="mt-2 break-words text-sm font-medium text-slate-950">
              {user?.email || authUser?.email || 'No email found'}
            </p>
          </div>

          <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Role</p>
            <p className="mt-2 text-sm font-medium text-slate-950">{getRoleLabel(user)}</p>
          </div>
        </div>

        <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Workspace</p>
          <p className="mt-2 text-sm font-medium text-slate-950">
            {workspaceLabel || (user?.role === 'super_admin' ? 'Platform' : user?.clubName || 'No club assigned')}
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
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSavingProfile ? 'Saving...' : 'Save account'}
        </button>
      </form>
    </SectionCard>
  )
}
