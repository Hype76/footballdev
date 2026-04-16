import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl rounded-[32px] border border-white/70 bg-white p-8 text-center shadow-xl shadow-slate-900/8">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">404</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950">Page not found</h1>
        <p className="mt-4 text-sm leading-6 text-slate-500">
          The route does not exist in this starter. Head back to the dashboard and continue building from there.
        </p>
        <Link
          to="/dashboard"
          className="mt-8 inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  )
}
