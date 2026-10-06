import { Link } from 'react-router-dom'
import { getWorkspaceScope, WORKSPACE_SCOPES } from '../../lib/workspace-scope.js'

export function LoginAuthPanel({
  authError,
  formData,
  isPasswordVisible,
  isSubmitting,
  localError,
  localMessage,
  logo,
  mode,
  onChange,
  onDemoLogin,
  onModeChange,
  onPasswordReset,
  onSubmit,
  onTogglePasswordVisibility,
  parentInviteMode = false,
  paymentsDisabled = false,
  signupBoxRef,
  role,
}) {
  const freeMatchday = formData.planKey === 'matchday'
  const signupScope = freeMatchday
    ? { ...getWorkspaceScope(formData.planKey), entityLabel: 'Team', entityLabelLower: 'team' }
    : getWorkspaceScope(formData.planKey)
  const signupCopy = freeMatchday
    ? { title: 'Create your team account', body: 'Start with free Matchday for your team. Create your account to get started.' }
    : signupScope.key === WORKSPACE_SCOPES.team
    ? {
        title: 'Create your team account',
        body: 'Set up access to the Single Team plan you selected on Pricing.',
      }
    : signupScope.key === WORKSPACE_SCOPES.club
      ? {
          title: 'Create your club account',
          body: 'Set up access to the club plan you selected on Pricing.',
        }
      : {
          title: 'Start free as an individual coach',
          body: 'Create your individual workspace for one small personal squad.',
        }
  const modeCopy = {
    login: {
      title: 'Coach and club sign in',
      body: 'For club admins, team admins, managers, and coaches.',
      submitLabel: 'Log in',
    },
    'parent-login': {
      title: 'Parent sign in',
      body: 'For parents and guardians connected to a player.',
      submitLabel: 'Log in',
    },
    signup: {
      title: parentInviteMode ? 'Create your parent account' : signupCopy.title,
      body: parentInviteMode
        ? 'Create a parent account to accept your player link.'
        : signupCopy.body,
      submitLabel: 'Create account',
    },
  }
  const currentCopy = modeCopy[mode] || modeCopy.login
  const openContactModal = () => {
    window.dispatchEvent(new CustomEvent('football-player:open-contact'))
  }

  return (
    <section ref={signupBoxRef} className="website-auth-panel" aria-label="Account access">
      <div className="mx-auto w-full max-w-[460px] rounded-lg border border-white/12 bg-[#ffffff]/92 p-4 text-white shadow-2xl shadow-black/35 backdrop-blur sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#246bff]/24 bg-[#07152b] shadow-sm shadow-black/25">
            <img src={logo} alt="Football Player" className="h-full w-full object-contain p-1" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-black tracking-tight text-white">
              {parentInviteMode ? 'Sign in to parent access' : currentCopy.title}
            </h2>
            <p className="mt-1 text-sm font-semibold leading-5 text-white/68">
              {parentInviteMode ? 'Log in or create a parent account to accept your player link.' : currentCopy.body}
            </p>
          </div>
        </div>

        <div className="website-auth-mode-actions">
          <button type="button" disabled={isSubmitting} aria-pressed={mode !== 'signup'} onClick={() => onModeChange(parentInviteMode || role === 'parent' || mode === 'parent-login' ? 'parent-login' : 'login')}>Sign in</button>
          {role !== 'parent' || parentInviteMode ? <button type="button" disabled={isSubmitting} aria-pressed={mode === 'signup'} onClick={() => onModeChange('signup')}>Sign up</button> : null}
        </div>
        {role === 'parent' && !parentInviteMode ? <p className="website-auth-join-note">New here? Open the invitation from your team to create your parent account and link your player.</p> : null}

        <form className="mt-5 space-y-3" onSubmit={onSubmit}>
          {mode === 'signup' && !parentInviteMode ? (
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-white">{signupScope.entityLabel} name</span>
              <input
                type="text"
                name="clubName"
                value={formData.clubName}
                onChange={onChange}
                required
                placeholder={`Your ${signupScope.entityLabelLower} name`}
                className="min-h-11 w-full rounded-lg border border-white/12 bg-white/[0.055] px-3 py-2.5 text-sm font-semibold text-white outline-none transition placeholder:text-white/40 focus:border-[#246bff]/70 focus:bg-white/[0.08] focus:ring-2 focus:ring-[#246bff]/20"
              />
            </label>
          ) : null}

          {mode === 'signup' && !parentInviteMode ? (
            <div className="rounded-lg border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-semibold leading-5 text-white/72">
              Need a team or club plan?{' '}
              <Link to="/pricing" className="font-black text-[#246bff] transition hover:text-[#1957cc]">
                Choose a plan on Pricing
              </Link>
              .
            </div>
          ) : null}

          {mode === 'signup' && !parentInviteMode ? (
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-white">Tester access code</span>
              <input
                type="text"
                name="accessCode"
                value={formData.accessCode}
                onChange={onChange}
                placeholder="Optional code from Football Player"
                className="min-h-11 w-full rounded-lg border border-white/12 bg-white/[0.055] px-3 py-2.5 text-sm font-semibold uppercase text-white outline-none transition placeholder:normal-case placeholder:text-white/40 focus:border-[#246bff]/70 focus:bg-white/[0.08] focus:ring-2 focus:ring-[#246bff]/20"
              />
              <span className="mt-2 block text-xs font-semibold leading-5 text-white/58">
                Use this only if you have been given temporary tester access.
              </span>
            </label>
          ) : null}

          {mode === 'signup' && !parentInviteMode && paymentsDisabled ? (
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-white">Test tier</span>
              <select
                name="planKey"
                value={formData.planKey}
                onChange={onChange}
                className="min-h-11 w-full rounded-lg border border-white/12 bg-[#f1f5fa] px-3 py-2.5 text-sm font-semibold text-white outline-none transition focus:border-[#246bff]/70 focus:bg-[#f1f5fa] focus:ring-2 focus:ring-[#246bff]/20"
              >
                <option value="matchday">Matchday - Free</option>
                <option value="team">Team</option>
                <option value="club">Club</option>
              </select>
              <span className="mt-2 block text-xs font-semibold leading-5 text-white/58">
                Staging only. No payment checkout is used for this account.
              </span>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-white">Email</span>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={onChange}
              required
              autoComplete="email"
              placeholder="you@club.com"
              className="min-h-11 w-full rounded-lg border border-white/12 bg-white/[0.055] px-3 py-2.5 text-sm font-semibold text-white outline-none transition placeholder:text-white/40 focus:border-[#246bff]/70 focus:bg-white/[0.08] focus:ring-2 focus:ring-[#246bff]/20"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-white">Password</span>
            <div className="flex overflow-hidden rounded-lg border border-white/12 bg-white/[0.055] focus-within:border-[#246bff]/70 focus-within:bg-white/[0.08] focus-within:ring-2 focus-within:ring-[#246bff]/20">
              <input
                type={isPasswordVisible ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={onChange}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="Enter password"
                className="min-h-11 min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm font-semibold text-white outline-none placeholder:text-white/40"
              />
              <button
                type="button"
                onClick={onTogglePasswordVisibility}
                className="min-h-11 border-l border-white/12 px-3 py-2.5 text-sm font-bold text-[#246bff] transition hover:bg-white/[0.08]"
              >
                {isPasswordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          {localError || authError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
              {localError || authError}
            </div>
          ) : null}

          {localMessage ? (
            <div className="rounded-lg border border-[#246bff]/35 bg-[#246bff]/10 px-4 py-3 text-sm font-bold text-[#1957cc]">
              {localMessage}
            </div>
          ) : null}

          <div className="space-y-2 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#246bff] px-5 py-2.5 text-sm font-black text-[#07152b] shadow-sm shadow-[#246bff]/20 transition hover:bg-[#1957cc] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Please wait...' : currentCopy.submitLabel}
            </button>
            {mode === 'login' || mode === 'parent-login' ? (
              <>
                <button
                  type="button"
                  disabled={isSubmitting}
                  title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
                  hidden
                  onClick={onDemoLogin}
                  className="hidden"
                >
                  Open demo account
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
                  onClick={onPasswordReset}
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-transparent px-5 py-2 text-sm font-bold text-[#246bff] transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Forgot password
                </button>
              </>
            ) : null}
            <p className="pt-1 text-center text-xs font-semibold leading-5 text-white/58">
              Need help?{' '}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={openContactModal}
                className="font-black text-[#246bff] transition hover:text-[#1957cc] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Contact us
              </button>
            </p>
          </div>
        </form>
      </div>
    </section>
  )
}
