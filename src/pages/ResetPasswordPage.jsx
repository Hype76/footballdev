import { useState } from 'react'
import fallbackLogo from '../assets/football-player-logo.png'
import { useAuth } from '../lib/auth.js'
import { updateSignedInPassword } from '../lib/supabase.js'

function createInitialPasswordState() {
  return {
    password: '',
    confirmPassword: '',
  }
}

export function ResetPasswordPage() {
  const { signOut } = useAuth()
  const [passwordData, setPasswordData] = useState(createInitialPasswordState)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const inputClass =
    'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100'

  const handleChange = (event) => {
    const { name, value } = event.target
    setPasswordData((current) => ({
      ...current,
      [name]: value,
    }))
    setMessage('')
    setErrorMessage('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)
    setMessage('')
    setErrorMessage('')

    try {
      if (passwordData.password !== passwordData.confirmPassword) {
        throw new Error('Passwords do not match.')
      }

      await updateSignedInPassword(passwordData.password)
      setPasswordData(createInitialPasswordState())
      setMessage('Password updated. You can now log in with your new password.')
      window.setTimeout(() => {
        void signOut()
      }, 1500)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Password could not be updated.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
      <section className="w-full max-w-xl rounded-lg border border-slate-200 bg-white px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
            <img src={fallbackLogo} alt="Football Player" className="h-full w-full object-cover" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Football Player</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Reset password</h1>
          </div>
        </div>

        <p className="mt-6 text-sm leading-6 text-slate-600">
          Enter a new password for your account. After the update you will be signed out and can log in again.
        </p>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">New password</span>
            <input
              type={isPasswordVisible ? 'text' : 'password'}
              name="password"
              value={passwordData.password}
              onChange={handleChange}
              required
              autoComplete="new-password"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Confirm password</span>
            <input
              type={isPasswordVisible ? 'text' : 'password'}
              name="confirmPassword"
              value={passwordData.confirmPassword}
              onChange={handleChange}
              required
              autoComplete="new-password"
              className={inputClass}
            />
          </label>

          <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800">
            <input
              type="checkbox"
              checked={isPasswordVisible}
              onChange={(event) => setIsPasswordVisible(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>Show password</span>
          </label>

          {errorMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {errorMessage}
            </div>
          ) : null}

          {message ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            title={isSubmitting ? 'Please wait while your password is being updated.' : undefined}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </section>
    </main>
  )
}
