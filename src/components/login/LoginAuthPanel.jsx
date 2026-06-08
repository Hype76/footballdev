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
      eyebrow: 'Club login',
      title: 'Open your club workspace',
      body: 'For club admins, team admins, coaches, and staff using the main workspace.',
      submitLabel: 'Log in',
    },
    'parent-login': {
      eyebrow: 'Parent login',
      title: 'Open parent access',
      body: 'For parents and family contacts linked to a player by their club.',
      submitLabel: 'Open parent portal',
    },
    signup: {
      eyebrow: 'Create account',
      title: parentInviteMode ? 'Create parent access' : 'Start or join a club',
      body: parentInviteMode
        ? 'Create a parent account to accept your child link.'
        : 'Create a club admin account, or sign up with an email already allocated by your club.',
      submitLabel: 'Create account',
    },
  }
  const currentCopy = modeCopy[mode] || modeCopy.login

  return (
    <section ref={signupBoxRef}>
      <div className="mx-auto w-full max-w-md rounded-lg border border-[#d7e5dc] bg-white p-5 text-[#101828] shadow-lg shadow-[#101828]/10 sm:p-6">
        <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10 sm:h-28 sm:w-28">
          <img src={logo} alt="Football Player" className="h-full w-full object-contain p-2" />
        </div>
        <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-5">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#047857]">
            {currentCopy.eyebrow}
          </p>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-[#101828]">
            {parentInviteMode ? 'Open parent access' : currentCopy.title}
          </h2>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">
            {parentInviteMode ? 'Log in or create a parent account to accept your child link.' : currentCopy.body}
          </p>
        </div>

        <div className="mt-5 grid gap-3">
          {[
            ['login', 'Club Login', 'Staff workspace'],
            ['parent-login', 'Parent Login', 'Family portal'],
            ['signup', 'Sign Up', parentInviteMode ? 'Create parent account' : 'Create club account'],
          ].map(([nextMode, label, helper]) => (
            <button
              key={nextMode}
              type="button"
              onClick={() => onModeChange(nextMode)}
              className={[
                'flex min-h-14 items-center justify-between rounded-lg border px-4 py-3 text-left transition',
                mode === nextMode
                  ? 'border-[#047857] bg-[#047857] text-white shadow-sm shadow-[#047857]/20'
                  : 'border-[#d7e5dc] bg-[#f7faf8] text-[#101828] hover:border-[#0f9f6e] hover:bg-white',
              ].join(' ')}
            >
              <span className="text-sm font-black">{label}</span>
              <span className={mode === nextMode ? 'text-xs font-bold text-white/80' : 'text-xs font-bold text-[#4b5f55]'}>
                {helper}
              </span>
            </button>
          ))}
        </div>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          {mode === 'signup' && !parentInviteMode ? (
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-[#101828]">Club Name</span>
              <input
                type="text"
                name="clubName"
                value={formData.clubName}
                onChange={onChange}
                required
                placeholder="Your club or team name"
                className="min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]"
              />
            </label>
          ) : null}

          {mode === 'signup' && !parentInviteMode ? (
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-[#101828]">Tester access code</span>
              <input
                type="text"
                name="accessCode"
                value={formData.accessCode}
                onChange={onChange}
                placeholder="Optional code from Football Player"
                className="min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold uppercase text-[#101828] outline-none transition placeholder:normal-case placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]"
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
                className="min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]"
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
            <span className="mb-2 block text-sm font-bold text-[#101828]">Email</span>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={onChange}
              required
              autoComplete="email"
              placeholder="you@club.com"
              className="min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#101828]">Password</span>
            <div className="flex overflow-hidden rounded-lg border border-[#d7e5dc] bg-[#f7faf8] focus-within:border-[#047857] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#bbf7d0]">
              <input
                type={isPasswordVisible ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={onChange}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="Enter password"
                className="min-h-12 min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-semibold text-[#101828] outline-none placeholder:text-[#94a3b8]"
              />
              <button
                type="button"
                onClick={onTogglePasswordVisibility}
                className="min-h-12 border-l border-[#d7e5dc] px-4 py-3 text-sm font-bold text-[#047857] transition hover:bg-[#ecfdf5]"
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

          <div className="space-y-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-5 py-3 text-sm font-black text-[#065f46] transition hover:bg-[#d1fae5] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Open demo account
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
                  onClick={onPasswordReset}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-bold text-[#101828] transition hover:bg-[#f7faf8] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Forgot password
                </button>
              </>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  )
}
