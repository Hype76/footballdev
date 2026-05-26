import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fbfdfb] px-4 py-10 text-[#101828]">
      <div className="w-full max-w-xl rounded-lg border border-[#bfe8cd] bg-white p-8 text-center shadow-xl shadow-[#d7eadf]/80">
        <p className="text-sm font-black uppercase tracking-[0.24em] text-[#067a46]">404</p>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-[#101828]">Page not found</h1>
        <p className="mt-4 text-sm font-semibold leading-6 text-[#5f7468]">
          This football workspace route does not exist. Return to the club board and continue from the next real action.
        </p>
        <Link
          to="/"
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a]"
        >
          Go to workspace
        </Link>
      </div>
    </main>
  )
}
