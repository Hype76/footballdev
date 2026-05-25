import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-player-logo.png'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'

export function StaffInvitePage() {
  const { token } = useParams()
  const [invite, setInvite] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    let isCurrent = true

    async function loadInvite() {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const response = await fetch(`/.netlify/functions/get-staff-invite?token=${encodeURIComponent(token || '')}`)
        const result = await response.json().catch(() => ({}))

        if (!response.ok || result.success === false) {
          throw new Error(result.message || 'Staff invite could not be loaded.')
        }

        if (isCurrent) {
          setInvite(result.invite)
        }
      } catch (error) {
        console.error(error)

        if (isCurrent) {
          setInvite(null)
          setErrorMessage(error.message || 'Staff invite could not be loaded.')
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false)
        }
      }
    }

    void loadInvite()

    return () => {
      isCurrent = false
    }
  }, [token])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')

    if (!invite?.email) {
      setErrorMessage('Staff invite could not be loaded.')
      return
    }

    if (password.length < 8) {
      setErrorMessage('Create a password with at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.')
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch('/.netlify/functions/create-staff-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          email: invite.email,
          password,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Staff account could not be created.')
      }

      setSuccessMessage('Staff access created. You can now sign in.')
      setPassword('')
      setConfirmPassword('')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Staff account could not be created.')
    } finally {
      setIsSaving(false)
    }
  }

  const logoUrl = invite?.logoUrl || fallbackLogo

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950">
      <div className="mx-auto w-full max-w-xl border border-slate-200 bg-white p-6 sm:p-8">
        <img
          src={logoUrl}
          alt=""
          className="mb-6 h-16 w-16 border border-slate-200 bg-slate-950 object-contain"
        />
        <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Staff invite</p>
        <h1 className="text-2xl font-black text-slate-950">Create staff access</h1>

        {isLoading ? (
          <p className="mt-6 border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-600">
            Opening staff invite...
          </p>
        ) : errorMessage && !invite ? (
          <div className="mt-6">
            <NoticeBanner title="Staff invite not opened" message={errorMessage} />
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-sm font-black text-slate-950">{invite.clubName || 'Football Player'}</p>
              <p className="mt-1 text-sm font-semibold text-slate-600">{invite.teamName || 'Team access'} | {invite.roleLabel || 'Staff'}</p>
              <p className="mt-3 break-words text-sm font-semibold text-emerald-700">{invite.email}</p>
            </div>

            {errorMessage ? <NoticeBanner title="Staff access not created" message={errorMessage} /> : null}
            {successMessage ? (
              <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
                {successMessage}
              </div>
            ) : null}

            {!successMessage ? (
              <>
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-slate-950">Create password</span>
                  <div className="flex border border-slate-200 bg-slate-50 focus-within:border-emerald-600 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-100">
                    <input
                      type={isPasswordVisible ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="min-h-11 min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-semibold text-slate-950 outline-none"
                      placeholder="Create a password"
                    />
                    <button
                      type="button"
                      onClick={() => setIsPasswordVisible((value) => !value)}
                      className="min-h-11 border-l border-slate-200 px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-100"
                    >
                      {isPasswordVisible ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-black text-slate-950">Confirm password</span>
                  <input
                    type={isPasswordVisible ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="min-h-11 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                    placeholder="Confirm password"
                  />
                </label>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex min-h-11 w-full items-center justify-center bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? 'Creating access...' : 'Create Staff Access'}
                </button>
              </>
            ) : (
              <Link
                to="/sign-in"
                className="inline-flex min-h-11 w-full items-center justify-center bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800"
              >
                Go to sign in
              </Link>
            )}
          </form>
        )}
      </div>
    </main>
  )
}

export default StaffInvitePage
