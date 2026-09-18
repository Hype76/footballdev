import { Link } from 'react-router-dom'

export function UserFeedbackLinks({ onSelect }) {
  return <div className="flex flex-wrap gap-x-5 border-t border-[var(--border-color,#d7e5dc)] py-2">
    {[
      ['suggestion', 'Feedback & Suggestions'],
      ['bug', 'Report a Bug'],
    ].map(([type, label]) => <Link key={type} to={`/feedback/send?type=${type}`} onClick={onSelect} className="flex min-h-12 items-center gap-2 text-sm font-bold">
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        {type === 'bug' ? <><rect x="7" y="7" width="10" height="13" rx="5" /><path d="M9 7V4h6v3M3 10h4m10 0h4M3 15h4m10 0h4M5 21l3-3m8 0 3 3M12 8v11" /></> : <path d="M4 4h16v12H9l-5 4V4Z" />}
      </svg>{label}
    </Link>)}
  </div>
}
