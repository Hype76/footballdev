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
    <section className="border border-slate-200 bg-white p-4 text-slate-950 sm:p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Parent login</p>
      <h2 className="mt-3 text-2xl font-black tracking-tight">Open the parent portal</h2>
      <p className="mt-2 text-sm leading-7 text-slate-600">
        Use the parent account you confirmed by email. You will be taken to the parent portal after login.
      </p>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-950">Email</span>
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
            className="min-h-12 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-950">Password</span>
          <div className="flex border border-slate-200 bg-slate-50 focus-within:border-emerald-600 focus-within:bg-white focus-within:ring-2 focus:ring-emerald-100">
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
              className="min-h-12 min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={() => setIsPasswordVisible((current) => !current)}
              className="min-h-12 border-l border-slate-200 px-4 py-3 text-sm font-bold text-emerald-700 transition hover:bg-emerald-50"
            >
              {isPasswordVisible ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        {errorMessage ? <NoticeBanner title="Parent login not completed" message={errorMessage} /> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex min-h-12 w-full items-center justify-center bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Opening parent portal...' : 'Login to Parent Portal'}
        </button>

        <a
          href={buildParentAppUrl('/parent-login')}
          className="inline-flex min-h-11 w-full items-center justify-center border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50"
        >
          Forgot password
        </a>
      </form>
    </section>
  )
}
