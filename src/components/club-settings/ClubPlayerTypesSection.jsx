import { useEffect, useState } from 'react'
import { deleteClubPlayerType, getClubPlayerTypes, saveClubPlayerType } from '../../lib/domain/club-player-types.js'

const emptyType = { name: '', canTraining: false, canFriendly: false, canCup: false, canLeague: false, chatGroup: 'none' }
const matchChoices = [
  ['canFriendly', 'Friendly matches'],
  ['canCup', 'Cup matches'],
  ['canLeague', 'League matches'],
]

export function ClubPlayerTypesSection({ user }) {
  const [types, setTypes] = useState([])
  const [draft, setDraft] = useState(null)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    getClubPlayerTypes(user.clubId)
      .then((rows) => { if (active) setTypes(rows) })
      .catch((loadError) => { if (active) setError(loadError.message || 'Player types could not be loaded.') })
    return () => { active = false }
  }, [user.clubId])

  const refresh = async () => setTypes(await getClubPlayerTypes(user.clubId))
  const save = async (event) => {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      await saveClubPlayerType(user, draft)
      await refresh()
      setDraft(null)
      setNotice('Player type saved.')
    } catch (saveError) {
      setError(saveError.message || 'Player type could not be saved.')
    } finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      await deleteClubPlayerType(user, removeTarget)
      await refresh()
      setRemoveTarget(null)
      setNotice('Player type removed.')
    } catch (removeError) {
      setError(removeError.code === '23503'
        ? 'Move players out of this type before removing it.'
        : removeError.message || 'Player type could not be removed.')
    } finally { setBusy(false) }
  }

  return <section aria-label="Player types" className="rounded-lg border border-[#d7e5dc] bg-white p-5">
    <h2 className="text-xl font-black">Player types</h2>
    <p className="mt-1 text-sm">Set which sessions and matches each type can join. Parents enter the chosen team chat community.</p>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="mt-3 text-sm text-green-700">{notice}</p> : null}
    <div className="mt-4 divide-y divide-[#d7e5dc]">
      {types.map((type) => <div key={type.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div><p className="font-bold">{type.name}</p><p className="text-sm text-[#4b5f55]">{[
          type.canTraining && 'Training', type.canFriendly && 'Friendly', type.canCup && 'Cup',
          type.canLeague && 'League', `Chat: ${type.chatGroup}`,
        ].filter(Boolean).join(' | ')}</p></div>
        {type.isDefault ? <span className="text-xs font-bold">Default</span>
          : <div className="flex gap-2"><button type="button" className="min-h-11 px-3 font-bold" onClick={() => setDraft({ ...type })}>Edit</button>
            <button type="button" className="min-h-11 px-3 font-bold text-red-700" onClick={() => setRemoveTarget(type)}>Remove</button></div>}
      </div>)}
    </div>
    {removeTarget ? <div className="mt-4 border-t pt-4"><p>Remove {removeTarget.name}? Players using it must be moved first.</p>
      <div className="mt-2 flex gap-3"><button type="button" disabled={busy} className="min-h-11 font-bold text-red-700" onClick={() => void remove()}>Confirm remove</button>
        <button type="button" disabled={busy} className="min-h-11 font-bold" onClick={() => setRemoveTarget(null)}>Cancel</button></div></div> : null}
    {!draft ? <button type="button" className="mt-4 min-h-11 font-bold text-[#047857]" onClick={() => setDraft({ ...emptyType })}>Add player type</button>
      : <form onSubmit={(event) => void save(event)} className="mt-4 space-y-4 border-t pt-4">
        <h3 className="font-bold">{draft.id ? 'Edit player type' : 'Add player type'}</h3>
        <label className="block text-sm font-bold">Name<input className="mt-1 min-h-11 w-full rounded border px-3" value={draft.name} maxLength={40} required onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <div className="flex flex-wrap gap-4">{[['canTraining', 'Training sessions'], ...matchChoices].map(([key, label]) =>
          <label key={key} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} />{label}</label>)}</div>
        <label className="block text-sm font-bold">Chat community<select className="mt-1 min-h-11 w-full rounded border px-3" value={draft.chatGroup} onChange={(event) => setDraft({ ...draft, chatGroup: event.target.value })}>
          <option value="none">No team chat</option><option value="team">Team chat</option><option value="training">Training-only chat</option><option value="match">Match-only chat</option>
        </select></label>
        <div className="flex gap-3"><button type="submit" disabled={busy} className="min-h-11 font-bold text-[#047857]">Save type</button>
          <button type="button" disabled={busy} className="min-h-11 font-bold" onClick={() => setDraft(null)}>Cancel</button></div>
      </form>}
  </section>
}
