import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-player-logo.png'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { supabase } from '../lib/supabase-client.js'
import { assertPasswordPolicy, PASSWORD_MIN_LENGTH, PASSWORD_POLICY_SUMMARY } from '../lib/password-policy.js'

const inputClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const primaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'

export function ClubOwnerInvitePage() {
  const { token: legacyToken } = useParams()
  const [token] = useState(() => {
    const hashParameters = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const fragmentToken = hashParameters.get('token') || ''

    if (fragmentToken) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }

    return fragmentToken || legacyToken || ''
  })
  const navigate = useNavigate()
  const [invite, setInvite] = useState(null)
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
        const response = await fetch('/.netlify/functions/get-club-owner-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const result = await response.json().catch(() => ({}))

        if (!response.ok || result.success === false) {
          throw new Error(result.message || 'Club invite could not be loaded.')
        }

        if (isCurrent) {
          setInvite(result.invite)
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

    try {
      assertPasswordPolicy(password)
    } catch (error) {
      setErrorMessage(error.message)
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.')
      return
    }

    setIsSaving(true)

    try {
      async function submitAcceptance(accessToken = '') {
        const headers = { 'Content-Type': 'application/json' }

        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`
        }

        const response = await fetch('/.netlify/functions/create-club-owner-account', {
          method: 'POST',
          headers,
          body: JSON.stringify({ token, password: accessToken ? undefined : password }),
        })

        return { response, result: await response.json().catch(() => ({})) }
      }

      let { response, result } = await submitAcceptance()

      if (!response.ok && result.code === 'existing_account_authentication_required') {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: invite.invitedEmail,
          password,
        })

        if (signInError || !signInData.session?.access_token) {
          throw new Error('Sign in with the invited account password to continue.')
        }

        ;({ response, result } = await submitAcceptance(signInData.session.access_token))
      }

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Club admin account could not be created.')
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: result.email || invite.invitedEmail,
        password,
      })

      if (signInError) {
        setSignInEmail(result.email || invite.invitedEmail)
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
            Confirm the invited account and create secure club admin access.
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
                    <div className={`${inputClass} cursor-not-allowed`} aria-label="Invited login email">
                      {invite.invitedEmail}
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-black text-[#101828]">Create password</span>
                    <div className="flex rounded-lg border border-[#d7e5dc] bg-[#f7faf8] focus-within:border-[#047857] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#bbf7d0]">
                      <input
                        type={isPasswordVisible ? 'text' : 'password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        minLength={PASSWORD_MIN_LENGTH}
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
                      minLength={PASSWORD_MIN_LENGTH}
                      autoComplete="new-password"
                      className={inputClass}
                      placeholder="Confirm password"
                    />
                  </label>

                  <p className="text-sm font-semibold leading-6 text-[#4b5f55]">{PASSWORD_POLICY_SUMMARY}</p>

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
              <p>The invitation is locked to the intended account email.</p>
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
