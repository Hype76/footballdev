import { useState } from 'react'
import fallbackLogo from '../assets/football-player-logo.png'
import { useAuth } from '../lib/auth.js'
import { updateSignedInPassword } from '../lib/supabase.js'
import { PASSWORD_MIN_LENGTH, PASSWORD_POLICY_SUMMARY } from '../lib/password-policy.js'

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
    'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'

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
    <main className="flex min-h-screen items-center justify-center bg-[#f7faf8] px-4 py-8 text-[#101828] sm:px-6">
      <section className="w-full max-w-xl rounded-lg border border-[#d7e5dc] bg-white px-6 py-8 shadow-sm shadow-[#047857]/10 sm:px-10 sm:py-10">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
            <img src={fallbackLogo} alt="Football Player" className="h-full w-full object-cover" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Football Player</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-[#101828]">Reset password</h1>
          </div>
        </div>

        <p className="mt-6 text-sm font-semibold leading-6 text-[#4b5f55]">
          Enter a new password for your account. After the update you will be signed out and can log in again.
        </p>
        <div className="mt-5 rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-semibold leading-6 text-[#4b5f55]">
          Use a password that belongs only to this account. {PASSWORD_POLICY_SUMMARY}
        </div>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#101828]">New password</span>
            <input
              type={isPasswordVisible ? 'text' : 'password'}
              name="password"
              value={passwordData.password}
              onChange={handleChange}
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#101828]">Confirm password</span>
            <input
              type={isPasswordVisible ? 'text' : 'password'}
              name="confirmPassword"
              value={passwordData.confirmPassword}
              onChange={handleChange}
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              className={inputClass}
            />
          </label>

          <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-bold text-[#101828]">
            <input
              type="checkbox"
              checked={isPasswordVisible}
              onChange={(event) => setIsPasswordVisible(event.target.checked)}
              className="h-4 w-4 rounded border-[#d7e5dc] accent-[#047857]"
            />
            <span>Show password</span>
          </label>

          {errorMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {errorMessage}
            </div>
          ) : null}

          {message ? (
            <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-medium text-[#065f46]">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            title={isSubmitting ? 'Please wait while your password is being updated.' : undefined}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </section>
    </main>
  )
}
