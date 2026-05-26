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
    'min-h-11 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#bfdbfe]'

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
    <main className="flex min-h-screen items-center justify-center bg-[#f8fafc] px-4 py-8 text-[#0f172a] sm:px-6">
      <section className="w-full max-w-xl rounded-lg border border-[#cbd5e1] bg-white px-6 py-8 shadow-sm shadow-[#2563eb]/10 sm:px-10 sm:py-10">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-[#cbd5e1] bg-[#0f172a]">
            <img src={fallbackLogo} alt="Football Player" className="h-full w-full object-cover" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Football Player</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-[#0f172a]">Reset password</h1>
          </div>
        </div>

        <p className="mt-6 text-sm font-semibold leading-6 text-[#475569]">
          Enter a new password for your account. After the update you will be signed out and can log in again.
        </p>
        <div className="mt-5 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm font-semibold leading-6 text-[#475569]">
          Use a password that belongs only to this account. Shared staff or parent passwords should not be used.
        </div>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#0f172a]">New password</span>
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
            <span className="mb-2 block text-sm font-bold text-[#0f172a]">Confirm password</span>
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

          <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-[#cbd5e1] bg-white px-4 py-3 text-sm font-bold text-[#0f172a]">
            <input
              type="checkbox"
              checked={isPasswordVisible}
              onChange={(event) => setIsPasswordVisible(event.target.checked)}
              className="h-4 w-4 rounded border-[#cbd5e1] accent-[#2563eb]"
            />
            <span>Show password</span>
          </label>

          {errorMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {errorMessage}
            </div>
          ) : null}

          {message ? (
            <div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm font-medium text-[#1d4ed8]">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            title={isSubmitting ? 'Please wait while your password is being updated.' : undefined}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#2563eb] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </section>
    </main>
  )
}
