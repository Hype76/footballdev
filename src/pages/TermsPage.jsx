import { Link } from 'react-router-dom'
import fallbackLogo from '../assets/football-player-logo.png'

const terms = [
  ['Use of the service', 'Football Player is provided for football clubs and authorised staff to manage assessments, notes, communications, teams, and related administration. Users must keep access details secure and use the service only for legitimate club purposes.'],
  ['Club responsibility', 'Each club is responsible for the accuracy, fairness, and lawful use of the data it enters. Clubs must make sure staff have permission to access player, parent, and team information.'],
  ['Parent communications', 'Email tools are provided to support club communication. Clubs are responsible for checking message content, recipient details, and sender details before sending.'],
  ['Voice notes', 'Voice notes are for short term coaching context. They must not include unnecessary sensitive information and are scheduled for deletion after 2 weeks.'],
  ['Archived players', 'Archived players are hidden from active lists and scheduled for deletion after 3 months unless restored before the deletion date.'],
  ['Acceptable use', 'Users must not upload unlawful, abusive, discriminatory, unsafe, or irrelevant content. Accounts may be suspended where misuse, security risk, or non-payment affects the service.'],
  ['Availability', 'We aim to keep the platform reliable, secure, and useful. Maintenance, third party outages, browser issues, or network problems may affect access from time to time.'],
  ['Changes', 'The service and these terms may be updated as features, legal requirements, or operational needs change. Continued use means the current terms apply.'],
]

export function TermsPage() {
  const sectionClass = 'rounded-lg border border-slate-200 bg-white p-5 sm:p-6'

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/login" className="flex items-center gap-3">
            <img src={fallbackLogo} alt="Football Player" className="h-11 w-11 rounded-lg bg-slate-950 object-contain p-1" />
            <span className="text-lg font-black tracking-tight">Football Player</span>
          </Link>
          <nav className="flex flex-wrap gap-3 text-sm font-bold text-slate-600">
            <Link to="/login" className="hover:text-slate-950">Main page</Link>
            <Link to="/gdpr" className="hover:text-slate-950">GDPR</Link>
          </nav>
        </header>

        <section className="py-10">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Terms</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-5xl">Terms of Service</h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-slate-700">
            These terms set out how clubs, coaches, administrators, and authorised users may use Football Player. They are written for normal club use and should be read with the GDPR and Data Protection Notice.
          </p>
          <p className="mt-3 text-sm font-semibold text-slate-500">Last updated: 11 May 2026</p>
        </section>

        <div className="grid gap-4">
          {terms.map(([title, copy]) => (
            <section key={title} className={sectionClass}>
              <h2 className="text-2xl font-black">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">{copy}</p>
            </section>
          ))}

          <section className={sectionClass}>
            <h2 className="text-2xl font-black">Support and disputes</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Clubs should raise operational issues through their workspace administrator. Any legal, billing, or data protection issue should be raised promptly so it can be reviewed and handled fairly.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
