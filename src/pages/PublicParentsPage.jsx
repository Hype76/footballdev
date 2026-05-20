import { useState } from 'react'
import fallbackLogo from '../assets/football-player-logo.png'
import parentPortalGoalPhoneImage from '../assets/parent-portal-goal-phone.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { buildParentAppUrl } from '../lib/app-origins.js'
import { supabase } from '../lib/supabase-client.js'

const parentCards = [
  ['One place for updates', 'Parents can see linked children, match day information, messages, and polls without searching through old chats.'],
  ['Controlled by the team', 'Team Admins set the appearance and the parent portal inherits it, so the experience feels like the club.'],
  ['Useful feedback', 'Reports focus on development, effort, and next steps instead of sending raw coach notes.'],
]

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

function ParentPortalLoginBox() {
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
    <section className="mt-6 rounded-lg border border-[#d8ff2f]/20 bg-[#0b130d]/95 p-4 shadow-2xl shadow-black/20 sm:p-5">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ff2f]">Parent login</p>
      <h2 className="mt-3 text-2xl font-black tracking-tight">Open the parent portal</h2>
      <p className="mt-2 text-sm leading-7 text-slate-300">
        Use the parent account you confirmed by email. You will be taken to the parent portal after login.
      </p>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-200">Email</span>
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
            className="min-h-12 w-full rounded-lg border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#d8ff2f]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-200">Password</span>
          <div className="flex rounded-lg border border-white/10 bg-[#101b12] focus-within:border-[#d8ff2f]">
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
              className="min-h-12 min-w-0 flex-1 rounded-l-lg bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={() => setIsPasswordVisible((current) => !current)}
              className="min-h-12 rounded-r-lg px-4 py-3 text-sm font-bold text-[#d8ff2f]"
            >
              {isPasswordVisible ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        {errorMessage ? <NoticeBanner title="Parent login not completed" message={errorMessage} /> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#d8ff2f] px-5 py-3 text-sm font-black text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Opening parent portal...' : 'Login to Parent Portal'}
        </button>

        <a
          href={buildParentAppUrl('/parent-login')}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-slate-200 transition hover:bg-white/[0.08]"
        >
          Forgot password
        </a>
      </form>
    </section>
  )
}

export function PublicParentsPage() {
  return (
    <main className="min-h-screen bg-[#061009] pb-[max(5.5rem,env(safe-area-inset-bottom))] text-white lg:pb-0">
      <LoginHeader logo={fallbackLogo} />
      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-12 lg:grid-cols-[0.85fr_1fr] lg:gap-8 lg:px-8 lg:py-16">
        <div className="order-2 flex items-start justify-center overflow-hidden rounded-lg border border-white/10 bg-[#07120a] p-4 sm:p-6 lg:sticky lg:top-28 lg:order-1 lg:max-h-[820px]">
          <img
            src={parentPortalGoalPhoneImage}
            alt="Mobile phone showing a Football Player goal celebration"
            className="max-h-[760px] min-h-[320px] w-full object-contain sm:min-h-[440px] lg:min-h-0"
          />
        </div>
        <div className="order-1 flex flex-col justify-center lg:order-2">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ff2f]">Parents portal</p>
          <h1 className="mt-4 text-3xl font-black leading-[1.04] tracking-tight min-[420px]:text-4xl sm:mt-5 sm:text-6xl">
            Better parent communication without extra coach admin.
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300 sm:mt-6 sm:text-lg sm:leading-8">
            Parents need clear updates. Coaches need less admin. The parent portal gives clubs a controlled, branded way to share what matters.
          </p>
          <ParentPortalLoginBox />
          <div className="mt-8 grid gap-4">
            {parentCards.map(([title, copy]) => (
              <article key={title} className="rounded-lg border border-white/10 bg-white/[0.045] p-4 sm:p-5">
                <h2 className="text-lg font-black sm:text-xl">{title}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-300">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
