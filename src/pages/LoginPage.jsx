import { useState } from 'react'
import fallbackLogo from '../assets/player-feedback-logo.png'
import InstallAppButton from '../components/pwa/InstallAppButton.jsx'
import { useAuth } from '../lib/auth.js'

const initialFormData = {
  email: '',
  password: '',
  clubName: '',
}

const pricingPlans = [
  {
    name: 'Individual',
    price: 'Free',
    priceLabel: 'No card needed',
    description: 'For one coach testing the basics before moving feedback online.',
    features: ['1 team', '5 players', '10 evaluations per month', 'Basic form only', 'No PDF export', 'No email sending'],
  },
  {
    name: 'Single Team',
    price: 9.99,
    description: 'For teams ready to send structured feedback to parents.',
    features: ['2 weeks trial included', 'Cancel anytime', '1 team', 'Up to 20 players', 'Unlimited evaluations', 'Email to parents', 'PDF export', 'Custom form fields', 'Basic logo branding'],
  },
  {
    name: 'Small Club',
    price: 24.99,
    description: 'For growing clubs needing staff access and oversight.',
    features: ['2 weeks trial included', 'Cancel anytime', 'Everything in Single Team', 'Up to 10 teams', 'Custom branding and themes', 'Staff roles with coach access', 'Optional approval workflow', 'Audit logs', 'Priority support'],
  },
  {
    name: 'Large Club',
    price: 'Contact us',
    description: 'For larger clubs that need more teams, onboarding, or custom support.',
    features: ['Custom setup', 'More than 10 teams', 'Custom branding and themes', 'Custom onboarding', 'Club-wide staff setup', 'Priority support', 'Custom limits agreed with you'],
  },
]

function formatPrice(plan, billingCycle) {
  if (typeof plan.price !== 'number') {
    return plan.price
  }

  const price = billingCycle === 'annual' ? plan.price * 10 : plan.price
  return `\u00a3${price.toFixed(2)}`
}

function formatPriceLabel(plan, billingCycle) {
  if (plan.priceLabel) {
    return plan.priceLabel
  }

  if (plan.price === 'Contact us') {
    return ''
  }

  if (typeof plan.price !== 'number') {
    return 'No card needed'
  }

  return billingCycle === 'annual' ? 'per year' : 'per month'
}

