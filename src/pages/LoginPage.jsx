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
    <main className="flex min-h-screen items-center justify-center bg-[#020702] px-4 py-8 text-white sm:px-6">
      <div className="grid w-full max-w-6xl overflow-hidden rounded-[32px] border border-[#20301f] bg-[#071008] shadow-xl shadow-black/30 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="bg-[radial-gradient(circle_at_top,#1b2b1a,#020702_58%)] px-6 py-8 text-white sm:px-10 sm:py-10">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border border-[#bfff2f]/30 bg-black/30">
              <img src={fallbackLogo} alt="Football Development" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#c6ff2f]">Football Development</p>
              <p className="mt-2 text-sm text-slate-300">Club assessment platform</p>
            </div>
          </div>

          <h1 className="mt-6 max-w-lg text-4xl font-bold tracking-tight sm:text-5xl">
            Coaching workflow access for clubs, teams, and player feedback.
          </h1>

          <p className="mt-5 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
            Sign in with email and password. Create a club if you are the first account, or sign up with your allocated
            email to join an existing club.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              ['Login', 'email and password auth'],
              ['Sign up', 'create club or join existing'],
              ['Club scoped', 'all data filtered per club'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <p className="text-2xl font-bold">{value}</p>
                <p className="mt-2 text-sm text-slate-300">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-[#0b140c] px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => handleModeChange('login')}
              className={[
                'inline-flex min-h-11 items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition',
                mode === 'login'
                  ? 'bg-[#c6ff2f] text-black'
                  : 'border border-[#20301f] bg-[#111d12] text-slate-200',
              ].join(' ')}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('signup')}
              className={[
                'inline-flex min-h-11 items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition',
                mode === 'signup'
                  ? 'bg-[#c6ff2f] text-black'
                  : 'border border-[#20301f] bg-[#111d12] text-slate-200',
              ].join(' ')}
            >
              Sign Up
            </button>
          </div>

          <p className="mt-6 text-sm font-semibold uppercase tracking-[0.24em] text-[#c6ff2f]">
            {mode === 'signup' ? 'Create account' : 'Sign in'}
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-white">
            {mode === 'signup' ? 'Create your account' : 'Access your club workspace'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {mode === 'signup'
              ? 'Add a club name to create a new club admin account. Leave it blank if your email has already been allocated to an existing club.'
              : 'Use the credentials already linked to your Supabase account or the email allocated to your club.'}
          </p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {mode === 'signup' ? (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-200">Club Name</span>
                <input
                  type="text"
                  name="clubName"
                  value={formData.clubName}
                  onChange={handleChange}
                  placeholder="Leave blank if joining an existing club"
                  className="min-h-11 w-full rounded-2xl border border-[#20301f] bg-[#111d12] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c6ff2f]"
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-200">Email</span>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                autoComplete="email"
                className="min-h-11 w-full rounded-2xl border border-[#20301f] bg-[#111d12] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c6ff2f]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-200">Password</span>
              <div className="flex rounded-2xl border border-[#20301f] bg-[#111d12] focus-within:border-[#c6ff2f]">
                <input
                  type={isPasswordVisible ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  className="min-h-11 min-w-0 flex-1 rounded-l-2xl bg-transparent px-4 py-3 text-sm text-white outline-none"
                />
                <button
                  type="button"
                  onClick={() => setIsPasswordVisible((current) => !current)}
                  className="min-h-11 rounded-r-2xl px-4 py-3 text-sm font-semibold text-[#c6ff2f]"
                >
                  {isPasswordVisible ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>

            {localError || authError ? (
              <div className="rounded-[20px] border border-[#7d2639] bg-[#35101c] px-4 py-3 text-sm font-medium text-[#ffc2cf]">
                {localError || authError}
              </div>
            ) : null}

            {localMessage ? (
              <div className="rounded-[20px] border border-[#20301f] bg-[#142414] px-4 py-3 text-sm font-medium text-[#c6ff2f]">
                {localMessage}
              </div>
            ) : null}

            <div className="space-y-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[#c6ff2f] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Login'}
              </button>
              {mode === 'login' ? (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handlePasswordReset}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[#20301f] bg-[#111d12] px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-[#162617] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Forgot password
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}
