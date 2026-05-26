import { useState } from 'react'
import { NoticeBanner } from '../ui/NoticeBanner.jsx'
import { buildParentAppUrl } from '../../lib/app-origins.js'
import { supabase } from '../../lib/supabase-client.js'

function getFriendlyLoginError(error) {
  const rawMessage = String(error?.message ?? '').trim()
  const normalizedMessage = rawMessage.toLowerCase()

  if (normalizedMessage.includes('invalid login credentials')) {
    return 'Email or password is incorrect.'
  }

  if (normalizedMessage.includes('email not confirmed')) {
    return 'Confirm your email address first, then log in here.'
  }

  if (normalizedMessage.includes('auth session missing') || normalizedMessage.includes('session')) {
    return 'Email or password is incorrect.'
  }

  return 'Parent login could not be completed. Check your details and try again.'
}

export function ParentPortalLoginBox() {
  const [email, setEmail] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [password, setPassword] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)
    setErrorMessage('')

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        throw error
      }

      const accessToken = data?.session?.access_token || ''
      const refreshToken = data?.session?.refresh_token || ''

      if (!accessToken || !refreshToken) {
        throw new Error('Parent login session was not created. Try again.')
      }

      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})

      const hashParams = new URLSearchParams({
        type: 'parent_portal_login',
        access_token: accessToken,
        refresh_token: refreshToken,
      })

      window.location.assign(`${buildParentAppUrl('/parent-login')}#${hashParams.toString()}`)
    } catch (error) {
      console.error(error)
      setErrorMessage(getFriendlyLoginError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="rounded-lg border border-[#b7efce] bg-white p-4 text-[#101828] shadow-sm shadow-[#d7eadf]/70 sm:p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Parent login</p>
      <h2 className="mt-3 text-2xl font-black tracking-tight">Open the parent portal</h2>
      <p className="mt-2 text-sm font-semibold leading-7 text-[#5f7468]">
        Use the parent account confirmed by email. You will be taken to the dedicated parent portal after login.
      </p>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-[#101828]">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setErrorMessage('')
            }}
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="min-h-12 w-full rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#8da59a] focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-[#101828]">Password</span>
          <div className="flex overflow-hidden rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] focus-within:border-[#20a464] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#d7f8e5]">
            <input
              type={isPasswordVisible ? 'text' : 'password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setErrorMessage('')
              }}
              required
              autoComplete="current-password"
              placeholder="Enter password"
              className="min-h-12 min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-semibold text-[#101828] outline-none placeholder:text-[#8da59a]"
            />
            <button
              type="button"
              onClick={() => setIsPasswordVisible((current) => !current)}
              className="min-h-12 border-l border-[#bfe8cd] px-4 py-3 text-sm font-bold text-[#067a46] transition hover:bg-[#f0fdf6]"
            >
              {isPasswordVisible ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        {errorMessage ? <NoticeBanner title="Parent login not completed" message={errorMessage} /> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Opening parent portal...' : 'Login to Parent Portal'}
        </button>

        <a
          href={buildParentAppUrl('/parent-login')}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#bfe8cd] bg-white px-5 py-3 text-sm font-bold text-[#101828] transition hover:bg-[#f0fdf6]"
        >
          Forgot password
        </a>
      </form>
    </section>
  )
}
