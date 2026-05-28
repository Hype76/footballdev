import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-player-logo.png'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { supabase } from '../lib/supabase-client.js'

const inputClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const primaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'

export function ClubOwnerInvitePage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [invite, setInvite] = useState(null)
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [signInEmail, setSignInEmail] = useState('')

  useEffect(() => {
    let isCurrent = true

    async function loadInvite() {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const response = await fetch(`/.netlify/functions/get-club-owner-invite?token=${encodeURIComponent(token || '')}`)
        const result = await response.json().catch(() => ({}))

        if (!response.ok || result.success === false) {
          throw new Error(result.message || 'Club invite could not be loaded.')
        }

        if (isCurrent) {
          setInvite(result.invite)
          setEmail(result.invite?.invitedEmail || '')
        }
      } catch (error) {
        console.error(error)

        if (isCurrent) {
          setInvite(null)
          setErrorMessage(error.message || 'Club invite could not be loaded.')
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

    if (!invite) {
      setErrorMessage('Club invite could not be loaded.')
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
      const response = await fetch('/.netlify/functions/create-club-owner-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          email,
          password,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Club admin account could not be created.')
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: result.email || email,
        password,
      })

      if (signInError) {
        setSignInEmail(result.email || email)
        setSuccessMessage('Club admin access created. Sign in to continue setup.')
      } else {
        navigate(result.redirectPath || '/club-settings', { replace: true })
      }

      setPassword('')
      setConfirmPassword('')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club admin account could not be created.')
    } finally {
      setIsSaving(false)
    }
  }

  const logoUrl = invite?.logoUrl || fallbackLogo
  const isPaidInvite = invite?.billingMode !== 'unpaid'

  return (
    <main className="min-h-screen bg-[#f7faf8] px-4 py-10 text-[#101828]">
      <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-lg border border-[#d7e5dc] bg-white p-6 shadow-sm shadow-[#047857]/10 sm:p-8">
          <img
            src={logoUrl}
            alt=""
            className="mb-6 h-16 w-16 rounded-lg border border-[#d7e5dc] bg-white object-contain p-1 shadow-sm shadow-[#047857]/10"
          />
          <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Club setup invite</p>
          <h1 className="text-2xl font-black text-[#101828]">Create club admin access</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">
            Set the login email and password for this club workspace. This creates the first club admin account.
          </p>

          {isLoading ? (
            <p className="mt-6 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 text-sm font-semibold text-[#4b5f55]">
              Opening club invite...
            </p>
          ) : errorMessage && !invite ? (
            <div className="mt-6">
              <NoticeBanner title="Club invite not opened" message={errorMessage} />
            </div>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Workspace</p>
                <p className="text-sm font-black text-[#101828]">{invite.clubName || 'Football Player'}</p>
                <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
                  Plan: {invite.planName || 'Small Club'}
                </p>
              </div>

              {errorMessage ? <NoticeBanner title="Club access not created" message={errorMessage} /> : null}
              {successMessage ? (
                <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-bold text-[#065f46]">
                  {successMessage}
                </div>
              ) : null}

              {!successMessage ? (
                <>
                  <label className="block">
                    <span className="mb-2 block text-sm font-black text-[#101828]">Login email</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      autoComplete="email"
                      className={inputClass}
                      placeholder="club.admin@example.com"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-black text-[#101828]">Create password</span>
                    <div className="flex rounded-lg border border-[#d7e5dc] bg-[#f7faf8] focus-within:border-[#047857] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#bbf7d0]">
                      <input
                        type={isPasswordVisible ? 'text' : 'password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        minLength={8}
                        autoComplete="new-password"
                        className="min-h-11 min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-semibold text-[#101828] outline-none"
                        placeholder="Create a password"
                      />
                      <button
                        type="button"
                        onClick={() => setIsPasswordVisible((value) => !value)}
                        className="min-h-11 border-l border-[#d7e5dc] px-4 py-3 text-sm font-black text-[#047857] transition hover:bg-[#ecfdf5]"
                      >
                        {isPasswordVisible ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-black text-[#101828]">Confirm password</span>
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
                    {isSaving ? 'Creating access...' : 'Create Club Admin Access'}
                  </button>
                </>
              ) : (
                <Link
                  to={`/sign-in${signInEmail ? `?email=${encodeURIComponent(signInEmail)}` : ''}`}
                  className={primaryButtonClass}
                >
                  Go to sign in
                </Link>
              )}
            </form>
          )}
        </section>

        {!isLoading && invite ? (
          <aside className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Setup rules</p>
            <div className="mt-4 space-y-3 text-sm font-semibold leading-6 text-[#4b5f55]">
              <p>Use the email that should own this club workspace.</p>
              <p>The account created here becomes the club admin for settings, staff access, teams, and onboarding.</p>
              {isPaidInvite ? (
                <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
                  <p className="font-black text-[#101828]">Payments shown</p>
                  <p className="mt-1">After login, the club admin will be sent to billing before the workspace is fully active.</p>
                </div>
              ) : (
                <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-4">
                  <p className="font-black text-[#101828]">Payments hidden</p>
                  <p className="mt-1">This workspace is marked as unpaid, so billing setup is not shown during first access.</p>
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </main>
  )
}

export default ClubOwnerInvitePage
