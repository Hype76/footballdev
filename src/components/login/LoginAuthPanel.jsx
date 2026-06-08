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
      eyebrow: 'Club Login',
      title: 'Club Login',
      body: 'For club admins, team admins, coaches, and staff.',
      submitLabel: 'Log in',
    },
    'parent-login': {
      eyebrow: 'Parent Login',
      title: 'Parent Login',
      body: 'For parents and family contacts linked to a player.',
      submitLabel: 'Open parent portal',
    },
    signup: {
      eyebrow: 'Sign Up',
      title: parentInviteMode ? 'Parent Sign Up' : 'Sign Up',
      body: parentInviteMode
        ? 'Create a parent account to accept your child link.'
        : 'Create a club account, or join with an email already added by your club.',
      submitLabel: 'Create account',
    },
  }
  const currentCopy = modeCopy[mode] || modeCopy.login
  const openContactModal = () => {
    window.dispatchEvent(new CustomEvent('football-player:open-contact'))
  }

  return (
    <section ref={signupBoxRef}>
      <div className="mx-auto w-full max-w-[460px] rounded-lg border border-[#d7e5dc] bg-white p-4 text-[#101828] shadow-2xl shadow-black/25 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#d7e5dc] bg-[#06110a] shadow-sm shadow-[#047857]/10">
            <img src={logo} alt="Football Player" className="h-full w-full object-contain p-1" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">
            {currentCopy.eyebrow}
            </p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-[#101828]">
              {parentInviteMode ? 'Parent access' : currentCopy.title}
            </h2>
            <p className="mt-1 text-sm font-semibold leading-5 text-[#4b5f55]">
              {parentInviteMode ? 'Log in or create a parent account to accept your child link.' : currentCopy.body}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-1">
          {[
            ['login', 'Club Login'],
            ['parent-login', 'Parent Login'],
            ['signup', 'Sign Up'],
          ].map(([nextMode, label]) => (
            <button
              key={nextMode}
              type="button"
              onClick={() => onModeChange(nextMode)}
              className={[
                'min-h-11 rounded-lg px-2 py-2 text-center text-xs font-black transition sm:text-sm',
                mode === nextMode
                  ? 'bg-[#047857] text-white shadow-sm shadow-[#047857]/20'
                  : 'text-[#4b5f55] hover:bg-white hover:text-[#101828]',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        <form className="mt-5 space-y-3" onSubmit={onSubmit}>
          {mode === 'signup' && !parentInviteMode ? (
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-[#101828]">Club Name</span>
              <input
                type="text"
                name="clubName"
                value={formData.clubName}
                onChange={onChange}
                required
                placeholder="Your club or team name"
                className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2.5 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]"
              />
            </label>
          ) : null}

          {mode === 'signup' && !parentInviteMode ? (
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-[#101828]">Tester access code</span>
              <input
                type="text"
                name="accessCode"
                value={formData.accessCode}
                onChange={onChange}
                placeholder="Optional code from Football Player"
                className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2.5 text-sm font-semibold uppercase text-[#101828] outline-none transition placeholder:normal-case placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]"
              />
              <span className="mt-2 block text-xs leading-5 text-[#4b5f55]">
                Use this only if you have been given temporary tester access.
              </span>
            </label>
          ) : null}

          {mode === 'signup' && !parentInviteMode && paymentsDisabled ? (
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-[#101828]">Test tier</span>
              <select
                name="planKey"
                value={formData.planKey}
                onChange={onChange}
                className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2.5 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]"
              >
                <option value="individual">Individual</option>
                <option value="single_team">Single Team</option>
                <option value="small_club">Small Club</option>
                <option value="large_club">Large Club</option>
              </select>
              <span className="mt-2 block text-xs leading-5 text-[#4b5f55]">
                Staging only. No payment checkout is used for this account.
              </span>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-[#101828]">Email</span>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={onChange}
              required
              autoComplete="email"
              placeholder="you@club.com"
              className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2.5 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-[#101828]">Password</span>
            <div className="flex overflow-hidden rounded-lg border border-[#d7e5dc] bg-[#f7faf8] focus-within:border-[#047857] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#bbf7d0]">
              <input
                type={isPasswordVisible ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={onChange}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="Enter password"
                className="min-h-11 min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm font-semibold text-[#101828] outline-none placeholder:text-[#94a3b8]"
              />
              <button
                type="button"
                onClick={onTogglePasswordVisibility}
                className="min-h-11 border-l border-[#d7e5dc] px-3 py-2.5 text-sm font-bold text-[#047857] transition hover:bg-[#ecfdf5]"
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
            <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-bold text-[#065f46]">
              {localMessage}
            </div>
          ) : null}

          <div className="space-y-2 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-2.5 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-5 py-2.5 text-sm font-black text-[#065f46] transition hover:bg-[#d1fae5] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Open demo account
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
                  onClick={onPasswordReset}
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-transparent bg-white px-5 py-2 text-sm font-bold text-[#047857] transition hover:bg-[#f7faf8] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Forgot password
                </button>
              </>
            ) : null}
            <button
              type="button"
              disabled={isSubmitting}
              onClick={openContactModal}
              className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-transparent bg-white px-5 py-2 text-sm font-bold text-[#4b5f55] transition hover:bg-[#f7faf8] hover:text-[#101828] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Contact us
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
