import { Link } from 'react-router-dom'
import fallbackLogo from '../assets/player-feedback-logo.png'

const terms = [
  ['Use of the service', 'Player Feedback is provided for football clubs and authorised staff to manage assessments, notes, communications, teams, and related administration. Users must keep access details secure and use the service only for legitimate club purposes.'],
  ['Club responsibility', 'Each club is responsible for the accuracy, fairness, and lawful use of the data it enters. Clubs must make sure staff have permission to access player, parent, and team information.'],
  ['Parent communications', 'Email tools are provided to support club communication. Clubs are responsible for checking message content, recipient details, and sender details before sending.'],
  ['Voice notes', 'Voice notes are for short term coaching context. They must not include unnecessary sensitive information and are scheduled for deletion after 2 weeks.'],
  ['Archived players', 'Archived players are hidden from active lists and scheduled for deletion after 3 months unless restored before the deletion date.'],
  ['Acceptable use', 'Users must not upload unlawful, abusive, discriminatory, unsafe, or irrelevant content. Accounts may be suspended where misuse, security risk, or non-payment affects the service.'],
  ['Availability', 'We aim to keep the platform reliable, secure, and useful. Maintenance, third party outages, browser issues, or network problems may affect access from time to time.'],
  ['Changes', 'The service and these terms may be updated as features, legal requirements, or operational needs change. Continued use means the current terms apply.'],
]

export function TermsPage() {
  return (
    <main className="min-h-screen bg-[#030603] text-white">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[#071008]" />
      </div>

      <div className="relative mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/login" className="flex items-center gap-3">
            <img src={fallbackLogo} alt="Player Feedback" className="h-11 w-11 rounded-lg object-contain" />
            <span className="text-lg font-black tracking-tight">Player Feedback</span>
          </Link>
          <nav className="flex flex-wrap gap-3 text-sm font-bold text-slate-300">
            <Link to="/login" className="hover:text-white">Main page</Link>
            <Link to="/gdpr" className="hover:text-white">GDPR</Link>
          </nav>
        </header>

        <section className="py-10">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d8ff2f]">Terms</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-5xl">Terms of Service</h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-slate-300">
            These terms set out how clubs, coaches, administrators, and authorised users may use Player Feedback. They are written for normal club use and should be read with the GDPR and Data Protection Notice.
          </p>
          <p className="mt-3 text-sm font-semibold text-slate-400">Last updated: 11 May 2026</p>
        </section>

        <div className="grid gap-4">
          {terms.map(([title, copy]) => (
            <section key={title} className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur sm:p-6">
              <h2 className="text-2xl font-black">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">{copy}</p>
            </section>
          ))}

          <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur sm:p-6">
            <h2 className="text-2xl font-black">Support and disputes</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              Clubs should raise operational issues through their workspace administrator. Any legal, billing, or data protection issue should be raised promptly so it can be reviewed and handled fairly.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
