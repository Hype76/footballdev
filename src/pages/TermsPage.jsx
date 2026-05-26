import { Link } from 'react-router-dom'
import fallbackLogo from '../assets/football-player-logo.png'

const terms = [
  ['Use of the service', 'Football Player is provided for football clubs and authorised staff to manage development records, notes, communications, teams, and related administration. Users must keep access details secure and use the service only for legitimate club purposes.'],
  ['Club responsibility', 'Each club is responsible for the accuracy, fairness, and lawful use of the data it enters. Clubs must make sure staff have permission to access player, parent, and team information.'],
  ['Parent communications', 'Email tools are provided to support club communication. Clubs are responsible for checking message content, recipient details, and sender details before sending.'],
  ['Voice notes', 'Voice notes are for short term coaching context. They must not include unnecessary sensitive information and are scheduled for deletion after 2 weeks.'],
  ['Archived players', 'Archived players are hidden from active lists and scheduled for deletion after 3 months unless restored before the deletion date.'],
  ['Acceptable use', 'Users must not upload unlawful, abusive, discriminatory, unsafe, or irrelevant content. Accounts may be suspended where misuse, security risk, or non-payment affects the service.'],
  ['Availability', 'We aim to keep the platform reliable, secure, and useful. Maintenance, third party outages, browser issues, or network problems may affect access from time to time.'],
  ['Changes', 'The service and these terms may be updated as features, legal requirements, or operational needs change. Continued use means the current terms apply.'],
]

const pageClass = 'min-h-screen bg-[#fbfdfb] text-[#101828]'
const shellClass = 'mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8'
const headerClass = 'flex flex-col gap-4 rounded-lg border border-[#bfe8cd] bg-white p-4 shadow-sm shadow-[#d7eadf]/70 sm:flex-row sm:items-center sm:justify-between'
const logoClass = 'h-12 w-12 rounded-lg border border-[#bfe8cd] bg-[#101828] object-contain p-1'
const navClass = 'flex flex-wrap gap-3 text-sm font-black text-[#5f7468]'
const navLinkClass = 'rounded-lg border border-[#bfe8cd] bg-white px-4 py-2 transition hover:bg-[#f0fdf6] hover:text-[#101828]'
const heroClass = 'my-6 rounded-lg border border-[#b7efce] bg-[#f0fdf6] p-5 shadow-sm shadow-[#d7eadf]/70 sm:p-8'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#067a46]'
const sectionClass = 'rounded-lg border border-[#bfe8cd] bg-white p-5 shadow-sm shadow-[#d7eadf]/70 sm:p-6'
const paragraphClass = 'mt-3 text-sm font-semibold leading-7 text-[#5f7468]'

export function TermsPage() {
  return (
    <main className={pageClass}>
      <div className={shellClass}>
        <header className={headerClass}>
          <Link to="/login" className="flex items-center gap-3">
            <img src={fallbackLogo} alt="Football Player" className={logoClass} />
            <span>
              <span className="block text-lg font-black tracking-tight">Football Player</span>
              <span className="block text-sm font-semibold text-[#5f7468]">Football club management software</span>
            </span>
          </Link>
          <nav className={navClass}>
            <Link to="/login" className={navLinkClass}>Main page</Link>
            <Link to="/gdpr" className={navLinkClass}>GDPR</Link>
          </nav>
        </header>

        <section className={heroClass}>
          <p className={eyebrowClass}>Terms</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-5xl">Terms of Service</h1>
          <p className="mt-5 max-w-3xl text-base font-semibold leading-8 text-[#456653]">
            These terms set out how clubs, coaches, administrators, and authorised users may use Football Player. They are written for normal club use and should be read with the GDPR and Data Protection Notice.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              ['Football use', 'The service is for football club operations, player records, staff access, and parent communication.'],
              ['Club control', 'Each club is responsible for the data it enters and the people it gives access to.'],
              ['Practical records', 'Notes, messages, voice notes, and archived players should stay relevant to club work.'],
            ].map(([title, copy]) => (
              <article key={title} className="rounded-lg border border-[#b7efce] bg-white p-4">
                <p className="text-sm font-black text-[#101828]">{title}</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">{copy}</p>
              </article>
            ))}
          </div>
          <p className="mt-5 text-sm font-semibold text-[#5f7468]">Last updated: 11 May 2026</p>
        </section>

        <div className="grid gap-4">
          {terms.map(([title, copy]) => (
            <section key={title} className={sectionClass}>
              <h2 className="text-2xl font-black">{title}</h2>
              <p className={paragraphClass}>{copy}</p>
            </section>
          ))}

          <section className={sectionClass}>
            <h2 className="text-2xl font-black">Support and disputes</h2>
            <p className={paragraphClass}>
              Clubs should raise operational issues through their workspace administrator. Any legal, billing, or data protection issue should be raised promptly so it can be reviewed and handled fairly.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
