import { useState } from 'react'
import { useAuth } from '../lib/auth.js'

const initialFormData = {
  email: '',
  password: '',
  clubName: '',
}

export function LoginPage() {
  const { authError, signInWithPassword, signUpWithClub } = useAuth()
  const [mode, setMode] = useState('login')
  const [formData, setFormData] = useState(initialFormData)
  const [isSubmitting, setIsSubmitting] = useState(false)
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7f3] px-4 py-8 sm:px-6">
      <div className="grid w-full max-w-6xl overflow-hidden rounded-[32px] border border-[#dbe3d6] bg-white shadow-xl shadow-slate-900/5 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="bg-slate-950 px-6 py-8 text-white sm:px-10 sm:py-10">
          <div className="inline-flex min-h-11 items-center rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#d6dfd2]">
            Supabase Auth
          </div>

          <h1 className="mt-6 max-w-lg text-4xl font-bold tracking-tight sm:text-5xl">
            Coaching workflow access for clubs, approvals, and player feedback.
          </h1>

          <p className="mt-5 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
            Sign in with email and password. New signups create a club and seed the first manager account for that
            club.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              ['Login', 'email and password auth'],
              ['Sign up', 'creates a club manager'],
              ['Club scoped', 'all data filtered per club'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <p className="text-2xl font-bold">{value}</p>
                <p className="mt-2 text-sm text-slate-300">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => handleModeChange('login')}
              className={[
                'inline-flex min-h-11 items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition',
                mode === 'login'
                  ? 'bg-slate-950 text-white'
                  : 'border border-[#dbe3d6] bg-[#f8faf7] text-slate-700',
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
                  ? 'bg-slate-950 text-white'
                  : 'border border-[#dbe3d6] bg-[#f8faf7] text-slate-700',
              ].join(' ')}
            >
              Sign Up
            </button>
          </div>

          <p className="mt-6 text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">
            {mode === 'signup' ? 'Create account' : 'Sign in'}
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-950">
            {mode === 'signup' ? 'Create your club manager account' : 'Access your club workspace'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {mode === 'signup'
              ? 'Your first signup creates the club record and stores your user as the manager.'
              : 'Use the credentials already linked to your Supabase account.'}
          </p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {mode === 'signup' ? (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Club Name</span>
                <input
                  type="text"
                  name="clubName"
                  value={formData.clubName}
                  onChange={handleChange}
                  required={mode === 'signup'}
                  className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Email</span>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                autoComplete="email"
                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Password</span>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>

            {localError || authError ? (
              <div className="rounded-[20px] border border-[#efd1d1] bg-[#fbefef] px-4 py-3 text-sm font-medium text-[#8b4b4b]">
                {localError || authError}
              </div>
            ) : null}

            {localMessage ? (
              <div className="rounded-[20px] border border-[#dbe3d6] bg-[#eef3ea] px-4 py-3 text-sm font-medium text-[#46604a]">
                {localMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500"
            >
              {isSubmitting ? 'Please wait...' : mode === 'signup' ? 'Create Club Account' : 'Login'}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
