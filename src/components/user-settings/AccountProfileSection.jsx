import { getRoleLabel } from '../../lib/auth.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5] disabled:cursor-not-allowed disabled:opacity-60'
const infoCardClass = 'rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 shadow-sm shadow-[#047857]/10'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.16em] text-[#047857]'
const valueClass = 'mt-2 whitespace-normal break-normal text-sm font-semibold text-[#101828]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] shadow-sm shadow-[#047857]/10'

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
      description="This is how your name appears inside football records and the workspace."
      tourId="account-profile-settings"
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className={labelClass}>Username</span>
          <input
            type="text"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            required
            autoComplete="nickname"
            className={inputClass}
          />
        </label>

        {!showEmailIdentity ? (
          <label className="block">
            <span className={labelClass}>Display Name</span>
            <input
              type="text"
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              required
              autoComplete="name"
              className={inputClass}
            />
          </label>
        ) : null}

        {showEmailIdentity ? (
          <div className={`${panelClass} p-4`}>
            <p className="text-sm font-black text-[#101828]">Parent email identity</p>
            <p className={`mt-2 ${bodyTextClass}`}>
              Emails will be sent from feedback@footballplayer.online. Parent replies will go to your reply-to email.
            </p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Display Name</span>
              <input
                type="text"
                value={displayName}
                onChange={(event) => onDisplayNameChange(event.target.value)}
                required
                autoComplete="name"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Team Name</span>
              <input
                type="text"
                value={emailTeamName}
                onChange={(event) => onEmailTeamNameChange(event.target.value)}
                required
                placeholder="U12"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Club Name</span>
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
                className={inputClass}
              />
              {!canEditEmailClubName ? (
                <span className="mt-2 block text-xs font-semibold leading-5 text-[#4b5f55]">
                  Only the top role for this plan can change the club name used in sender details.
                </span>
              ) : null}
            </label>

            <label className="block">
              <span className={labelClass}>Reply-to Email</span>
              <input
                type="email"
                value={replyToEmail}
                onChange={(event) => onReplyToEmailChange(event.target.value)}
                required
                autoComplete="email"
                placeholder="coach@club.com"
                className={inputClass}
              />
            </label>
          </div>

          <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 shadow-sm shadow-[#047857]/10">
            <p className={eyebrowClass}>Sender preview</p>
            <p className="mt-2 break-words text-sm font-black text-[#101828]">
              {senderPreview} &lt;feedback@footballplayer.online&gt;
            </p>
          </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className={infoCardClass}>
            <p className={eyebrowClass}>Email</p>
            <p className={valueClass}>
              {user?.email || authUser?.email || 'No email found'}
            </p>
          </div>

          <div className={infoCardClass}>
            <p className={eyebrowClass}>Role</p>
            <p className={valueClass}>{getRoleLabel(user)}</p>
          </div>
        </div>

        <div className={infoCardClass}>
          <p className={eyebrowClass}>Workspace</p>
          <p className={valueClass}>
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
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSavingProfile ? 'Saving...' : 'Save account'}
        </button>
      </form>
    </SectionCard>
  )
}
