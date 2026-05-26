import { Link } from 'react-router-dom'
import fallbackLogo from '../assets/football-player-logo.png'

const rights = [
  'Access a copy of personal data held in the platform.',
  'Correct inaccurate data where a club record is wrong.',
  'Ask for data to be deleted where the club no longer has a valid reason to keep it.',
  'Restrict or object to processing where UK GDPR gives that right.',
  'Request a portable copy of data where the right applies.',
]

const dataTypes = [
  ['Account data', 'Name, email address, role, club, team access, login identity, and account status.'],
  ['Player data', 'Player names, team details, development results, coach notes, parent contact details, and archive status.'],
  ['Communication data', 'Parent email history, template use, sender identity, recipient details, and audit records.'],
  ['Voice notes', 'Coach voice recordings and related metadata, kept for short term match or training follow-up.'],
  ['Technical data', 'Security logs, device information, session data, and service diagnostics needed to operate the platform.'],
]

const pageClass = 'min-h-screen bg-[#f8fafc] text-[#0f172a]'
const shellClass = 'mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8'
const headerClass = 'flex flex-col gap-4 rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-sm shadow-[#2563eb]/10 sm:flex-row sm:items-center sm:justify-between'
const logoClass = 'h-12 w-12 rounded-lg border border-[#cbd5e1] bg-[#0f172a] object-contain p-1'
const navClass = 'flex flex-wrap gap-3 text-sm font-black text-[#475569]'
const navLinkClass = 'rounded-lg border border-[#cbd5e1] bg-white px-4 py-2 transition hover:bg-[#eff6ff] hover:text-[#0f172a]'
const heroClass = 'my-6 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-5 shadow-sm shadow-[#2563eb]/10 sm:p-8'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]'
const sectionClass = 'rounded-lg border border-[#cbd5e1] bg-white p-5 shadow-sm shadow-[#2563eb]/10 sm:p-6'
const itemClass = 'rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4'
const paragraphClass = 'mt-3 text-sm font-semibold leading-7 text-[#475569]'

export function GdprPage() {
  return (
    <main className={pageClass}>
      <div className={shellClass}>
        <header className={headerClass}>
          <Link to="/login" className="flex items-center gap-3">
            <img src={fallbackLogo} alt="Football Player" className={logoClass} />
            <span>
              <span className="block text-lg font-black tracking-tight">Football Player</span>
              <span className="block text-sm font-semibold text-[#475569]">Football club management software</span>
            </span>
          </Link>
          <nav className={navClass}>
            <Link to="/login" className={navLinkClass}>Main page</Link>
            <Link to="/terms" className={navLinkClass}>Terms</Link>
          </nav>
        </header>

        <section className={heroClass}>
          <p className={eyebrowClass}>Privacy and GDPR</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-5xl">GDPR and Data Protection Notice</h1>
          <p className="mt-5 max-w-3xl text-base font-semibold leading-8 text-[#475569]">
            This page explains how Football Player supports clubs with responsible data handling under UK GDPR and the Data Protection Act 2018. Club administrators remain responsible for deciding what player, parent, and staff data is entered into their workspace.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              ['Club controlled', 'The club decides what player, parent, staff, and team information belongs in its workspace.'],
              ['Access scoped', 'Role, club, and team access keep records available only to the people who need them.'],
              ['Retention rules', 'Archived players and voice notes have deletion windows so old records do not drift forever.'],
            ].map(([title, copy]) => (
              <article key={title} className="rounded-lg border border-[#cbd5e1] bg-white p-4">
                <p className="text-sm font-black text-[#0f172a]">{title}</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">{copy}</p>
              </article>
            ))}
          </div>
          <p className="mt-5 text-sm font-semibold text-[#475569]">Last updated: 11 May 2026</p>
        </section>

        <div className="grid gap-5">
          <section className={sectionClass}>
            <h2 className="text-2xl font-black">Who controls the data</h2>
            <p className={paragraphClass}>
              Each club controls the player, parent, coach, team, development, and communication data it adds to the platform. Football Player provides the software used to store, secure, and process that data for the club.
            </p>
          </section>

          <section className={sectionClass}>
            <h2 className="text-2xl font-black">Data we process</h2>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {dataTypes.map(([title, copy]) => (
                <div key={title} className={itemClass}>
                  <p className="font-black text-[#0f172a]">{title}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">{copy}</p>
                </div>
              ))}
            </div>
          </section>

          <section className={sectionClass}>
            <h2 className="text-2xl font-black">Why data is used</h2>
            <p className={paragraphClass}>
              Data is used to run club workspaces, manage staff access, create player development records, send parent feedback, keep audit records, protect accounts, support billing, and maintain service reliability. Clubs should only add information that is relevant to football development, safeguarding responsibilities, communications, and platform administration.
            </p>
          </section>

          <section className={sectionClass}>
            <h2 className="text-2xl font-black">Retention and deletion</h2>
            <p className={paragraphClass}>
              Archived player records receive a scheduled deletion date 3 months after archiving. Voice recordings receive a scheduled deletion date 2 weeks after creation. Clubs can delete eligible records sooner through the workspace where tools are available.
            </p>
          </section>

          <section className={sectionClass}>
            <h2 className="text-2xl font-black">Your rights</h2>
            <ul className="mt-4 grid gap-3">
              {rights.map((right) => (
                <li key={right} className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold leading-6 text-[#475569]">
                  {right}
                </li>
              ))}
            </ul>
            <p className={paragraphClass}>
              Requests should normally be sent to the club that manages the workspace. If a request relates to platform operation, the club can contact Football Player support.
            </p>
          </section>

          <section className={sectionClass}>
            <h2 className="text-2xl font-black">Security</h2>
            <p className={paragraphClass}>
              Football Player uses account authentication, role based access, club and team scoping, audit logs, database security policies, and private storage links for voice recordings. Staff should keep passwords private and only grant access to people who need it for club duties.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
