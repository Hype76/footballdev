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
  signupBoxRef,
}) {
  return (
    <section ref={signupBoxRef}>
      <div className="mx-auto w-full max-w-md rounded-lg border border-[#b7efce] bg-white p-5 text-[#101828] shadow-sm shadow-[#d7eadf]/80 sm:p-6">
        <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border border-[#bfe8cd] bg-[#101828] sm:h-28 sm:w-28">
          <img src={logo} alt="Football Player" className="h-full w-full object-contain p-2" />
        </div>
        <div className="rounded-lg border border-[#b7efce] bg-[#f0fdf6] p-5">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#067a46]">
            {mode === 'signup' ? 'Create account' : 'Secure login'}
          </p>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-[#101828]">
            {parentInviteMode ? 'Open parent access' : mode === 'signup' ? 'Start or join a club' : 'Open your workspace'}
          </h2>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#5f7468]">
            {parentInviteMode
              ? 'Log in or create a parent account to accept your child link.'
              : mode === 'signup'
              ? 'Create a club admin account, or sign up with an email already allocated by your club.'
              : 'Use the email and password linked to your club access.'}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] p-1">
          <button
            type="button"
            onClick={() => onModeChange('login')}
            className={[
              'min-h-11 rounded-lg px-4 py-3 text-sm font-black transition',
              mode === 'login' ? 'bg-[#067a46] text-white shadow-sm' : 'text-[#5f7468] hover:bg-white hover:text-[#101828]',
            ].join(' ')}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => onModeChange('signup')}
            className={[
              'min-h-11 rounded-lg px-4 py-3 text-sm font-black transition',
              mode === 'signup' ? 'bg-[#067a46] text-white shadow-sm' : 'text-[#5f7468] hover:bg-white hover:text-[#101828]',
            ].join(' ')}
          >
            Sign Up
          </button>
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
                className="min-h-12 w-full rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#8da59a] focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
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
                className="min-h-12 w-full rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 text-sm font-semibold uppercase text-[#101828] outline-none transition placeholder:normal-case placeholder:text-[#8da59a] focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
              />
              <span className="mt-2 block text-xs leading-5 text-[#5f7468]">
                Use this only if you have been given temporary tester access.
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
              className="min-h-12 w-full rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#8da59a] focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#101828]">Password</span>
            <div className="flex overflow-hidden rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] focus-within:border-[#20a464] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#d7f8e5]">
              <input
                type={isPasswordVisible ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={onChange}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="Enter password"
                className="min-h-12 min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-semibold text-[#101828] outline-none placeholder:text-[#8da59a]"
              />
              <button
                type="button"
                onClick={onTogglePasswordVisibility}
                className="min-h-12 border-l border-[#bfe8cd] px-4 py-3 text-sm font-bold text-[#067a46] transition hover:bg-[#f0fdf6]"
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
            <div className="rounded-lg border border-[#b7efce] bg-[#f0fdf6] px-4 py-3 text-sm font-bold text-[#05603a]">
              {localMessage}
            </div>
          ) : null}

          <div className="space-y-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Login'}
            </button>
            {mode === 'login' ? (
              <>
                <button
                  type="button"
                  disabled={isSubmitting}
                  title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
                  onClick={onDemoLogin}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[#b7efce] bg-[#f0fdf6] px-5 py-3 text-sm font-black text-[#05603a] transition hover:bg-[#dcfae6] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Open Demo Account
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
                  onClick={onPasswordReset}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[#bfe8cd] bg-white px-5 py-3 text-sm font-bold text-[#101828] transition hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60"
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
