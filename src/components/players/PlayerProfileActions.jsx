import { Link } from 'react-router-dom'
import { canDeletePlayer } from '../../lib/auth.js'

export function PlayerProfileActions({
  isDeleting,
  lastSection,
  lastTeam,
  onDeletePlayer,
  playerName,
  user,
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <Link
        to={`/assess-player/new?player=${encodeURIComponent(playerName)}&team=${encodeURIComponent(lastTeam)}&section=${encodeURIComponent(lastSection)}`}
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#2563eb] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1d4ed8]"
      >
        Add Development Record
      </Link>
      {canDeletePlayer(user) ? (
        <button
          type="button"
          disabled={isDeleting}
          title={isDeleting ? 'Please wait while this player is being deleted.' : undefined}
          onClick={onDeletePlayer}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-500/40 bg-red-600 px-5 py-3 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isDeleting ? 'Deleting...' : 'Delete This Player'}
        </button>
      ) : null}
    </div>
  )
}
