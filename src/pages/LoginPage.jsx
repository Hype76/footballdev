import { useState } from 'react'
import { useAuth } from '../lib/auth.js'

export function LoginPage() {
  const { signInWithMagicLink } = useAuth()
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSent, setIsSent] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      await signInWithMagicLink(email.trim())
      setIsSent(true)
    } catch (error) {
      console.error(error)
      setIsSent(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7f3] px-4 py-8 sm:px-6">
      <div className="grid w-full max-w-6xl overflow-hidden rounded-[32px] border border-[#dbe3d6] bg-white shadow-xl shadow-slate-900/5 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="bg-slate-950 px-6 py-8 text-white sm:px-10 sm:py-10">
          <div className="inline-flex min-h-11 items-center rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#d6dfd2]">
            Supabase Auth
          </div>

          <h1 className="mt-6 max-w-lg text-4xl font-bold tracking-tight sm:text-5xl">
            Coaching workflow access for teams, approvals, and player feedback.
          </h1>

          <p className="mt-5 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
            Enter your email to receive a magic link. Once authenticated, the app loads your Supabase profile and
            applies your role and team permissions automatically.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              ['Email only', 'magic link sign-in'],
              ['Profile sync', 'user record from Supabase'],
              ['Role aware', 'coach and manager visibility'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <p className="text-2xl font-bold">{value}</p>
                <p className="mt-2 text-sm text-slate-300">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-6 py-8 sm:px-10 sm:py-10">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Sign in</p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-950">Send a magic link</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Use the email attached to your coaching account. New accounts will get a default profile in the
            <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">users</code>
            table.
          </p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>

            {isSent ? (
              <div className="rounded-[20px] border border-[#dbe3d6] bg-[#eef3ea] px-4 py-3 text-sm font-medium text-[#46604a]">
                Magic link sent. Check your email.
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500"
            >
              {isSubmitting ? 'Sending...' : 'Send Magic Link'}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
