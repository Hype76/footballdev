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
}) {
  const modeCopy = {
    login: {
      title: 'Sign in to your club workspace',
      body: 'For club admins, team admins, coaches, and staff.',
      submitLabel: 'Log in',
    },
    'parent-login': {
      title: 'Sign in to parent access',
      body: 'For parents and guardians connected to a player.',
      submitLabel: 'Log in',
    },
    signup: {
      title: parentInviteMode ? 'Create your parent account' : 'Create your club account',
      body: parentInviteMode
        ? 'Create a parent account to accept your child link.'
        : 'Create a club workspace and start with one team.',
      submitLabel: 'Create account',
    },
  }
  const currentCopy = modeCopy[mode] || modeCopy.login
  const openContactModal = () => {
    window.dispatchEvent(new CustomEvent('football-player:open-contact'))
  }

  return (
    <section ref={signupBoxRef}>
      <div className="mx-auto w-full max-w-[460px] rounded-lg border border-white/12 bg-[#07130b]/92 p-4 text-white shadow-2xl shadow-black/35 backdrop-blur sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#c6ff1a]/24 bg-[#06110a] shadow-sm shadow-black/25">
            <img src={logo} alt="Football Player" className="h-full w-full object-contain p-1" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-black tracking-tight text-white">
              {parentInviteMode ? 'Sign in to parent access' : currentCopy.title}
            </h2>
            <p className="mt-1 text-sm font-semibold leading-5 text-white/68">
              {parentInviteMode ? 'Log in or create a parent account to accept your child link.' : currentCopy.body}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-1 rounded-lg border border-white/12 bg-white/[0.055] p-1">
          {[
            ['login', 'Club'],
            ['parent-login', 'Parent'],
            ['signup', 'Sign Up'],
          ].map(([nextMode, label]) => (
            <button
              key={nextMode}
              type="button"
              onClick={() => onModeChange(nextMode)}
              className={[
                'min-h-11 rounded-lg px-2 py-2 text-center text-xs font-black transition sm:text-sm',
                mode === nextMode
                  ? 'bg-[#c6ff1a] text-[#06110a] shadow-sm shadow-[#c6ff1a]/20'
                  : 'text-white/68 hover:bg-white/[0.08] hover:text-white',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        <form className="mt-5 space-y-3" onSubmit={onSubmit}>
          {mode === 'signup' && !parentInviteMode ? (
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-white">Club Name</span>
              <input
                type="text"
                name="clubName"
                value={formData.clubName}
                onChange={onChange}
                required
                placeholder="Your club or team name"
                className="min-h-11 w-full rounded-lg border border-white/12 bg-white/[0.055] px-3 py-2.5 text-sm font-semibold text-white outline-none transition placeholder:text-white/40 focus:border-[#c6ff1a]/70 focus:bg-white/[0.08] focus:ring-2 focus:ring-[#c6ff1a]/20"
              />
            </label>
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
                className="min-h-11 w-full rounded-lg border border-white/12 bg-white/[0.055] px-3 py-2.5 text-sm font-semibold uppercase text-white outline-none transition placeholder:normal-case placeholder:text-white/40 focus:border-[#c6ff1a]/70 focus:bg-white/[0.08] focus:ring-2 focus:ring-[#c6ff1a]/20"
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
                className="min-h-11 w-full rounded-lg border border-white/12 bg-[#102016] px-3 py-2.5 text-sm font-semibold text-white outline-none transition focus:border-[#c6ff1a]/70 focus:bg-[#102016] focus:ring-2 focus:ring-[#c6ff1a]/20"
              >
                <option value="individual">Individual Coach - Free</option>
                <option value="single_team">Single Team</option>
                <option value="small_club">Small Club</option>
                <option value="development_club">Development Club</option>
                <option value="large_club">Large Club</option>
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
              className="min-h-11 w-full rounded-lg border border-white/12 bg-white/[0.055] px-3 py-2.5 text-sm font-semibold text-white outline-none transition placeholder:text-white/40 focus:border-[#c6ff1a]/70 focus:bg-white/[0.08] focus:ring-2 focus:ring-[#c6ff1a]/20"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-white">Password</span>
            <div className="flex overflow-hidden rounded-lg border border-white/12 bg-white/[0.055] focus-within:border-[#c6ff1a]/70 focus-within:bg-white/[0.08] focus-within:ring-2 focus-within:ring-[#c6ff1a]/20">
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
                className="min-h-11 border-l border-white/12 px-3 py-2.5 text-sm font-bold text-[#c6ff1a] transition hover:bg-white/[0.08]"
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
            <div className="rounded-lg border border-[#c6ff1a]/35 bg-[#c6ff1a]/10 px-4 py-3 text-sm font-bold text-[#dbff66]">
              {localMessage}
            </div>
          ) : null}

          <div className="space-y-2 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#c6ff1a] px-5 py-2.5 text-sm font-black text-[#06110a] shadow-sm shadow-[#c6ff1a]/20 transition hover:bg-[#dbff66] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Please wait...' : currentCopy.submitLabel}
            </button>
            {mode === 'login' || mode === 'parent-login' ? (
              <>
                <button
                  type="button"
                  disabled={isSubmitting}
                  title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
                  onClick={onDemoLogin}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-white/16 bg-white/[0.06] px-5 py-2.5 text-sm font-black text-white transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Open demo account
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
                  onClick={onPasswordReset}
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-transparent px-5 py-2 text-sm font-bold text-[#c6ff1a] transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
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
                className="font-black text-[#c6ff1a] transition hover:text-[#dbff66] disabled:cursor-not-allowed disabled:opacity-60"
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
