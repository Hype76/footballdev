import { useMemo, useState } from 'react'
import { confirmDataTransfer, downloadDataTransferErrorReport, requestPitcheroImport } from '../../lib/domain/data-transfer.js'

const control = 'min-h-11 w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 text-sm text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--accent)]'
const button = 'min-h-11 rounded-lg border border-[var(--border-color)] px-4 text-sm font-bold text-[var(--text-primary)] disabled:opacity-50'
const secondary = 'text-sm leading-6 text-[var(--text-muted)]'

function quantity(count, label) {
  return `${count} ${label}${count === 1 ? '' : 's'}`
}

export function PitcheroChecklist({ warnings = [] }) {
  return (
    <details className="mt-4 border-t border-[var(--border-color)] pt-2">
      <summary className="flex min-h-11 cursor-pointer items-center font-bold">Follow-up checklist ({warnings.length})</summary>
      {warnings.length ? (
        <ul className="max-h-72 divide-y divide-[var(--border-color)] overflow-auto text-sm">
          {warnings.map((entry, index) => (
            <li className="py-2" key={`${entry.row || 0}-${entry.column}-${index}`}>
              {entry.row ? <span className="font-bold">CSV row {entry.row} · </span> : null}
              {entry.message}
            </li>
          ))}
        </ul>
      ) : <p className={secondary}>No follow-up items.</p>}
    </details>
  )
}

