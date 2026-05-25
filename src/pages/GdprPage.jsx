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
  ['Player data', 'Player names, team details, assessment results, coach notes, parent contact details, and archive status.'],
  ['Communication data', 'Parent email history, template use, sender identity, recipient details, and audit records.'],
  ['Voice notes', 'Coach voice recordings and related metadata, kept for short term match or training follow-up.'],
  ['Technical data', 'Security logs, device information, session data, and service diagnostics needed to operate the platform.'],
]

export function GdprPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#f8fafc_0%,#ecfdf5_100%)]" />
      </div>

      <div className="relative mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/login" className="flex items-center gap-3">
            <img src={fallbackLogo} alt="Football Player" className="h-11 w-11 rounded-xl bg-slate-950 object-contain p-1" />
            <span className="text-lg font-black tracking-tight">Football Player</span>
          </Link>
          <nav className="flex flex-wrap gap-3 text-sm font-bold text-slate-600">
            <Link to="/login" className="hover:text-slate-950">Main page</Link>
            <Link to="/terms" className="hover:text-slate-950">Terms</Link>
          </nav>
        </header>

        <section className="py-10">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Privacy and GDPR</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-5xl">GDPR and Data Protection Notice</h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-slate-700">
            This page explains how Football Player supports clubs with responsible data handling under UK GDPR and the Data Protection Act 2018. Club administrators remain responsible for deciding what player, parent, and staff data is entered into their workspace.
          </p>
          <p className="mt-3 text-sm font-semibold text-slate-500">Last updated: 11 May 2026</p>
        </section>

        <div className="grid gap-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/80 sm:p-6">
            <h2 className="text-2xl font-black">Who controls the data</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Each club controls the player, parent, coach, team, assessment, and communication data it adds to the platform. Football Player provides the software used to store, secure, and process that data for the club.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/80 sm:p-6">
            <h2 className="text-2xl font-black">Data we process</h2>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {dataTypes.map(([title, copy]) => (
                <div key={title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="font-black text-slate-950">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/80 sm:p-6">
            <h2 className="text-2xl font-black">Why data is used</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Data is used to run club workspaces, manage staff access, create player assessments, send parent feedback, keep audit records, protect accounts, support billing, and maintain service reliability. Clubs should only add information that is relevant to football development, safeguarding responsibilities, communications, and platform administration.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/80 sm:p-6">
            <h2 className="text-2xl font-black">Retention and deletion</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Archived player records receive a scheduled deletion date 3 months after archiving. Voice recordings receive a scheduled deletion date 2 weeks after creation. Clubs can delete eligible records sooner through the workspace where tools are available.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/80 sm:p-6">
            <h2 className="text-2xl font-black">Your rights</h2>
            <ul className="mt-4 grid gap-3">
              {rights.map((right) => (
                <li key={right} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                  {right}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              Requests should normally be sent to the club that manages the workspace. If a request relates to platform operation, the club can contact Football Player support.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/80 sm:p-6">
            <h2 className="text-2xl font-black">Security</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Football Player uses account authentication, role based access, club and team scoping, audit logs, database security policies, and private storage links for voice recordings. Staff should keep passwords private and only grant access to people who need it for club duties.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
