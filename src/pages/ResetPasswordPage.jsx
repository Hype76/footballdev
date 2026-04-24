import { useState } from 'react'
import fallbackLogo from '../assets/football-development-logo-optimized.jpg'
import { useAuth } from '../lib/auth.js'
import { updateSignedInPassword } from '../lib/supabase.js'

function createInitialPasswordState() {
  return {
    password: '',
    confirmPassword: '',
  }
}

export function ResetPasswordPage() {
  const { signOut, updateCurrentUserDetails } = useAuth()
  const [passwordData, setPasswordData] = useState(createInitialPasswordState)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

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
      updateCurrentUserDetails({
        forcePasswordChange: false,
      })
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
    <main className="flex min-h-screen items-center justify-center bg-[#020702] px-4 py-8 text-white sm:px-6">
      <section className="w-full max-w-xl rounded-[32px] border border-[#20301f] bg-[#0b140c] px-6 py-8 shadow-xl shadow-black/30 sm:px-10 sm:py-10">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border border-[#bfff2f]/30 bg-black/30">
            <img src={fallbackLogo} alt="Football Development" className="h-full w-full object-cover" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#c6ff2f]">Football Development</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Reset password</h1>
          </div>
        </div>

        <p className="mt-6 text-sm leading-6 text-slate-300">
          Enter a new password for your account. After the update you will be signed out and can log in again.
        </p>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-200">New password</span>
            <input
              type={isPasswordVisible ? 'text' : 'password'}
              name="password"
              value={passwordData.password}
              onChange={handleChange}
              required
              autoComplete="new-password"
              className="min-h-11 w-full rounded-2xl border border-[#20301f] bg-[#111d12] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c6ff2f]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-200">Confirm password</span>
            <input
              type={isPasswordVisible ? 'text' : 'password'}
              name="confirmPassword"
              value={passwordData.confirmPassword}
              onChange={handleChange}
              required
              autoComplete="new-password"
              className="min-h-11 w-full rounded-2xl border border-[#20301f] bg-[#111d12] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c6ff2f]"
            />
          </label>

          <label className="inline-flex min-h-11 items-center gap-3 rounded-2xl border border-[#20301f] bg-[#111d12] px-4 py-3 text-sm font-semibold text-slate-200">
            <input
              type="checkbox"
              checked={isPasswordVisible}
              onChange={(event) => setIsPasswordVisible(event.target.checked)}
              className="h-4 w-4 rounded border-[#20301f]"
            />
            <span>Show password</span>
          </label>

          {errorMessage ? (
            <div className="rounded-[20px] border border-[#7d2639] bg-[#35101c] px-4 py-3 text-sm font-medium text-[#ffc2cf]">
              {errorMessage}
            </div>
          ) : null}

          {message ? (
            <div className="rounded-[20px] border border-[#20301f] bg-[#142414] px-4 py-3 text-sm font-medium text-[#c6ff2f]">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[#c6ff2f] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </section>
    </main>
  )
}
