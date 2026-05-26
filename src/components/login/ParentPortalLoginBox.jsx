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
    <section className="rounded-lg border border-[#cbd5e1] bg-white p-4 text-[#0f172a] shadow-sm shadow-[#2563eb]/10 sm:p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Parent login</p>
      <h2 className="mt-3 text-2xl font-black tracking-tight">Open the parent portal</h2>
      <p className="mt-2 text-sm font-semibold leading-7 text-[#475569]">
        Use the parent account confirmed by email. You will be taken to the dedicated parent portal after login.
      </p>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-[#0f172a]">Email</span>
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
            className="min-h-12 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition placeholder:text-[#94a3b8] focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#bfdbfe]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-[#0f172a]">Password</span>
          <div className="flex overflow-hidden rounded-lg border border-[#cbd5e1] bg-[#f8fafc] focus-within:border-[#2563eb] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#bfdbfe]">
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
              className="min-h-12 min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none placeholder:text-[#94a3b8]"
            />
            <button
              type="button"
              onClick={() => setIsPasswordVisible((current) => !current)}
              className="min-h-12 border-l border-[#cbd5e1] px-4 py-3 text-sm font-bold text-[#2563eb] transition hover:bg-[#eff6ff]"
            >
              {isPasswordVisible ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        {errorMessage ? <NoticeBanner title="Parent login not completed" message={errorMessage} /> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#2563eb] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Opening parent portal...' : 'Login to Parent Portal'}
        </button>

        <a
          href={buildParentAppUrl('/parent-login')}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#cbd5e1] bg-white px-5 py-3 text-sm font-bold text-[#0f172a] transition hover:bg-[#f8fafc]"
        >
          Forgot password
        </a>
      </form>
    </section>
  )
}
