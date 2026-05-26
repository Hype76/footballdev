import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-player-logo.png'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'

const inputClass = 'min-h-11 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const primaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60'

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
    <main className="min-h-screen bg-[#f6fbf8] px-4 py-10 text-[#10231a]">
      <div className="mx-auto w-full max-w-xl rounded-lg border border-[#bddcca] bg-white p-6 shadow-sm shadow-[#067a46]/10 sm:p-8">
        <img
          src={logoUrl}
          alt=""
          className="mb-6 h-16 w-16 rounded-lg border border-[#bddcca] bg-[#10231a] object-contain p-1"
        />
        <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Staff invite</p>
        <h1 className="text-2xl font-black text-[#10231a]">Create staff access</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-[#456653]">
          Create your own login for the club role shown below. Do not share another staff member's account.
        </p>

        {isLoading ? (
          <p className="mt-6 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-4 text-sm font-semibold text-[#456653]">
            Opening staff invite...
          </p>
        ) : errorMessage && !invite ? (
          <div className="mt-6">
            <NoticeBanner title="Staff invite not opened" message={errorMessage} />
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="rounded-lg border border-[#bddcca] bg-[#f0fdf6] px-4 py-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">Access details</p>
              <p className="text-sm font-black text-[#10231a]">{invite.clubName || 'Football Player'}</p>
              <p className="mt-1 text-sm font-semibold text-[#456653]">{invite.teamName || 'Team access'} | {invite.roleLabel || 'Staff'}</p>
              <p className="mt-3 break-words text-sm font-semibold text-[#067a46]">{invite.email}</p>
            </div>

            {errorMessage ? <NoticeBanner title="Staff access not created" message={errorMessage} /> : null}
            {successMessage ? (
              <div className="rounded-lg border border-[#bddcca] bg-[#f0fdf6] px-4 py-3 text-sm font-bold text-[#05603a]">
                {successMessage}
              </div>
            ) : null}

            {!successMessage ? (
              <>
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#10231a]">Create password</span>
                  <div className="flex rounded-lg border border-[#bddcca] bg-[#f6fbf8] focus-within:border-[#20a464] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#d7f8e5]">
                    <input
                      type={isPasswordVisible ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="min-h-11 min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-semibold text-[#10231a] outline-none"
                      placeholder="Create a password"
                    />
                    <button
                      type="button"
                      onClick={() => setIsPasswordVisible((value) => !value)}
                      className="min-h-11 border-l border-[#bddcca] px-4 py-3 text-sm font-black text-[#067a46] transition hover:bg-[#f0fdf6]"
                    >
                      {isPasswordVisible ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#10231a]">Confirm password</span>
                  <input
                    type={isPasswordVisible ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className={inputClass}
                    placeholder="Confirm password"
                  />
                </label>

                <button
                  type="submit"
                  disabled={isSaving}
                  className={primaryButtonClass}
                >
                  {isSaving ? 'Creating access...' : 'Create Staff Access'}
                </button>
              </>
            ) : (
              <Link
                to="/sign-in"
                className={primaryButtonClass}
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
