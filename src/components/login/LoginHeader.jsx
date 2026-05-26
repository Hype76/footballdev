import { useEffect, useState } from 'react'
import InstallAppButton from '../pwa/InstallAppButton.jsx'

const navItems = [
  ['/', 'Home'],
  ['/features', 'Features'],
  ['/parents', 'Parents'],
  ['/pricing', 'Pricing'],
]

const mobileNavLabelStyle = {
  lineHeight: 1,
  overflowWrap: 'normal',
  whiteSpace: 'nowrap',
  wordBreak: 'keep-all',
}

const emptyContactForm = {
  email: '',
  message: '',
  name: '',
  phone: '',
}

function ContactUsModal({ isOpen, isSubmitting, message, errorMessage, formData, onCancel, onChange, onSubmit }) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#10231a]/45 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-us-title"
        className="relative w-full max-w-xl rounded-lg border border-[#bddcca] bg-white p-5 text-[#10231a] shadow-xl shadow-[#10231a]/10 sm:p-6"
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          title={isSubmitting ? 'Please wait while your message is sent.' : 'Close this window'}
          aria-label="Close this window"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#bddcca] bg-[#f6fbf8] text-sm font-bold text-[#456653] transition hover:border-[#20a464] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          X
        </button>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Contact us</p>
        <h2 id="contact-us-title" className="mt-3 pr-12 text-2xl font-black tracking-tight text-[#10231a]">Tell us about your club</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-[#456653]">
          Share the number of teams, who needs access, and what is currently slowing the football week down.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#10231a]">Name *</span>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={onChange}
              required
              autoComplete="name"
              className="min-h-12 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#10231a]">Email *</span>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={onChange}
              required
              autoComplete="email"
              className="min-h-12 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#10231a]">Phone Number</span>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={onChange}
              autoComplete="tel"
              className="min-h-12 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#10231a]">Message</span>
            <textarea
              name="message"
              value={formData.message}
              onChange={onChange}
              rows={5}
              className="min-h-32 w-full resize-y rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
            />
          </label>

          {errorMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {errorMessage}
            </div>
          ) : null}

          {message ? (
            <div className="rounded-lg border border-[#bddcca] bg-[#f0fdf6] px-4 py-3 text-sm font-semibold text-[#05603a]">
              {message}
            </div>
          ) : null}

          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your message is sent.' : undefined}
              onClick={onCancel}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-5 py-3 text-sm font-bold text-[#10231a] transition hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your message is sent.' : undefined}
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#067a46]/20 transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function LoginHeader({ logo }) {
  const [contactFormData, setContactFormData] = useState(emptyContactForm)
  const [contactErrorMessage, setContactErrorMessage] = useState('')
  const [contactMessage, setContactMessage] = useState('')
  const [isContactModalOpen, setIsContactModalOpen] = useState(false)
  const [isContactSubmitting, setIsContactSubmitting] = useState(false)

  const openContactModal = () => {
    setContactErrorMessage('')
    setContactMessage('')
    setIsContactModalOpen(true)
  }

  const closeContactModal = () => {
    if (isContactSubmitting) {
      return
    }

    setIsContactModalOpen(false)
  }

  useEffect(() => {
    const handleOpenContactModal = () => {
      setContactErrorMessage('')
      setContactMessage('')
      setIsContactModalOpen(true)
    }

    window.addEventListener('football-player:open-contact', handleOpenContactModal)

    return () => {
      window.removeEventListener('football-player:open-contact', handleOpenContactModal)
    }
  }, [])

  const handleContactChange = (event) => {
    const { name, value } = event.target
    setContactFormData((current) => ({
      ...current,
      [name]: value,
    }))
    setContactErrorMessage('')
    setContactMessage('')
  }

  const handleContactSubmit = async (event) => {
    event.preventDefault()
    setIsContactSubmitting(true)
    setContactErrorMessage('')
    setContactMessage('')

    try {
      const response = await fetch('/.netlify/functions/send-contact-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...contactFormData,
          sourcePath: `${window.location.pathname}${window.location.search}`,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Your message could not be sent.')
      }

      setContactFormData(emptyContactForm)
      setContactMessage('Message sent. We will reply as soon as possible.')
    } catch (error) {
      console.error(error)
      setContactErrorMessage(error.message || 'Your message could not be sent.')
    } finally {
      setIsContactSubmitting(false)
    }
  }

  return (
    <>
      <header className="border-b border-[#bddcca] bg-white/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-[#10231a] shadow-sm shadow-[#067a46]/5 backdrop-blur sm:px-6 sm:py-4 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <a href="/" className="flex min-w-0 items-center gap-3 lg:order-1">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#bddcca] bg-[#10231a] sm:h-16 sm:w-16">
              <img src={logo} alt="Football Player" className="h-full w-full object-contain p-1" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-black tracking-tight sm:text-xl">Football Player</p>
              <p className="hidden truncate text-xs font-semibold text-[#456653] min-[420px]:block sm:text-sm">Football club management software</p>
            </div>
          </a>
          <div className="flex items-center gap-2 lg:order-3">
            <button
              type="button"
              onClick={openContactModal}
              className="hidden min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-black text-[#10231a] transition hover:bg-[#f0fdf6] sm:inline-flex"
            >
              Contact Us
            </button>
            <a
              href="/sign-in"
              className="hidden min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#067a46]/20 transition hover:bg-[#05603a] sm:inline-flex"
            >
              Login
            </a>
            <InstallAppButton
              wrapperClassName="lg:hidden"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-3 py-2 text-xs font-black text-[#10231a] sm:min-h-11 sm:px-4 sm:py-3 sm:text-sm"
            />
          </div>
          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="rounded-lg px-3 py-2 text-sm font-bold text-[#456653] transition hover:bg-[#f0fdf6] hover:text-[#10231a]"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <nav className="fixed inset-x-2 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex items-center rounded-lg border border-[#bddcca] bg-white p-1.5 shadow-lg shadow-[#10231a]/10 sm:inset-x-6 lg:hidden">
        <div className="grid w-full grid-cols-5 gap-1">
          {navItems.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="inline-flex min-h-12 min-w-0 items-center justify-center rounded-lg px-1 py-2 text-center text-[11px] font-black leading-none text-[#456653] transition hover:bg-[#f0fdf6] hover:text-[#10231a] min-[390px]:text-xs"
            >
              <span className="block" style={mobileNavLabelStyle}>{label}</span>
            </a>
          ))}
          <a
            href="/sign-in"
            className="inline-flex min-h-12 min-w-0 items-center justify-center rounded-lg bg-[#067a46] px-1 py-2 text-center text-[11px] font-black leading-none text-white transition hover:bg-[#05603a] min-[390px]:text-xs"
          >
            <span className="block" style={mobileNavLabelStyle}>Login</span>
          </a>
        </div>
      </nav>
      <ContactUsModal
        isOpen={isContactModalOpen}
        isSubmitting={isContactSubmitting}
        message={contactMessage}
        errorMessage={contactErrorMessage}
        formData={contactFormData}
        onCancel={closeContactModal}
        onChange={handleContactChange}
        onSubmit={handleContactSubmit}
      />
    </>
  )
}
