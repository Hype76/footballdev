import { useState } from 'react'
import fallbackLogo from '../assets/football-development-logo-optimized.jpg'
import { useAuth } from '../lib/auth.js'

const initialFormData = {
  email: '',
  password: '',
  clubName: '',
}

export function LoginPage() {
  const { authError, resetPassword, signInWithPassword, signUpWithClub } = useAuth()
  const [mode, setMode] = useState('login')
  const [formData, setFormData] = useState(initialFormData)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [localMessage, setLocalMessage] = useState('')
  const [localError, setLocalError] = useState('')

  const handleChange = (event) => {
    const { name, value } = event.target
    setLocalError('')
    setLocalMessage('')
    setFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleModeChange = (nextMode) => {
    setMode(nextMode)
    setLocalError('')
    setLocalMessage('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)
    setLocalError('')
    setLocalMessage('')

    try {
      if (mode === 'signup') {
        await signUpWithClub({
          email: formData.email.trim(),
          password: formData.password,
          clubName: formData.clubName.trim(),
        })
      } else {
        await signInWithPassword({
          email: formData.email.trim(),
          password: formData.password,
        })
      }
    } catch (error) {
      console.error(error)
      setLocalError(error.message || 'Authentication failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePasswordReset = async () => {
    setIsSubmitting(true)
    setLocalError('')
    setLocalMessage('')

    try {
      await resetPassword(formData.email)
      setLocalMessage('Password reset email sent if that account exists.')
    } catch (error) {
      console.error(error)
      setLocalError(error.message || 'Password reset failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#030603] text-white">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-[-10%] top-[-20%] h-[520px] w-[520px] rounded-full bg-[#d8ff2f]/15 blur-[90px]" />
        <div className="absolute bottom-[-25%] right-[-10%] h-[560px] w-[560px] rounded-full bg-[#1f8a47]/20 blur-[100px]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(216,255,47,0.05),transparent_35%,rgba(255,255,255,0.04))]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#d8ff2f]/30 bg-black/40">
              <img src={fallbackLogo} alt="Football Development" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight">Football Development</p>
              <p className="truncate text-xs text-slate-400">Player feedback and club operations</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-2 text-xs font-semibold text-[#d8ff2f] sm:flex">
            Built for football clubs
          </div>
        </header>

        <div className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[1.08fr_0.92fr] lg:py-10">
          <section className="order-2 lg:order-1">
            <div className="inline-flex rounded-full border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-[#d8ff2f]">
              Club assessment software
            </div>

            <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl">
              Run trials, manage squads, and send polished player feedback.
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
              A club workspace for coaches, managers, and admins to track players, build assessment forms, create
              sessions, export feedback, and keep access controlled by role.
            </p>

            <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
              {[
                ['Trials', 'Assess trialists and move the right players forward.'],
                ['Squads', 'Track current players, positions, and development history.'],
                ['Feedback', 'Generate parent ready PDFs and email templates.'],
              ].map(([title, copy]) => (
                <div key={title} className="rounded-[24px] border border-white/10 bg-white/[0.05] p-4 backdrop-blur">
                  <p className="text-sm font-bold text-white">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{copy}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 grid max-w-2xl gap-4 sm:grid-cols-2">
              <div className="rounded-[28px] border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 p-5">
                <p className="text-3xl font-black text-[#d8ff2f]">Role based</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Staff only see the pages and players their role allows.
                </p>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-white/[0.05] p-5">
                <p className="text-3xl font-black">Club branded</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Uploaded club logos are used across the workspace and exports.
                </p>
              </div>
            </div>
          </section>

          <section className="order-1 lg:order-2">
            <div className="mx-auto w-full max-w-md rounded-[32px] border border-white/10 bg-[#0b130d]/90 p-5 shadow-2xl shadow-black/40 backdrop-blur sm:p-6">
              <div className="rounded-[26px] border border-[#d8ff2f]/15 bg-[linear-gradient(135deg,rgba(216,255,47,0.14),rgba(255,255,255,0.04))] p-5">
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

              <div className="mt-5 grid grid-cols-2 rounded-2xl border border-white/10 bg-black/20 p-1">
                <button
                  type="button"
                  onClick={() => handleModeChange('login')}
                  className={[
                    'min-h-11 rounded-xl px-4 py-3 text-sm font-bold transition',
                    mode === 'login' ? 'bg-[#d8ff2f] text-black' : 'text-slate-300 hover:text-white',
                  ].join(' ')}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('signup')}
                  className={[
                    'min-h-11 rounded-xl px-4 py-3 text-sm font-bold transition',
                    mode === 'signup' ? 'bg-[#d8ff2f] text-black' : 'text-slate-300 hover:text-white',
                  ].join(' ')}
                >
                  Sign Up
                </button>
              </div>

              <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                {mode === 'signup' ? (
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-slate-200">Club Name</span>
                    <input
                      type="text"
                      name="clubName"
                      value={formData.clubName}
                      onChange={handleChange}
                      placeholder="Leave blank if joining an existing club"
                      className="min-h-12 w-full rounded-2xl border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#d8ff2f]"
                    />
                  </label>
                ) : null}

                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-200">Email</span>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    autoComplete="email"
                    placeholder="you@club.com"
                    className="min-h-12 w-full rounded-2xl border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#d8ff2f]"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-200">Password</span>
                  <div className="flex rounded-2xl border border-white/10 bg-[#101b12] focus-within:border-[#d8ff2f]">
                    <input
                      type={isPasswordVisible ? 'text' : 'password'}
                      name="password"
                      value={formData.password}
                      onChange={handleChange}
                      required
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      placeholder="Enter password"
                      className="min-h-12 min-w-0 flex-1 rounded-l-2xl bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => setIsPasswordVisible((current) => !current)}
                      className="min-h-12 rounded-r-2xl px-4 py-3 text-sm font-bold text-[#d8ff2f]"
                    >
                      {isPasswordVisible ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>

                {localError || authError ? (
                  <div className="rounded-[20px] border border-[#7d2639] bg-[#35101c] px-4 py-3 text-sm font-semibold text-[#ffc2cf]">
                    {localError || authError}
                  </div>
                ) : null}

                {localMessage ? (
                  <div className="rounded-[20px] border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-3 text-sm font-semibold text-[#d8ff2f]">
                    {localMessage}
                  </div>
                ) : null}

                <div className="space-y-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#d8ff2f] px-5 py-3 text-sm font-black text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Login'}
                  </button>
                  {mode === 'login' ? (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={handlePasswordReset}
                      className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Forgot password
                    </button>
                  ) : null}
                </div>
              </form>
            </div>
          </section>
        </div>

        <footer className="grid gap-3 pb-3 text-xs text-slate-500 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            Managers control staff roles and club setup.
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            Coaches manage sessions, players, and assessments.
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            Platform admins manage clubs without seeing child details.
          </div>
        </footer>
      </div>
    </main>
  )
}
