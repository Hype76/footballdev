import { APP_DOWNLOAD_LINKS } from '../../lib/app-download-links.js'

export function SignupAppLinks({ role }) {
  const app = APP_DOWNLOAD_LINKS[role]
  return (
    <section className="space-y-2 border-t border-[#d7e5dc] pt-4" aria-label={app.name}>
      <h2 className="text-lg font-bold">Get the {role === 'coach' ? 'Coach' : 'Parent'} app</h2>
      <p className="text-sm">Use the same email and password when you sign in.</p>
      <div className="flex flex-wrap gap-x-5">
        <a className="inline-flex min-h-11 items-center font-bold underline" href={app.apple}>Download for iPhone</a>
        <a className="inline-flex min-h-11 items-center font-bold underline" href={app.android}>Download for Android</a>
      </div>
    </section>
  )
}