export function LoginPage() {
  const { authError, resetPassword, signInWithPassword, signUpWithClub } = useAuth()
  const [mode, setMode] = useState('login')
  const [formData, setFormData] = useState(initialFormData)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [billingCycle, setBillingCycle] = useState('monthly')
  const [localMessage, setLocalMessage] = useState('')
  const [localError, setLocalError] = useState('')

  const handleChange = (event) => {
    const { name, value } = event.target
    setLocalError('')
    setLocalMessage('')
    setFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleModeChange = (nextMode) => {
    setMode(nextMode)
    setLocalError('')
    setLocalMessage('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)
    setLocalError('')
    setLocalMessage('')

    try {
      if (mode === 'signup') {
        await signUpWithClub({
          email: formData.email.trim(),
          password: formData.password,
          clubName: formData.clubName.trim(),
        })
      } else {
        await signInWithPassword({
          email: formData.email.trim(),
          password: formData.password,
        })
      }
    } catch (error) {
      console.error(error)
      setLocalError(error.message || 'Authentication failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePasswordReset = async () => {
    setIsSubmitting(true)
    setLocalError('')
    setLocalMessage('')

    try {
      await resetPassword(formData.email)
      setLocalMessage('Password reset email sent if that account exists.')
    } catch (error) {
      console.error(error)
      setLocalError(error.message || 'Password reset failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#030603] text-white">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-[-10%] top-[-20%] h-[560px] w-[560px] rounded-full bg-[#d8ff2f]/18 blur-[100px]" />
        <div className="absolute bottom-[-25%] right-[-10%] h-[600px] w-[600px] rounded-full bg-[#1f8a47]/22 blur-[110px]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(216,255,47,0.05),transparent_35%,rgba(255,255,255,0.04))]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 rounded-[32px] border border-white/10 bg-white/[0.04] px-4 py-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[24px] border border-[#d8ff2f]/30 bg-black/50 shadow-lg shadow-[#d8ff2f]/10 sm:h-24 sm:w-24">
              <img src={fallbackLogo} alt="Player Feedback" className="h-full w-full object-contain p-1" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-black tracking-tight sm:text-xl">Player Feedback</p>
              <p className="truncate text-xs text-slate-400 sm:text-sm">Football trial and player feedback software</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-2 text-xs font-semibold text-[#d8ff2f] sm:flex">
            Built for football clubs
          </div>
          <InstallAppButton
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#d8ff2f]/30 bg-[#d8ff2f] px-4 py-3 text-sm font-black text-black transition hover:opacity-90"
            helpClassName="max-w-xs rounded-2xl border border-white/10 bg-black/50 px-3 py-2 text-xs font-semibold leading-5 text-slate-200"
          />
        </header>

        <div className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[1.08fr_0.92fr] lg:py-10">
          <section className="order-2 lg:order-1">
            <div className="inline-flex rounded-full border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-[#d8ff2f]">
              Built for football clubs
            </div>

            <h1 className="mt-6 max-w-2xl space-y-4 text-4xl font-black leading-[1.04] tracking-tight sm:text-5xl xl:text-6xl">
              <span className="flex items-start gap-4">
                <span className="shrink-0 text-[0.9em] leading-none text-[#d8ff2f]">{"\u2713"}</span>
                <span>Run trials properly.</span>
              </span>
              <span className="flex items-start gap-4">
                <span className="shrink-0 text-[0.9em] leading-none text-[#d8ff2f]">{"\u2713"}</span>
                <span>Track players clearly.</span>
              </span>
              <span className="flex items-start gap-4">
                <span className="shrink-0 text-[0.9em] leading-none text-[#d8ff2f]">{"\u2713"}</span>
                <span>Send feedback faster.</span>
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
              Player Feedback gives clubs one workspace for sessions, trialists, squad players, custom assessment
              forms, parent ready PDFs, staff roles, and activity history.
            </p>

            <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
              {[
                ['Sessions', 'Create match or training sessions and assess players from one queue.'],
                ['Players', 'Keep trial and squad histories separate, searchable, and easy to update.'],
                ['Feedback', 'Export scored reports or parent friendly email template PDFs.'],
              ].map(([title, copy]) => (
                <div key={title} className="rounded-[24px] border border-white/10 bg-white/[0.05] p-4 backdrop-blur">
                  <p className="text-sm font-bold text-white">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{copy}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 grid max-w-2xl gap-4 sm:grid-cols-2">
              <div className="rounded-[28px] border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 p-5">
                <p className="text-3xl font-black text-[#d8ff2f]">Controlled</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Staff see the teams, players, and tools their role allows.
                </p>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-white/[0.05] p-5">
                <p className="text-3xl font-black">Club branded</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Club logos are used inside the app and on exported feedback.
                </p>
              </div>
            </div>
          </section>

          <section className="order-1 lg:order-2">
            <div className="mx-auto w-full max-w-md rounded-[32px] border border-white/10 bg-[#0b130d]/90 p-5 shadow-2xl shadow-black/40 backdrop-blur sm:p-6">
              <div className="mx-auto mb-5 flex h-28 w-28 items-center justify-center overflow-hidden rounded-[30px] border border-[#d8ff2f]/30 bg-black/50 shadow-xl shadow-[#d8ff2f]/10 sm:h-32 sm:w-32">
                <img src={fallbackLogo} alt="Player Feedback" className="h-full w-full object-contain p-2" />
              </div>
              <div className="rounded-[26px] border border-[#d8ff2f]/15 bg-[linear-gradient(135deg,rgba(216,255,47,0.14),rgba(255,255,255,0.04))] p-5">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#d8ff2f]">
                  {mode === 'signup' ? 'Create account' : 'Secure login'}
                </p>
                <h2 className="mt-3 text-2xl font-black tracking-tight text-white">
                  {mode === 'signup' ? 'Start or join a club' : 'Open your workspace'}
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {mode === 'signup'
                    ? 'Create a club admin account, or sign up with an email already allocated by your club.'
                    : 'Use the email and password linked to your club access.'}
                </p>
              </div>

              <div className="mt-5 grid grid-cols-2 rounded-2xl border border-white/10 bg-black/20 p-1">
                <button
                  type="button"
                  onClick={() => handleModeChange('login')}
                  className={[
                    'min-h-11 rounded-xl px-4 py-3 text-sm font-bold transition',
                    mode === 'login' ? 'bg-[#d8ff2f] text-black' : 'text-slate-300 hover:text-white',
                  ].join(' ')}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('signup')}
                  className={[
                    'min-h-11 rounded-xl px-4 py-3 text-sm font-bold transition',
                    mode === 'signup' ? 'bg-[#d8ff2f] text-black' : 'text-slate-300 hover:text-white',
                  ].join(' ')}
                >
                  Sign Up
                </button>
              </div>

              <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                {mode === 'signup' ? (
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-slate-200">Club Name</span>
                    <input
                      type="text"
                      name="clubName"
                      value={formData.clubName}
                      onChange={handleChange}
                      placeholder="Leave blank if joining an existing club"
                      className="min-h-12 w-full rounded-2xl border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#d8ff2f]"
                    />
                  </label>
                ) : null}

                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-200">Email</span>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    autoComplete="email"
                    placeholder="you@club.com"
                    className="min-h-12 w-full rounded-2xl border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#d8ff2f]"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-200">Password</span>
                  <div className="flex rounded-2xl border border-white/10 bg-[#101b12] focus-within:border-[#d8ff2f]">
                    <input
                      type={isPasswordVisible ? 'text' : 'password'}
                      name="password"
                      value={formData.password}
                      onChange={handleChange}
                      required
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      placeholder="Enter password"
                      className="min-h-12 min-w-0 flex-1 rounded-l-2xl bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => setIsPasswordVisible((current) => !current)}
                      className="min-h-12 rounded-r-2xl px-4 py-3 text-sm font-bold text-[#d8ff2f]"
                    >
                      {isPasswordVisible ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>

                {localError || authError ? (
                  <div className="rounded-[20px] border border-[#7d2639] bg-[#35101c] px-4 py-3 text-sm font-semibold text-[#ffc2cf]">
                    {localError || authError}
                  </div>
                ) : null}

                {localMessage ? (
                  <div className="rounded-[20px] border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-3 text-sm font-semibold text-[#d8ff2f]">
                    {localMessage}
                  </div>
                ) : null}

                <div className="space-y-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#d8ff2f] px-5 py-3 text-sm font-black text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Login'}
                  </button>
                  {mode === 'login' ? (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={handlePasswordReset}
                      className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Forgot password
                    </button>
                  ) : null}
                </div>
              </form>
            </div>
          </section>
        </div>

        <section className="pb-8">
          <div className="flex flex-col gap-4 rounded-[32px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur sm:p-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d8ff2f]">Pricing</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Simple plans for growing clubs</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Start small, then move to a paid plan when your club needs more structure. Annual billing for paid plans is charged at 10 months.
              </p>
            </div>
            <div className="grid w-full max-w-xs grid-cols-2 rounded-2xl border border-white/10 bg-black/20 p-1">
              {[
                ['monthly', 'Monthly'],
                ['annual', 'Annual'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBillingCycle(key)}
                  className={[
                    'min-h-11 rounded-xl px-4 py-3 text-sm font-bold transition',
                    billingCycle === key ? 'bg-[#d8ff2f] text-black' : 'text-slate-300 hover:text-white',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {pricingPlans.map((plan) => {
              const priceLabel = formatPriceLabel(plan, billingCycle)

              return (
                <div
                  key={plan.name}
                  className="relative flex flex-col rounded-[30px] border border-white/10 bg-[#0b130d]/90 p-5 shadow-xl shadow-black/20 backdrop-blur"
                >
                  {plan.name === 'Small Club' ? (
                    <span className="absolute right-5 top-5 whitespace-nowrap rounded-full border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-3 py-1 text-xs font-bold text-[#d8ff2f]">
                      Popular
                    </span>
                  ) : null}
                  <div className="min-h-[132px] pr-16">
                    <p className="text-lg font-black text-white">{plan.name}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{plan.description}</p>
                  </div>
                  <div className="min-h-[88px]">
                    <span
                      className={[
                        'whitespace-nowrap font-black text-white',
                        plan.price === 'Contact us' ? 'text-[2rem] leading-none 2xl:text-4xl' : 'text-4xl',
                      ].join(' ')}
                    >
                      {formatPrice(plan, billingCycle)}
                    </span>
                    {priceLabel ? <span className="ml-2 text-sm font-semibold text-slate-400">{priceLabel}</span> : null}
                    {typeof plan.price === 'number' && billingCycle === 'annual' ? (
                      <p className="mt-2 text-xs font-semibold text-[#d8ff2f]">2 months free compared with monthly</p>
                    ) : null}
                  </div>
                  <ul className="mt-6 grow space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-3 text-sm leading-6 text-slate-300">
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#d8ff2f]" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => setMode('signup')}
                    className={[
                      'mt-6 inline-flex min-h-12 items-center justify-center rounded-2xl px-5 py-3 text-sm font-black transition',
                      plan.name === 'Small Club'
                        ? 'bg-[#d8ff2f] text-black hover:opacity-90'
                        : 'border border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]',
                    ].join(' ')}
                  >
                    {plan.price === 'Free' ? 'Start Free' : 'Choose Plan'}
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
