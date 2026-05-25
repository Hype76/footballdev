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
    <section ref={signupBoxRef} className="order-1 lg:order-2">
      <div className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 text-slate-950 shadow-2xl shadow-slate-900/20 backdrop-blur sm:p-6">
        <div className="mx-auto mb-5 flex h-28 w-28 items-center justify-center overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-xl shadow-slate-900/20 sm:h-32 sm:w-32">
          <img src={logo} alt="Football Player" className="h-full w-full object-contain p-2" />
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-700">
            {mode === 'signup' ? 'Create account' : 'Secure login'}
          </p>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">
            {parentInviteMode ? 'Open parent access' : mode === 'signup' ? 'Start or join a club' : 'Open your workspace'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {parentInviteMode
              ? 'Log in or create a parent account to accept your child link.'
              : mode === 'signup'
              ? 'Create a club admin account, or sign up with an email already allocated by your club.'
              : 'Use the email and password linked to your club access.'}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 rounded-2xl border border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => onModeChange('login')}
            className={[
              'min-h-11 rounded-xl px-4 py-3 text-sm font-bold transition',
              mode === 'login' ? 'bg-slate-950 text-white' : 'text-slate-600 hover:text-slate-950',
            ].join(' ')}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => onModeChange('signup')}
            className={[
              'min-h-11 rounded-xl px-4 py-3 text-sm font-bold transition',
              mode === 'signup' ? 'bg-slate-950 text-white' : 'text-slate-600 hover:text-slate-950',
            ].join(' ')}
          >
            Sign Up
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          {mode === 'signup' && !parentInviteMode ? (
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-950">Club Name</span>
              <input
                type="text"
                name="clubName"
                value={formData.clubName}
                onChange={onChange}
                required
                placeholder="Your club or team name"
                className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white"
              />
            </label>
          ) : null}

          {mode === 'signup' && !parentInviteMode ? (
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-950">Tester access code</span>
              <input
                type="text"
                name="accessCode"
                value={formData.accessCode}
                onChange={onChange}
                placeholder="Optional code from Football Player"
                className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm uppercase text-slate-950 outline-none transition placeholder:normal-case placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white"
              />
              <span className="mt-2 block text-xs leading-5 text-slate-500">
                Use this only if you have been given temporary tester access.
              </span>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Email</span>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={onChange}
              required
              autoComplete="email"
              placeholder="you@club.com"
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Password</span>
            <div className="flex rounded-xl border border-slate-200 bg-slate-50 focus-within:border-emerald-500 focus-within:bg-white">
              <input
                type={isPasswordVisible ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={onChange}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="Enter password"
                className="min-h-12 min-w-0 flex-1 rounded-l-xl bg-transparent px-4 py-3 text-sm text-slate-950 outline-none placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={onTogglePasswordVisibility}
                className="min-h-12 rounded-r-xl px-4 py-3 text-sm font-bold text-emerald-700"
              >
                {isPasswordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          {localError || authError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
              {localError || authError}
            </div>
          ) : null}

          {localMessage ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
              {localMessage}
            </div>
          ) : null}

          <div className="space-y-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-black text-emerald-900 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Open Demo Account
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  title={isSubmitting ? 'Please wait while your request is being checked.' : undefined}
                  onClick={onPasswordReset}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
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