export function PitcheroImportSection({ club, teams, onCommitted }) {
  const [file, setFile] = useState(null)
  const [source, setSource] = useState(null)
  const [decisions, setDecisions] = useState({})
  const [season, setSeason] = useState(club.season || '')
  const [defaultTeam, setDefaultTeam] = useState('')
  const [review, setReview] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [completed, setCompleted] = useState(false)
  const [approved, setApproved] = useState(false)
  const activeTeams = useMemo(() => teams.filter((team) => team.status === 'active'), [teams])
  const scope = { clubId: club.id, clubWideScope: true }

  function resetReview() {
    setReview(null)
    setApproved(false)
    setCompleted(false)
    setError('')
  }

  function edit(playerId, changes) {
    setDecisions((current) => ({ ...current, [playerId]: { ...current[playerId], ...changes } }))
    resetReview()
  }

  async function run(action, callback) {
    setBusy(action)
    setError('')
    try {
      await callback()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy('')
    }
  }

  async function readFile() {
    await run('read', async () => {
      const result = await requestPitcheroImport('pitchero-source', file, scope)
      setSource(result)
      setDecisions({})
      resetReview()
    })
  }

  async function inspect() {
    await run('review', async () => {
      const reviewedDecisions = Object.fromEntries(source.players.map((player) => {
        const choice = decisions[player.id] || {}
        return [player.id, { ...choice, team: choice.team ?? (player.team || (!player.teams.length ? defaultTeam : '')) }]
      }))
      const result = await requestPitcheroImport('pitchero-inspect', file, { ...scope, decisions: reviewedDecisions, season })
      setApproved(false)
      setCompleted(false)
      setReview(result)
    })
  }

  async function confirm() {
    await run('confirm', async () => {
      await confirmDataTransfer({
        ...scope,
        batchId: review.batch.id,
        confirmationToken: review.confirmationToken,
        planSha256: review.batch.planSha256,
      })
      setCompleted(true)
      await onCommitted()
    })
  }

  return (
    <section id="pitchero-import" aria-labelledby="pitchero-import-title" className="space-y-4 rounded-xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
      <div>
        <h2 id="pitchero-import-title" className="text-xl font-black">Import from Pitchero</h2>
        <p className={secondary}>Upload a Pitchero membership CSV. Include team, role, date of birth, email and family columns where available. For a team-filtered export, you can assign one team to players with no team in the file.</p>
      </div>
      <label className="grid max-w-xl gap-1 text-sm font-bold">
        Pitchero CSV file
        <input type="file" accept=".csv,text/csv" disabled={Boolean(busy)} className={`${control} py-2`} onChange={(event) => {
          setFile(event.target.files?.[0] || null)
          setSource(null)
          setDefaultTeam('')
          resetReview()
        }} />
      </label>
      <button type="button" className={button} disabled={!file || Boolean(busy)} onClick={() => void readFile()}>
        {busy === 'read' ? 'Reading CSV...' : 'Read Pitchero CSV'}
      </button>
      {error ? <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">{error}</p> : null}
      {source ? (
        <fieldset className="space-y-4" disabled={Boolean(busy) || completed}>
          <legend className="font-black">Check players and teams ({source.players.length})</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-bold">
              Team for players with no team in the CSV
              <input value={defaultTeam} list="pitchero-team-names" maxLength={160} placeholder="Unknown" className={control}
                onChange={(event) => { setDefaultTeam(event.target.value); resetReview() }} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              Season for new teams
              <input value={season} maxLength={9} placeholder="Unknown" className={control}
                onChange={(event) => { setSeason(event.target.value); resetReview() }} />
            </label>
            <datalist id="pitchero-team-names">
              {activeTeams.map((team) => <option key={team.id} value={team.name} />)}
            </datalist>
          </div>
          <p className={secondary}>Enter an exact team name to use it or create it. If a player has several teams in Pitchero, choose their Football Player roster team. Leave unresolved players for follow-up.</p>
          <ul className="max-h-[36rem] divide-y divide-[var(--border-color)] overflow-auto border-y border-[var(--border-color)]">
            {source.players.map((player) => {
              const choice = decisions[player.id] || {}
              const label = player.name || `Unknown player on CSV row ${player.row}`
              const kind = choice.kind ?? player.kind
              return (
                <li className="space-y-2 py-3 pr-2" key={player.id}>
                  <div className="grid gap-2 sm:grid-cols-[minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)]">
                    <div>
                      <p className="font-bold">{label}</p>
                      <p className={secondary}>CSV row {player.row}{player.parents.length ? ` · ${player.parents.length} parent contact${player.parents.length === 1 ? '' : 's'}` : ''}</p>
                    </div>
                    <label className="grid gap-1 text-sm font-bold">
                      Team
                      <input aria-label={`Team for ${label}`} value={choice.team ?? (player.team || (!player.teams.length ? defaultTeam : ''))} list="pitchero-team-names"
                        maxLength={160} placeholder="Unknown" className={control} onChange={(event) => edit(player.id, { team: event.target.value })} />
                    </label>
                    <label className="grid gap-1 text-sm font-bold">
                      Player role
                      <select aria-label={`Role for ${label}`} value={kind} className={control} onChange={(event) => edit(player.id, { kind: event.target.value })}>
                        <option value="">Unknown</option>
                        <option value="junior">Junior player</option>
                        <option value="adult">Adult player</option>
                        <option value="skip">Skip</option>
                      </select>
                    </label>
                  </div>
                  {player.teams.length > 1 && <p className={secondary}>Pitchero teams · {player.teams.join(', ')}</p>}
                  {kind !== 'skip' && (
                    <details>
                      <summary className="min-h-9 cursor-pointer py-2 text-sm font-semibold">Player details and matching</summary>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="grid gap-1 text-sm">First name<input value={choice.first ?? player.first} maxLength={120} placeholder="Unknown" className={control} onChange={(event) => edit(player.id, { first: event.target.value })} /></label>
                        <label className="grid gap-1 text-sm">Last name<input value={choice.last ?? player.last} maxLength={120} placeholder="Unknown" className={control} onChange={(event) => edit(player.id, { last: event.target.value })} /></label>
                        <label className="grid gap-1 text-sm">Date of birth<input type="date" value={choice.birth ?? player.birth} className={control} onChange={(event) => edit(player.id, { birth: event.target.value })} />{!player.birth && !choice.birth ? <span className={secondary}>Unknown</span> : null}</label>
                      </div>
                      {kind === 'adult' ? (
                        <label className="mt-2 grid max-w-sm gap-1 text-sm">Player’s own email
                          <input type="email" value={choice.email ?? player.email} maxLength={254} placeholder="Unknown" className={control}
                            onChange={(event) => edit(player.id, { email: event.target.value })} />
                        </label>
                      ) : (
                        <p className={`mt-2 ${secondary}`}>Parents · {player.parents.map((parent) => `${parent.name || 'Unknown'} (${parent.email || 'Unknown'})`).join(', ') || 'Unknown'}</p>
                      )}
                      {player.requiresRelationshipReview && kind === 'junior' && (
                        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={choice.confirmRelationships === true}
                          onChange={(event) => edit(player.id, { confirmRelationships: event.target.checked })} />I verified these parents belong to this player.</label>
                      )}
                      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={choice.confirmExisting === true}
                        onChange={(event) => edit(player.id, { confirmExisting: event.target.checked })} />If a player with this name is already on this team, I verified it is the same person.</label>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
          <button type="button" className={button} onClick={() => void inspect()}>{busy === 'review' ? 'Checking club records...' : 'Preview Pitchero import'}</button>
        </fieldset>
      ) : null}
      {review ? (
        <div className="space-y-3 border-t border-[var(--border-color)] pt-4">
          <h3 className="font-black">{completed ? 'Pitchero import completed' : 'Pitchero import preview'}</h3>
          <p className={secondary}>
            {quantity(review.summary.newTeams.length, 'new team')}, {quantity(review.summary.players.filter((player) => !player.existing).length, 'new player')},
            {' '}{quantity(review.summary.newGuardians, 'new parent contact')} and {quantity(review.summary.links, 'parent link')}.
          </p>
          {review.summary.newTeams.length ? <p className="text-sm font-bold">New teams · {review.summary.newTeams.join(', ')}</p> : null}
          {review.summary.players.length ? (
            <details>
              <summary className="min-h-11 cursor-pointer py-2 font-bold">Players, teams and contacts</summary>
              <ul className="max-h-64 divide-y divide-[var(--border-color)] overflow-auto text-sm">
                {review.summary.players.map((player, index) => (
                  <li className="py-2" key={index}>
                    <strong>{player.name}</strong> · {player.team} · {player.kind === 'adult' ? 'Adult player' : 'Junior player'}
                    {' · '}{player.existing ? player.update ? 'Update existing' : 'Use existing' : 'Create'}
                    {player.contacts.length ? <p className={secondary}>{player.contacts.map((contact) => `${contact.name} (${contact.email || 'Unknown'})`).join(', ')}</p> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {review.errors.map((entry) => <p role="alert" className="text-sm font-bold" key={entry.code}>{entry.message}</p>)}
          <PitcheroChecklist warnings={review.warnings} />
          {review.warnings.length ? <button className={button} type="button" disabled={Boolean(busy)}
            onClick={() => void run('download', () => downloadDataTransferErrorReport(review.batch.id, scope))}>Download follow-up checklist</button> : null}
          {!completed && review.confirmationToken ? (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={approved} disabled={Boolean(busy)} onChange={(event) => setApproved(event.target.checked)} />
                I checked these teams, players and relationships. I’ll follow up on the listed items.
              </label>
              <button className={button} type="button" disabled={!approved || Boolean(busy)} onClick={() => void confirm()}>
                {busy === 'confirm' ? 'Importing...' : 'Confirm Pitchero import'}
              </button>
            </>
          ) : null}
          {!completed && !review.confirmationToken && !review.errors.length ? <p role="status" className={secondary}>No new records are ready to import. Check the follow-up list.</p> : null}
          {completed ? <p role="status" className={secondary}>The checklist is available in Transfer history. Account setup invitations can be sent separately.</p> : null}
        </div>
      ) : source ? <PitcheroChecklist warnings={source.warnings} /> : null}
    </section>
  )
}
