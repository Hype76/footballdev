import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7faf8] px-4 py-10 text-[#101828]">
      <div className="w-full max-w-xl rounded-lg border border-[#d7e5dc] bg-white p-8 text-center shadow-xl shadow-[#047857]/10">
        <p className="text-sm font-black uppercase tracking-[0.24em] text-[#047857]">404</p>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-[#101828]">Page not found</h1>
        <p className="mt-4 text-sm font-semibold leading-6 text-[#4b5f55]">
          This football workspace route does not exist. Return to the club board and continue from the next real action.
        </p>
        <Link
          to="/"
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46]"
        >
          Go to workspace
        </Link>
      </div>
    </main>
  )
}
