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
  signupBoxRef,
}) {
  return (
    <section ref={signupBoxRef} className="order-1 lg:order-2">
      <div className="mx-auto w-full max-w-md rounded-lg border border-white/10 bg-[#0b130d]/90 p-5 shadow-2xl shadow-black/40 backdrop-blur sm:p-6">
        <div className="mx-auto mb-5 flex h-28 w-28 items-center justify-center overflow-hidden rounded-lg border border-[#d8ff2f]/30 bg-black/50 shadow-xl shadow-[#d8ff2f]/10 sm:h-32 sm:w-32">
          <img src={logo} alt="Player Feedback" className="h-full w-full object-contain p-2" />
        </div>
        <div className="rounded-lg border border-[#d8ff2f]/15 bg-[#111d12] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#d8ff2f]">
            {mode === 'signup' ? 'Create account' : 'Secure login'}
          </p>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-white">
            {mode === 'signup' ? 'Start or join a club' : 'Open your workspace'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {mode === 'signup'
              ? 'Create a club admin account, or sign up with an email already allocated by your club.'
              : 'Use the email and password linked to your club access.'}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 rounded-lg border border-white/10 bg-black/20 p-1">
          <button
            type="button"
            onClick={() => onModeChange('login')}
            className={[
              'min-h-11 rounded-lg px-4 py-3 text-sm font-bold transition',
              mode === 'login' ? 'bg-[#d8ff2f] text-black' : 'text-slate-300 hover:text-white',
            ].join(' ')}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => onModeChange('signup')}
            className={[
              'min-h-11 rounded-lg px-4 py-3 text-sm font-bold transition',
              mode === 'signup' ? 'bg-[#d8ff2f] text-black' : 'text-slate-300 hover:text-white',
            ].join(' ')}
          >
            Sign Up
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          {mode === 'signup' ? (
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-200">Club Name</span>
              <input
                type="text"
                name="clubName"
                value={formData.clubName}
                onChange={onChange}
                required
                placeholder="Your club or team name"
                className="min-h-12 w-full rounded-lg border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#d8ff2f]"
              />
            </label>
          ) : null}

          {mode === 'signup' ? (
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-200">Tester access code</span>
              <input
                type="text"
                name="accessCode"
                value={formData.accessCode}
                onChange={onChange}
                placeholder="Optional code from Player Feedback"
                className="min-h-12 w-full rounded-lg border border-white/10 bg-[#101b12] px-4 py-3 text-sm uppercase text-white outline-none transition placeholder:normal-case placeholder:text-slate-500 focus:border-[#d8ff2f]"
              />
              <span className="mt-2 block text-xs leading-5 text-slate-400">
                Use this only if you have been given temporary tester access.
              </span>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-200">Email</span>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={onChange}
              required
              autoComplete="email"
              placeholder="you@club.com"
              className="min-h-12 w-full rounded-lg border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#d8ff2f]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-200">Password</span>
            <div className="flex rounded-lg border border-white/10 bg-[#101b12] focus-within:border-[#d8ff2f]">
              <input
                type={isPasswordVisible ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={onChange}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="Enter password"
                className="min-h-12 min-w-0 flex-1 rounded-l-2xl bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={onTogglePasswordVisibility}
                className="min-h-12 rounded-r-2xl px-4 py-3 text-sm font-bold text-[#d8ff2f]"
              >
                {isPasswordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          {localError || authError ? (
            <div className="rounded-lg border border-[#7d2639] bg-[#35101c] px-4 py-3 text-sm font-semibold text-[#ffc2cf]">
              {localError || authError}
            </div>
          ) : null}

          {localMessage ? (
            <div className="rounded-lg border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-3 text-sm font-semibold text-[#d8ff2f]">
              {localMessage}
            </div>
          ) : null}

          <div className="space-y-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#d8ff2f] px-5 py-3 text-sm font-black text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Login'}
            </button>
            {mode === 'login' ? (
              <>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onDemoLogin}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[#d8ff2f]/30 bg-[#d8ff2f]/10 px-5 py-3 text-sm font-black text-[#d8ff2f] transition hover:bg-[#d8ff2f]/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Open Demo Account
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onPasswordReset}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
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
