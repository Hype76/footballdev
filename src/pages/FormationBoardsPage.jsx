import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useBlocker, useLocation, useNavigate } from 'react-router-dom'
import { FormationBoardPitch } from '../components/formation-board/FormationBoardPitch.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import {
  canCreateFormationBoard,
  canArchiveFormationBoard,
  canEditFormationBoard,
  canUseFormationBoards,
  useAuth,
} from '../lib/auth.js'
import {
  addPlayersToUnplaced,
  applyFormationPreset,
  benchFormationPlayer,
  createEditorSnapshot,
  createFormationBoardDraftKey,
  createNewEditorSnapshot,
  getFormationPlayerState,
  moveBenchPlayerToPitch,
  moveBenchPlayerToUnplaced,
  moveFormationPlayer,
  movePitchPlayerToUnplaced,
  moveUnplacedPlayerToBench,
  moveUnplacedPlayerToPitch,
  parseFormationDraft,
  pushFormationHistory,
  removeFormationPlayer,
  serializeFormationDraft,
  snapshotsMatch,
  updateFormationPlayerNumber,
} from '../lib/formation-board-editor.js'
import {
  adaptFormationVersionToPortrait,
  getFormationBoardOrientation,
} from '../lib/formation-board-orientation.js'
import {
  createFormationBoardThumbnail,
  generateFormationBoardExport,
  shareFormationBoardExport,
} from '../lib/formation-board-export.js'
import {
  FORMATION_BOARD_GAME_FORMATS,
  archiveFormationBoard,
  createFormationBoard,
  duplicateFormationBoard,
  getFormationBoard,
  getFormationBoardPresets,
  getFormationBoardPublications,
  getFormationBoardVersions,
  getFormationBoards,
  getPlayers,
  publishFormationBoardVersion,
  RESOURCE_LIBRARY_CATEGORIES,
  restoreFormationBoard,
  restoreFormationBoardVersion,
  saveFormationBoardEditor,
} from '../lib/supabase.js'

const fieldClass = 'min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] focus:bg-[var(--panel-bg)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-black text-[var(--button-primary-text)] shadow-sm transition hover:bg-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-black text-[var(--text-primary)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-black text-[var(--danger-text)] transition hover:border-[var(--danger-text)] focus:outline-none focus:ring-2 focus:ring-[var(--danger-border)] disabled:cursor-not-allowed disabled:opacity-60'
const panelClass = 'rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 text-[var(--text-primary)] shadow-sm shadow-[#101828]/10 sm:p-5'

function formatDateTime(value) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString('en-GB')
}

function getUpdatedByLabel(board, user) {
  const profileId = board?.currentVersion?.createdByProfileId || board?.createdByProfileId
  return String(profileId) === String(user?.id) ? 'You' : 'Team staff'
}

function getBoardActionFromLocation(search) {
  const parameters = new URLSearchParams(search)
  return {
    action: parameters.get('action') || '',
    boardId: parameters.get('board') || '',
    versionId: parameters.get('version') || '',
  }
}

function BoardThumbnail({ board }) {
  const version = adaptFormationVersionToPortrait(board.currentVersion)
  const placements = version?.placements ?? []

  return (
    <div aria-label={`${board.title} portrait formation preview`} className="relative aspect-[3/4] w-full max-w-44 overflow-hidden rounded-lg border-2 border-white bg-[#237a45] shadow-inner sm:w-36">
      <div aria-hidden="true" className="absolute inset-2 rounded-md border border-white/80">
        <div className="absolute inset-x-0 top-1/2 border-t border-white/80" />
        <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80" />
      </div>
      {placements.map((item) => (
        <span
          key={item.playerId}
          aria-hidden="true"
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-[#101828]"
          style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%` }}
        />
      ))}
    </div>
  )
}

function FormationBoardList({ boards, canCreate, onArchive, onCreate, onDuplicate, onOpen, onRestore, user }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [formationFilter, setFormationFilter] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const filteredBoards = boards.filter((board) => {
    const matchesSearch = board.title.toLowerCase().includes(searchTerm.trim().toLowerCase())
    const matchesFormation = !formationFilter || board.gameFormat === formationFilter || board.formationPresetKey === formationFilter
    return matchesSearch && matchesFormation && (showArchived || !board.archivedAt)
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link to="/resources" className={secondaryButtonClass}>Back to Team Resources</Link>
        {canCreate ? <button type="button" onClick={onCreate} className={primaryButtonClass}>Create Formation Board</button> : null}
      </div>

      <section className={panelClass} aria-label="Formation Board filters">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_auto] md:items-end">
          <label>
            <span className="mb-2 block text-sm font-black">Search boards</span>
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} className={fieldClass} placeholder="Search by title" />
          </label>
          <label>
            <span className="mb-2 block text-sm font-black">Game format</span>
            <select value={formationFilter} onChange={(event) => setFormationFilter(event.target.value)} className={fieldClass}>
              <option value="">All formations</option>
              {FORMATION_BOARD_GAME_FORMATS.map((format) => <option key={format.value} value={format.value}>{format.label}</option>)}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm font-black">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="h-5 w-5" />
            Show archived
          </label>
        </div>
      </section>

      {filteredBoards.length === 0 ? (
        <section className={`${panelClass} py-10 text-center`}>
          <p className="text-xl font-black">No Formation Boards match this view.</p>
          <p className="mt-2 text-sm font-semibold text-[var(--text-muted)]">Create a board for a match plan, training shape, or Team discussion.</p>
          {canCreate ? <button type="button" onClick={onCreate} className={`${primaryButtonClass} mt-5`}>Create your first board</button> : null}
        </section>
      ) : (
        <div className="space-y-3">
          {filteredBoards.map((board) => (
            <article key={board.id} className={panelClass}>
              <div className="flex flex-col gap-4 sm:flex-row">
                <BoardThumbnail board={board} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-black">{board.title}</h2>
                    <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-black text-[var(--text-primary)]">{board.gameFormat}</span>
                    <span className="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-xs font-black">{board.formationPresetKey.split('-').slice(1).join('-')}</span>
                    <span className="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-xs font-black">{board.visibilityState === 'shared' ? 'Shared with Team staff' : 'Draft'}</span>
                    {board.currentPublicationId ? <span className="rounded-full border border-[#86efac] bg-[#dcfce7] px-2.5 py-1 text-xs font-black text-[#166534]">Published resource</span> : null}
                    {board.archivedAt ? <span className="rounded-full border border-[#fed7aa] bg-[#fff7ed] px-2.5 py-1 text-xs font-black text-[#9a3412]">Archived</span> : null}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-[var(--text-muted)]">Updated {formatDateTime(board.updatedAt)} by {getUpdatedByLabel(board, user)}. Version {board.currentVersionNumber}.</p>
                  {board.description ? <p className="mt-3 text-sm font-semibold leading-6 text-[var(--text-muted)]">{board.description}</p> : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => onOpen(board)} className={primaryButtonClass}>Open</button>
                    {canCreate ? <button type="button" onClick={() => onDuplicate(board)} className={secondaryButtonClass}>Duplicate</button> : null}
                    {board.archivedAt ? (
                      canArchiveFormationBoard(user, board) ? <button type="button" onClick={() => onRestore(board)} className={secondaryButtonClass}>Restore</button> : null
                    ) : canArchiveFormationBoard(user, board) ? (
                      <button type="button" onClick={() => onArchive(board)} className={dangerButtonClass}>Archive</button>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function UnplacedPlayersTray({ canEdit, onDragStart, onSelect, players, selectedPlayerId }) {
  return (
    <section className="mt-5 min-w-0 border-t border-[var(--border-color)] pt-4" aria-label="Unplaced Players">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-black">Unplaced Players</h3>
          <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">Tap a Player then tap the pitch, or drag the Player onto the pitch.</p>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-black" aria-label={`${players.length} unplaced Players`}>{players.length}</span>
      </div>
      {players.length > 0 ? (
        <div className="max-w-full overflow-x-auto overscroll-x-contain pb-2" data-unplaced-tray="true">
          <div className="flex w-max min-w-full gap-2 lg:w-auto lg:flex-wrap">
            {players.map((player) => {
              const isSelected = selectedPlayerId === player.playerId

              return (
                <button
                  key={player.playerId}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={isSelected}
                  aria-label={`${player.displayName}, shirt ${player.shirtNumber || 'number missing'}, Unplaced`}
                  onClick={() => onSelect(player)}
                  onPointerDown={(event) => onDragStart(event, player, 'unplaced')}
                  className={`flex min-h-14 min-w-36 max-w-44 touch-pan-x items-center gap-2 rounded-xl border-2 px-3 py-2 text-left shadow-sm focus:outline-none focus:ring-4 focus:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-60 ${isSelected ? 'border-amber-300 bg-[#101828] text-white' : 'border-[var(--border-color)] bg-[var(--panel-soft)] text-[var(--text-primary)]'}`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-black ${isSelected ? 'border-amber-300' : 'border-[var(--border-color)] bg-[var(--panel-bg)]'}`}>{player.shirtNumber || '?'}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black" title={player.displayName}>{player.displayName}</span>
                    <span className="block text-[0.68rem] font-bold">{isSelected ? 'Selected, Unplaced' : 'Unplaced'}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="rounded-lg bg-[var(--panel-soft)] p-3 text-sm font-semibold text-[var(--text-muted)]">No unplaced Players. Use Players to add several squad members together.</p>
      )}
    </section>
  )
}

function PlayerRoster({
  canEdit,
  onAddPlayers,
  onDragStart,
  onMoveToBench,
  onMoveToUnplaced,
  onNumberChange,
  onRemove,
  onSelectBoardPlayer,
  players,
  selectedBoardPlayer,
  selectedBoardPlayerState,
  selectedSource,
  snapshot,
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPlayerIds, setSelectedPlayerIds] = useState(() => new Set())
  const filteredPlayers = players.filter((player) => player.playerName.toLowerCase().includes(searchTerm.trim().toLowerCase()))
  const eligibleSelectedPlayers = players.filter((player) => selectedPlayerIds.has(player.id) && getFormationPlayerState(snapshot, player.id) === 'available')
  const selectedCount = eligibleSelectedPlayers.length

  const togglePlayer = (playerId) => {
    if (!canEdit || getFormationPlayerState(snapshot, playerId) !== 'available') return
    setSelectedPlayerIds((current) => {
      const next = new Set(current)
      if (next.has(playerId)) next.delete(playerId)
      else next.add(playerId)
      return next
    })
  }

  return (
    <div className="space-y-4">
      {selectedBoardPlayer && canEdit ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[#101828]">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-800">Selected Player</p>
          <p className="mt-1 truncate text-sm font-black" title={selectedBoardPlayer.displayName}>{selectedBoardPlayer.displayName}</p>
          <p className="mt-1 text-xs font-bold text-amber-900">{selectedBoardPlayerState === 'pitch' ? 'On pitch' : selectedBoardPlayerState === 'bench' ? 'Bench' : 'Unplaced'}</p>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-black">Displayed shirt number</span>
            <input
              value={selectedBoardPlayer.shirtNumber}
              inputMode="numeric"
              maxLength={3}
              onChange={(event) => {
                const value = event.target.value.replace(/\D/g, '').slice(0, 3)
                onNumberChange(selectedBoardPlayer.playerId, value)
              }}
              className={fieldClass}
              aria-label={`Displayed shirt number for ${selectedBoardPlayer.displayName}`}
            />
          </label>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {selectedBoardPlayerState !== 'unplaced' ? <button type="button" onClick={() => onMoveToUnplaced(selectedBoardPlayer.playerId, selectedBoardPlayerState)} className={secondaryButtonClass}>Move to Unplaced</button> : null}
            {selectedBoardPlayerState !== 'bench' ? <button type="button" onClick={() => onMoveToBench(selectedBoardPlayer.playerId, selectedBoardPlayerState)} className={secondaryButtonClass}>Move to bench</button> : null}
            <button type="button" onClick={() => onRemove(selectedBoardPlayer.playerId)} className={dangerButtonClass}>Remove from board</button>
          </div>
        </section>
      ) : null}

      <label className="block">
        <span className="mb-2 block text-sm font-black">Search Players</span>
        <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} className={fieldClass} placeholder="Search squad" />
      </label>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-black">Squad</h3>
          <span className="text-xs font-bold text-[var(--text-muted)]" aria-live="polite">{selectedCount} selected</span>
        </div>
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {filteredPlayers.map((player) => {
            const playerState = getFormationPlayerState(snapshot, player.id)
            const assignedState = playerState === 'pitch' ? 'On pitch' : playerState === 'bench' ? 'Bench' : playerState === 'unplaced' ? 'Unplaced' : ''
            const isAvailable = !assignedState
            const isSelected = isAvailable && selectedPlayerIds.has(player.id)
            const isTrial = String(player.section).toLowerCase() === 'trial'

            return (
              <button
                key={player.id}
                type="button"
                disabled={!canEdit || !isAvailable}
                aria-pressed={isSelected}
                onClick={() => togglePlayer(player.id)}
                className={`flex min-h-12 w-full touch-pan-y items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed ${isSelected ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border-color)] bg-[var(--panel-soft)]'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black" title={player.playerName}>{player.playerName}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1 text-[0.68rem] font-bold text-[var(--text-muted)]">
                    <span>{isSelected ? 'Selected' : assignedState || 'Available'}</span>
                    {isTrial ? <span>| Trial</span> : null}
                    {!player.shirtNumber ? <span>| Missing number</span> : null}
                  </span>
                </span>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--panel-bg)] text-xs font-black">{player.shirtNumber || '?'}</span>
              </button>
            )
          })}
          {filteredPlayers.length === 0 ? <p className="rounded-lg bg-[var(--panel-soft)] p-3 text-sm font-semibold text-[var(--text-muted)]">No Players match this search.</p> : null}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
          <button type="button" disabled={selectedCount === 0} onClick={() => { onAddPlayers(eligibleSelectedPlayers); setSelectedPlayerIds(new Set()) }} className={primaryButtonClass} aria-label={`Add ${selectedCount} ${selectedCount === 1 ? 'Player' : 'Players'}`}>Add {selectedCount} {selectedCount === 1 ? 'Player' : 'Players'}</button>
          <button type="button" disabled={selectedCount === 0} onClick={() => setSelectedPlayerIds(new Set())} className={secondaryButtonClass}>Clear selection</button>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-black">Unplaced</h3>
          <span className="text-xs font-bold text-[var(--text-muted)]">{snapshot.unplaced.length}</span>
        </div>
        <div className="space-y-2">
          {snapshot.unplaced.map((player) => (
            <button
              key={player.playerId}
              type="button"
              disabled={!canEdit}
              aria-pressed={selectedSource?.type === 'unplaced' && selectedSource.playerId === player.playerId}
              onClick={() => onSelectBoardPlayer(player, 'unplaced')}
              onPointerDown={(event) => onDragStart(event, player, 'unplaced')}
              className={`flex min-h-12 w-full touch-pan-y items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-black ${selectedSource?.type === 'unplaced' && selectedSource.playerId === player.playerId ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border-color)] bg-[var(--panel-soft)]'}`}
            >
              <span className="truncate">{player.displayName}</span>
              <span>{player.shirtNumber || '?'}</span>
            </button>
          ))}
          {snapshot.unplaced.length === 0 ? <p className="rounded-lg bg-[var(--panel-soft)] p-3 text-sm font-semibold text-[var(--text-muted)]">No unplaced Players.</p> : null}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-black">Bench</h3>
          <span className="text-xs font-bold text-[var(--text-muted)]">{snapshot.bench.length}</span>
        </div>
        <div className="space-y-2">
          {snapshot.bench.map((player) => (
            <button
              key={player.playerId}
              type="button"
              disabled={!canEdit}
              aria-pressed={selectedSource?.type === 'bench' && selectedSource.playerId === player.playerId}
              onClick={() => onSelectBoardPlayer(player, 'bench')}
              onPointerDown={(event) => onDragStart(event, player, 'bench')}
              className={`flex min-h-12 w-full touch-pan-y items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-black ${selectedSource?.type === 'bench' && selectedSource.playerId === player.playerId ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border-color)] bg-[var(--panel-soft)]'}`}
            >
              <span className="truncate">{player.displayName}</span>
              <span>{player.shirtNumber || '?'}</span>
            </button>
          ))}
          {snapshot.bench.length === 0 ? <p className="rounded-lg bg-[var(--panel-soft)] p-3 text-sm font-semibold text-[var(--text-muted)]">No Players on the bench.</p> : null}
        </div>
      </section>
    </div>
  )
}

function MobileRosterSheet({ children, isOpen, onClose }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return undefined
    const previousFocus = document.activeElement
    closeRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return
      const focusable = [...panelRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]')]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus?.()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-[#101828]/55 lg:hidden" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panelRef} role="dialog" aria-modal="true" aria-label="Formation Board Players and bench" className="max-h-[82dvh] w-full overflow-y-auto rounded-t-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[var(--text-primary)] shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black">Players and bench</h2>
          <button ref={closeRef} type="button" onClick={onClose} className={secondaryButtonClass}>Close</button>
        </div>
        {children}
      </section>
    </div>
  )
}

function FormationBoardDialog({ children, isOpen, onClose, title }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return undefined
    const previousFocus = document.activeElement
    closeRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return
      const focusable = [...panelRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]')]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus?.()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#101828]/55 p-0 sm:items-center sm:p-5" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panelRef} role="dialog" aria-modal="true" aria-label={title} className="max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[var(--text-primary)] shadow-2xl sm:max-w-xl sm:rounded-2xl sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-black">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} className={secondaryButtonClass}>Close</button>
        </div>
        {children}
      </section>
    </div>
  )
}

function VersionHistory({ canEdit, currentVersionNumber, isBusy, onRestoreVersion, versions }) {
  return (
    <details className={panelClass}>
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-black">Version history ({versions.length})</summary>
      <div className="mt-3 space-y-2">
        {versions.map((version) => (
          <div key={version.id} className="flex flex-col gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black">Version {version.versionNumber}{version.versionNumber === currentVersionNumber ? ' (current)' : ''}</p>
              <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">{formatDateTime(version.createdAt)} | {version.gameFormat} | {version.formationPresetKey} | {version.pitchOrientation === 'landscape' ? 'Historical landscape' : 'Portrait'}</p>
            </div>
            {canEdit && version.versionNumber !== currentVersionNumber ? (
              <button type="button" disabled={isBusy} onClick={() => onRestoreVersion(version)} className={secondaryButtonClass}>Restore as new version</button>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  )
}

export function FormationBoardsPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const pitchRef = useRef(null)
  const allowNavigationRef = useRef(false)
  const quickCreateHandledRef = useRef(false)
  const dragRef = useRef(null)
  const dragCleanupRef = useRef(null)
  const suppressSourceClickRef = useRef('')
  const [boards, setBoards] = useState([])
  const [presets, setPresets] = useState([])
  const [players, setPlayers] = useState([])
  const [versions, setVersions] = useState([])
  const [publications, setPublications] = useState([])
  const [currentBoard, setCurrentBoard] = useState(null)
  const [publishedSnapshotVersion, setPublishedSnapshotVersion] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [savedSnapshot, setSavedSnapshot] = useState(null)
  const [history, setHistory] = useState([])
  const [selectedSource, setSelectedSource] = useState(null)
  const [selectedMarkerId, setSelectedMarkerId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isRosterOpen, setIsRosterOpen] = useState(false)
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const [isPublishOpen, setIsPublishOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publicationCategory, setPublicationCategory] = useState('general')
  const [publicationAction, setPublicationAction] = useState('new_resource')
  const [publicationResourceId, setPublicationResourceId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [saveState, setSaveState] = useState('saved')
  const [draftCandidate, setDraftCandidate] = useState(null)
  const [pendingPreset, setPendingPreset] = useState(null)
  const [conflict, setConflict] = useState(null)
  const [dragPreview, setDragPreview] = useState(null)
  const [portraitCompatibility, setPortraitCompatibility] = useState(null)
  const activeTeamId = String(user?.activeTeamId ?? '').trim()
  const activeTeamName = String(user?.activeTeamName ?? '').trim() || 'Selected Team'
  const canOpen = canUseFormationBoards(user)
  const canCreate = canCreateFormationBoard(user)
  const canEdit = publishedSnapshotVersion ? false : currentBoard ? canEditFormationBoard(user, currentBoard) : canCreate
  const isNewBoard = currentBoard?.id === 'new'
  const hasUnsavedChanges = Boolean(snapshot && savedSnapshot && !snapshotsMatch(snapshot, savedSnapshot))
  const blocker = useBlocker(() => hasUnsavedChanges && !allowNavigationRef.current)
  const selectedMarker = snapshot?.placements.find((item) => item.playerId === selectedMarkerId) || null
  const selectedBoardPlayerId = selectedSource?.playerId || selectedMarkerId
  const selectedBoardPlayerState = snapshot && selectedBoardPlayerId ? getFormationPlayerState(snapshot, selectedBoardPlayerId) : 'available'
  const selectedBoardPlayer = selectedBoardPlayerState === 'pitch'
    ? snapshot?.placements.find((item) => item.playerId === selectedBoardPlayerId) || null
    : selectedBoardPlayerState === 'bench'
      ? snapshot?.bench.find((item) => item.playerId === selectedBoardPlayerId) || null
      : selectedBoardPlayerState === 'unplaced'
        ? snapshot?.unplaced.find((item) => item.playerId === selectedBoardPlayerId) || null
        : null
  const currentPreset = presets.find((preset) => preset.key === snapshot?.presetKey) || null
  const viewedPublication = publishedSnapshotVersion
    ? publications.find((publication) => publication.boardVersionId === publishedSnapshotVersion.id) || null
    : null
  const linkedPublicationResources = [...new Map(
    publications.map((publication) => [publication.resourceId, publication]),
  ).values()]
  const draftKey = snapshot ? createFormationBoardDraftKey({
    boardId: currentBoard?.id || 'new',
    clubId: user?.clubId,
    teamId: activeTeamId,
    userId: user?.id,
  }) : ''

  const refreshBoards = useCallback(async (includeArchived = true) => {
    const nextBoards = await getFormationBoards({ includeArchived, teamId: activeTeamId, user })
    setBoards(nextBoards)
    return nextBoards
  }, [activeTeamId, user])

  useEffect(() => {
    if (!canOpen) return undefined
    let isMounted = true

    const load = async () => {
      setIsLoading(true)
      setErrorMessage('')
      try {
        const [nextBoards, nextPresets, nextPlayers] = await Promise.all([
          getFormationBoards({ includeArchived: true, teamId: activeTeamId, user }),
          getFormationBoardPresets(),
          getPlayers({ teamId: activeTeamId, user }),
        ])
        if (!isMounted) return
        setBoards(nextBoards)
        setPresets(nextPresets)
        setPlayers(nextPlayers)
      } catch (error) {
        console.error(error)
        if (isMounted) setErrorMessage(error.message || 'Formation Boards could not be loaded.')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }
    void load()
    return () => { isMounted = false }
  }, [activeTeamId, canOpen, user])

  const loadDraftCandidate = useCallback((board, nextSnapshot) => {
    const key = createFormationBoardDraftKey({ boardId: board.id, clubId: user?.clubId, teamId: activeTeamId, userId: user?.id })
    const candidate = parseFormationDraft(window.localStorage.getItem(key))
    setDraftCandidate(candidate && !snapshotsMatch(candidate.snapshot, nextSnapshot) ? candidate : null)
  }, [activeTeamId, user?.clubId, user?.id])

  const openBoard = useCallback(async (board, { versionId = '' } = {}) => {
    setErrorMessage('')
    try {
      const freshBoard = board.id === 'new' ? board : await getFormationBoard(board.id)
      let nextVersions = []
      let nextPublications = []
      let snapshotVersion = null

      if (board.id !== 'new') {
        [nextVersions, nextPublications] = await Promise.all([
          getFormationBoardVersions(board.id),
          getFormationBoardPublications(board.id),
        ])
        snapshotVersion = versionId ? nextVersions.find((version) => version.id === versionId) || null : null
        if (versionId && !snapshotVersion) throw new Error('That published Formation Board version is no longer available.')
      }

      const matchingPublication = snapshotVersion
        ? nextPublications.find((publication) => publication.boardVersionId === snapshotVersion.id)
        : null
      const displayBoard = snapshotVersion
        ? {
            ...freshBoard,
            title: matchingPublication?.boardTitleSnapshot || freshBoard.title,
            description: matchingPublication?.boardDescriptionSnapshot || freshBoard.description,
            currentVersion: snapshotVersion,
            currentVersionNumber: snapshotVersion.versionNumber,
          }
        : freshBoard
      const nextSnapshot = board.id === 'new'
        ? createNewEditorSnapshot(presets.find((preset) => preset.gameFormat === '7v7' && !preset.key.endsWith('-custom')) || presets[0])
        : createEditorSnapshot({ board: displayBoard })
      const sourceOrientation = getFormationBoardOrientation(displayBoard.currentVersion?.pitchOrientation)
      const isLandscapeCompatibility = board.id !== 'new' && sourceOrientation === 'landscape'
      const savedBaseline = isLandscapeCompatibility && !snapshotVersion
        ? { ...nextSnapshot, pitchOrientation: 'landscape' }
        : nextSnapshot
      setCurrentBoard(displayBoard)
      setPublishedSnapshotVersion(snapshotVersion)
      setSnapshot(nextSnapshot)
      setSavedSnapshot(savedBaseline)
      setHistory([])
      setSelectedSource(null)
      setSelectedMarkerId('')
      setSaveState(isLandscapeCompatibility && !snapshotVersion ? 'unsaved' : 'saved')
      setConflict(null)
      setPortraitCompatibility(isLandscapeCompatibility ? {
        isHistoricalSnapshot: Boolean(snapshotVersion),
        sourceVersionId: displayBoard.currentVersion?.id || '',
        sourceVersionNumber: displayBoard.currentVersion?.versionNumber || 0,
      } : null)
      setVersions(nextVersions)
      setPublications(nextPublications)
      if (!snapshotVersion) loadDraftCandidate(freshBoard, nextSnapshot)
      else setDraftCandidate(null)
      const versionQuery = snapshotVersion ? `&version=${snapshotVersion.id}` : ''
      navigate(`/resources/formation-boards?board=${board.id}${versionQuery}`, { replace: true })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'The Formation Board could not be opened.')
    }
  }, [loadDraftCandidate, navigate, presets])

  const startNewBoard = useCallback(() => {
    if (!canCreate || presets.length === 0) return
    void openBoard({ id: 'new', title: '', visibilityState: 'draft' })
  }, [canCreate, openBoard, presets.length])

  useEffect(() => {
    if (isLoading || presets.length === 0 || quickCreateHandledRef.current) return
    const routeAction = getBoardActionFromLocation(location.search)
    if (routeAction.action === 'create' && canCreate) {
      quickCreateHandledRef.current = true
      startNewBoard()
      return
    }
    if (routeAction.boardId && routeAction.boardId !== 'new') {
      const matchingBoard = boards.find((board) => board.id === routeAction.boardId)
      if (matchingBoard) {
        quickCreateHandledRef.current = true
        void openBoard(matchingBoard, { versionId: routeAction.versionId })
      }
    }
  }, [boards, canCreate, isLoading, location.search, openBoard, presets.length, startNewBoard])

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined
    const handleBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  useEffect(() => {
    const cancelActiveDrag = () => {
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
      dragRef.current = null
      setDragPreview(null)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') cancelActiveDrag()
    }
    window.addEventListener('blur', cancelActiveDrag)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('blur', cancelActiveDrag)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      cancelActiveDrag()
    }
  }, [])

  useEffect(() => {
    if (!draftKey || !hasUnsavedChanges || !snapshot) return undefined
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(draftKey, serializeFormationDraft(snapshot, currentBoard?.id))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [currentBoard?.id, draftKey, hasUnsavedChanges, snapshot])

  const commitSnapshot = (nextSnapshot) => {
    if (!canEdit || !snapshot || snapshotsMatch(snapshot, nextSnapshot)) return
    setHistory((current) => pushFormationHistory(current, snapshot))
    setSnapshot(nextSnapshot)
    setSaveState('unsaved')
  }

  const updateSnapshot = (nextSnapshot) => {
    if (!canEdit || !snapshot || snapshotsMatch(snapshot, nextSnapshot)) return
    setSnapshot(nextSnapshot)
    setSaveState('unsaved')
  }

  const undo = () => {
    if (history.length === 0) return
    const previous = history[history.length - 1]
    setHistory((current) => current.slice(0, -1))
    setSnapshot(previous)
    setSaveState(snapshotsMatch(previous, savedSnapshot) ? 'saved' : 'unsaved')
  }

  const closeEditor = () => {
    allowNavigationRef.current = true
    setCurrentBoard(null)
    setPublishedSnapshotVersion(null)
    setSnapshot(null)
    setSavedSnapshot(null)
    setDraftCandidate(null)
    setHistory([])
    setPublications([])
    setPortraitCompatibility(null)
    navigate('/resources/formation-boards', { replace: true })
    window.setTimeout(() => { allowNavigationRef.current = false }, 0)
  }

  const reloadLatest = async () => {
    if (!currentBoard || isNewBoard) return
    const freshBoard = await getFormationBoard(currentBoard.id)
    const nextSnapshot = createEditorSnapshot({ board: freshBoard })
    const isLandscapeCompatibility = getFormationBoardOrientation(freshBoard.currentVersion?.pitchOrientation) === 'landscape'
    setCurrentBoard(freshBoard)
    setSnapshot(nextSnapshot)
    setSavedSnapshot(isLandscapeCompatibility ? { ...nextSnapshot, pitchOrientation: 'landscape' } : nextSnapshot)
    setVersions(await getFormationBoardVersions(currentBoard.id))
    setHistory([])
    setConflict(null)
    setSaveState(isLandscapeCompatibility ? 'unsaved' : 'saved')
    setPortraitCompatibility(isLandscapeCompatibility ? {
      isHistoricalSnapshot: false,
      sourceVersionId: freshBoard.currentVersion?.id || '',
      sourceVersionNumber: freshBoard.currentVersion?.versionNumber || 0,
    } : null)
    if (draftKey) window.localStorage.removeItem(draftKey)
  }

  const saveAsNewBoard = async () => {
    if (!snapshot) return
    setIsSaving(true)
    try {
      const created = await createFormationBoard({
        ...snapshot,
        presetKey: snapshot.presetKey,
        teamId: activeTeamId,
        title: `${snapshot.title || currentBoard.title} copy`.slice(0, 120),
        user,
      })
      if (draftKey) window.localStorage.removeItem(draftKey)
      await refreshBoards()
      setConflict(null)
      await openBoard(created)
      showToast({ title: 'Board copied', message: 'Your changes were saved as a new Formation Board.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'The Formation Board copy could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  const saveBoard = async () => {
    if (!snapshot || !canEdit) return
    if (!snapshot.title.trim()) {
      setErrorMessage('Enter a Formation Board title before saving.')
      return
    }
    if (!snapshot.presetKey) {
      setErrorMessage('Choose a formation before saving.')
      return
    }

    setIsSaving(true)
    setSaveState('saving')
    setErrorMessage('')
    try {
      let savedBoard
      if (isNewBoard) {
        savedBoard = await createFormationBoard({ ...snapshot, presetKey: snapshot.presetKey, teamId: activeTeamId, user })
      } else {
        savedBoard = await saveFormationBoardEditor({
          ...snapshot,
          boardId: currentBoard.id,
          description: snapshot.description,
          expectedVersionNumber: snapshot.baseVersionNumber,
          presetKey: snapshot.presetKey,
          title: snapshot.title,
          user,
          versionReason: portraitCompatibility
            ? `Portrait adaptation from version ${portraitCompatibility.sourceVersionNumber || snapshot.baseVersionNumber}`
            : 'Formation Board editor save',
        })
      }
      const nextSnapshot = createEditorSnapshot({ board: savedBoard })
      setCurrentBoard(savedBoard)
      setSnapshot(nextSnapshot)
      setSavedSnapshot(nextSnapshot)
      setHistory([])
      setSaveState('saved')
      setPortraitCompatibility(null)
      if (draftKey) window.localStorage.removeItem(draftKey)
      if (isNewBoard) {
        allowNavigationRef.current = true
        navigate(`/resources/formation-boards?board=${savedBoard.id}`, { replace: true })
        window.setTimeout(() => { allowNavigationRef.current = false }, 0)
      }

      const [versionsResult, boardsResult] = await Promise.allSettled([
        getFormationBoardVersions(savedBoard.id),
        refreshBoards(),
      ])
      if (versionsResult.status === 'fulfilled') setVersions(versionsResult.value)
      if (versionsResult.status === 'rejected' || boardsResult.status === 'rejected') {
        console.warn('Formation Board saved, but its latest Team history could not be refreshed yet.')
      }
      showToast({ title: 'Formation Board saved', message: `Version ${savedBoard.currentVersionNumber} is protected in Team history.` })
    } catch (error) {
      if (error.code !== 'formation_board_version_conflict') console.error(error)
      setSaveState(error.code === 'formation_board_version_conflict' ? 'conflict' : 'failed')
      if (error.code === 'formation_board_version_conflict') setConflict(error)
      else setErrorMessage(error.message || 'The Formation Board could not be saved. Retry when ready.')
    } finally {
      setIsSaving(false)
    }
  }

  const exportBoard = async (format) => {
    if (!currentBoard || isNewBoard || hasUnsavedChanges) {
      setErrorMessage('Save the Formation Board before exporting it.')
      return
    }

    const versionId = publishedSnapshotVersion?.id || currentBoard.currentVersionId

    if (!versionId) {
      setErrorMessage('The saved Formation Board version could not be resolved.')
      return
    }

    setIsExporting(true)
    setErrorMessage('')

    try {
      const result = await generateFormationBoardExport({
        boardId: currentBoard.id,
        format,
        user,
        versionId,
      })
      const outcome = await shareFormationBoardExport(result)
      setIsActionsOpen(false)

      if (!outcome.cancelled) {
        showToast({
          title: `${format.toUpperCase()} ready`,
          message: outcome.shared ? 'The secure device share sheet was opened.' : 'The Formation Board was downloaded to this device.',
        })
      }
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || `The ${format.toUpperCase()} export could not be created.`)
    } finally {
      setIsExporting(false)
    }
  }

  const publishBoard = async () => {
    if (!currentBoard || isNewBoard || hasUnsavedChanges || publishedSnapshotVersion) {
      setErrorMessage('Save the current Formation Board before publishing it.')
      return
    }

    if (publicationAction === 'update_resource' && !publicationResourceId) {
      setErrorMessage('Choose the linked Team Resource to update.')
      return
    }

    setIsPublishing(true)
    setErrorMessage('')
    let thumbnailPath = null
    let thumbnailFailed = false

    try {
      try {
        const thumbnail = await createFormationBoardThumbnail({
          boardId: currentBoard.id,
          user,
          versionId: currentBoard.currentVersionId,
        })
        thumbnailPath = thumbnail.thumbnailPath
      } catch (thumbnailError) {
        thumbnailFailed = true
        console.warn('Formation Board thumbnail generation failed. Publishing with the safe preview fallback.', thumbnailError)
      }

      const result = await publishFormationBoardVersion({
        boardId: currentBoard.id,
        category: publicationCategory,
        publicationAction,
        resourceId: publicationAction === 'update_resource' ? publicationResourceId : null,
        thumbnailFailed,
        thumbnailPath,
        user,
        versionId: currentBoard.currentVersionId,
      })
      const [nextPublications, nextBoards, freshBoard] = await Promise.all([
        getFormationBoardPublications(currentBoard.id),
        refreshBoards(),
        getFormationBoard(currentBoard.id),
      ])
      setPublications(nextPublications)
      setBoards(nextBoards)
      setCurrentBoard(freshBoard)
      setIsPublishOpen(false)
      setIsActionsOpen(false)
      setPublicationAction('update_resource')
      setPublicationResourceId(result.publication.resourceId)
      showToast({
        title: 'Published to Team Resources',
        message: thumbnailFailed
          ? 'The immutable version is published with a safe preview fallback.'
          : `Version ${snapshot.baseVersionNumber} is published with its protected preview.`,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'The Formation Board could not be published.')
    } finally {
      setIsPublishing(false)
    }
  }

  const handlePitchPress = (coordinates) => {
    if (!selectedSource || !snapshot) return
    if (selectedSource.type === 'marker') {
      commitSnapshot(moveFormationPlayer(snapshot, selectedSource.playerId, coordinates))
    } else if (selectedSource.type === 'bench') {
      commitSnapshot(moveBenchPlayerToPitch(snapshot, selectedSource.playerId, coordinates))
    } else if (selectedSource.type === 'unplaced') {
      commitSnapshot(moveUnplacedPlayerToPitch(snapshot, selectedSource.playerId, coordinates))
      setSelectedMarkerId(selectedSource.playerId)
    }
    setSelectedSource(null)
  }

  const handleMarkerSelect = (playerId) => {
    setSelectedMarkerId(playerId)
    setSelectedSource({ playerId, type: 'marker' })
  }

  const handleBoardPlayerSelect = (player, sourceType) => {
    const playerId = player.playerId || player.id
    if (suppressSourceClickRef.current === playerId) return
    setSelectedMarkerId(sourceType === 'marker' ? playerId : '')
    setSelectedSource({ playerId, type: sourceType })
  }

  const handlePlayerDragStart = (event, player, sourceType) => {
    if (!canEdit || event.button !== 0) return
    dragCleanupRef.current?.()
    dragRef.current = { moved: false, player, pointerId: event.pointerId, sourceType, startX: event.clientX, startY: event.clientY }

    const handleMove = (moveEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== moveEvent.pointerId) return
      if (Math.abs(moveEvent.clientX - drag.startX) > 6 || Math.abs(moveEvent.clientY - drag.startY) > 6) drag.moved = true
      if (!drag.moved) return
      moveEvent.preventDefault()
      setDragPreview({ label: player.playerName || player.displayName, x: moveEvent.clientX, y: moveEvent.clientY })
    }

    const finish = (upEvent) => {
      const drag = dragRef.current
      if (drag?.pointerId === upEvent.pointerId && drag.moved && pitchRef.current) {
        const bounds = pitchRef.current.getBoundingClientRect()
        if (upEvent.clientX >= bounds.left && upEvent.clientX <= bounds.right && upEvent.clientY >= bounds.top && upEvent.clientY <= bounds.bottom) {
          const coordinates = { x: (upEvent.clientX - bounds.left) / bounds.width, y: (upEvent.clientY - bounds.top) / bounds.height }
          const next = sourceType === 'bench'
            ? moveBenchPlayerToPitch(snapshot, player.playerId, coordinates)
            : moveUnplacedPlayerToPitch(snapshot, player.playerId, coordinates)
          commitSnapshot(next)
          setSelectedSource(null)
          setSelectedMarkerId(player.playerId)
          if (sourceType === 'bench') setIsRosterOpen(false)
        }
        suppressSourceClickRef.current = player.playerId || player.id
        window.setTimeout(() => { suppressSourceClickRef.current = '' }, 0)
      }
      dragCleanupRef.current?.()
    }

    window.addEventListener('pointermove', handleMove, { passive: false })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    dragCleanupRef.current = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      dragCleanupRef.current = null
      dragRef.current = null
      setDragPreview(null)
    }
  }

  const roster = snapshot ? (
    <PlayerRoster
      canEdit={canEdit}
      onAddPlayers={(selectedPlayers) => {
        commitSnapshot(addPlayersToUnplaced(snapshot, selectedPlayers))
        setSelectedSource(null)
        setSelectedMarkerId('')
        setIsRosterOpen(false)
      }}
      onDragStart={handlePlayerDragStart}
      onMoveToBench={(playerId, state) => {
        commitSnapshot(state === 'unplaced'
          ? moveUnplacedPlayerToBench(snapshot, playerId)
          : benchFormationPlayer(snapshot, playerId))
        setSelectedSource(null)
        setSelectedMarkerId('')
      }}
      onMoveToUnplaced={(playerId, state) => {
        commitSnapshot(state === 'bench'
          ? moveBenchPlayerToUnplaced(snapshot, playerId)
          : movePitchPlayerToUnplaced(snapshot, playerId))
        setSelectedSource({ playerId, type: 'unplaced' })
        setSelectedMarkerId('')
      }}
      onNumberChange={(playerId, number) => commitSnapshot(updateFormationPlayerNumber(snapshot, playerId, number))}
      onRemove={(playerId) => { commitSnapshot(removeFormationPlayer(snapshot, playerId)); setSelectedSource(null); setSelectedMarkerId('') }}
      onSelectBoardPlayer={handleBoardPlayerSelect}
      players={players}
      selectedBoardPlayer={selectedBoardPlayer}
      selectedBoardPlayerState={selectedBoardPlayerState}
      selectedSource={selectedSource}
      snapshot={snapshot}
    />
  ) : null

  if (!canOpen) return <Navigate to="/" replace />

  if (isLoading) {
    return <div className={panelClass}><p className="text-sm font-black">Loading Formation Boards...</p></div>
  }

  return (
    <div className="space-y-5 pb-28 lg:pb-6">
      <PageHeader
        eyebrow="Team Resources"
        title="Formation Boards"
        description={`Plan shapes and Player positions for ${activeTeamName}. Boards remain inside the selected Team.`}
      />

      {errorMessage ? <NoticeBanner title="Formation Board action failed" message={errorMessage} /> : null}

      {!snapshot ? (
        <FormationBoardList
          boards={boards}
          canCreate={canCreate}
          onArchive={async (board) => {
            try { await archiveFormationBoard({ boardId: board.id, user }); await refreshBoards(); showToast({ title: 'Board archived', message: `${board.title} is retained in Team history.` }) }
            catch (error) { setErrorMessage(error.message || 'The board could not be archived.') }
          }}
          onCreate={startNewBoard}
          onDuplicate={async (board) => {
            try { const copy = await duplicateFormationBoard({ boardId: board.id, user }); await refreshBoards(); await openBoard(copy) }
            catch (error) { setErrorMessage(error.message || 'The board could not be duplicated.') }
          }}
          onOpen={openBoard}
          onRestore={async (board) => {
            try { await restoreFormationBoard({ boardId: board.id, user }); await refreshBoards(); showToast({ title: 'Board restored', message: `${board.title} is active again.` }) }
            catch (error) { setErrorMessage(error.message || 'The board could not be restored.') }
          }}
          user={user}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={closeEditor} className={secondaryButtonClass}>Back to Formation Boards</button>
            <div className="flex flex-wrap items-center gap-2 text-sm font-black">
              <span className={`rounded-full px-3 py-1.5 ${saveState === 'failed' || saveState === 'conflict' ? 'bg-[var(--danger-soft)] text-[var(--danger-text)]' : saveState === 'saved' ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#fff7ed] text-[#9a3412]'}`}>
                {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : saveState === 'failed' ? 'Save failed' : saveState === 'conflict' ? 'Conflict detected' : 'Unsaved changes'}
              </span>
              {!isNewBoard ? <span className="rounded-full border border-[var(--border-color)] px-3 py-1.5">Version {snapshot.baseVersionNumber}</span> : null}
            </div>
          </div>

          {draftCandidate ? (
            <section className="rounded-lg border border-[#fedf89] bg-[#fffaeb] p-4 text-[#7a2e0e]">
              <p className="text-sm font-black">A local draft from {formatDateTime(draftCandidate.savedAt)} is available.</p>
              <p className="mt-1 text-sm font-semibold">Its base is version {draftCandidate.snapshot.baseVersionNumber}. Restore it only after checking the current Team version.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => { setSnapshot(draftCandidate.snapshot); setHistory([]); setDraftCandidate(null); setSaveState('unsaved') }} className={primaryButtonClass}>Restore draft</button>
                <button type="button" onClick={() => { window.localStorage.removeItem(draftKey); setDraftCandidate(null) }} className={secondaryButtonClass}>Discard draft</button>
              </div>
            </section>
          ) : null}

          {publishedSnapshotVersion ? (
            <NoticeBanner
              tone="info"
              title={`Published snapshot, version ${publishedSnapshotVersion.versionNumber}`}
              message={`This immutable Team Resource was published ${formatDateTime(viewedPublication?.publishedAt)}${viewedPublication?.publishedByName ? ` by ${viewedPublication.publishedByName}` : ''}. Later board edits do not change it.`}
            />
          ) : !canEdit ? <NoticeBanner tone="info" title="Read-only Team board" message="Your current Team role can view this shared board but cannot change or save it." /> : null}

          {portraitCompatibility ? (
            <NoticeBanner
              tone="info"
              title={portraitCompatibility.isHistoricalSnapshot ? 'Historical landscape snapshot' : 'Portrait pitch adaptation ready'}
              message={portraitCompatibility.isHistoricalSnapshot
                ? 'This immutable historical version is displayed on the supported portrait pitch. The saved snapshot remains unchanged.'
                : 'This board has been adapted to the supported portrait pitch. Review Player positions before saving.'}
            />
          ) : null}

          <section className={panelClass}>
            <div className="grid gap-4 lg:grid-cols-2">
              <label>
                <span className="mb-2 block text-sm font-black">Board title</span>
                <input value={snapshot.title} maxLength={120} disabled={!canEdit} onChange={(event) => updateSnapshot({ ...snapshot, title: event.target.value })} className={fieldClass} placeholder="Saturday match shape" />
              </label>
              <label>
                <span className="mb-2 block text-sm font-black">Team visibility</span>
                <select value={snapshot.visibility} disabled={!canEdit} onChange={(event) => updateSnapshot({ ...snapshot, visibility: event.target.value })} className={fieldClass}>
                  <option value="draft">Draft, creator and manager oversight</option>
                  <option value="shared">Shared with authorised Team staff</option>
                </select>
              </label>
              <label className="lg:col-span-2">
                <span className="mb-2 block text-sm font-black">Description</span>
                <textarea value={snapshot.description} maxLength={1000} disabled={!canEdit} onChange={(event) => updateSnapshot({ ...snapshot, description: event.target.value })} className={`${fieldClass} min-h-20 resize-y`} placeholder="Optional staff context" />
              </label>
            </div>
          </section>

          {!isNewBoard ? (
            <section className={panelClass} aria-label="Formation Board publication and exports">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-black">Publish and export</h2>
                  <p className="mt-1 text-sm font-semibold text-[var(--text-muted)]">
                    {publishedSnapshotVersion
                      ? 'Export this exact immutable resource snapshot.'
                      : 'Publish the saved version to Team Resources, or create a secure PNG or PDF.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!publishedSnapshotVersion && canCreate ? <button type="button" disabled={hasUnsavedChanges || isPublishing || isExporting} onClick={() => setIsPublishOpen(true)} className={primaryButtonClass}>Publish to Team Resources</button> : null}
                  {canCreate ? <button type="button" disabled={hasUnsavedChanges || isPublishing || isExporting} onClick={() => void exportBoard('png')} className={secondaryButtonClass}>Export PNG</button> : null}
                  {canCreate ? <button type="button" disabled={hasUnsavedChanges || isPublishing || isExporting} onClick={() => void exportBoard('pdf')} className={secondaryButtonClass}>Export PDF</button> : null}
                </div>
              </div>
            </section>
          ) : null}

          <section className={panelClass}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-2 block text-sm font-black">Game format</span>
                <select
                  value={snapshot.gameFormat}
                  disabled={!canEdit}
                  onChange={(event) => {
                    const firstPreset = presets.find((preset) => preset.gameFormat === event.target.value && !preset.key.endsWith('-custom'))
                    if (firstPreset) setPendingPreset(firstPreset)
                  }}
                  className={fieldClass}
                >
                  {FORMATION_BOARD_GAME_FORMATS.map((format) => <option key={format.value} value={format.value}>{format.label}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-2 block text-sm font-black">Formation</span>
                <select
                  value={snapshot.presetKey}
                  disabled={!canEdit}
                  onChange={(event) => setPendingPreset(presets.find((preset) => preset.key === event.target.value) || null)}
                  className={fieldClass}
                >
                  {presets.filter((preset) => preset.gameFormat === snapshot.gameFormat).map((preset) => <option key={preset.key} value={preset.key}>{preset.displayName}</option>)}
                </select>
              </label>
            </div>
            <p className="mt-3 text-xs font-semibold text-[var(--text-muted)]">Formation Boards use one portrait pitch. Changing formation keeps Player assignments where possible, keeps the goalkeeper in goal, and moves unmatched Players to Unplaced.</p>
          </section>

          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <section className={`${panelClass} min-w-0`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--text-secondary)]">{snapshot.gameFormat} | {currentPreset?.displayName || 'Custom'}</p>
                  <h2 className="mt-1 text-xl font-black">Pitch</h2>
                </div>
                <button type="button" onClick={undo} disabled={!canEdit || history.length === 0} className={secondaryButtonClass}>Undo</button>
              </div>
              <FormationBoardPitch
                ref={pitchRef}
                canEdit={canEdit}
                hasPlacementSource={['bench', 'marker', 'unplaced'].includes(selectedSource?.type)}
                onMove={(playerId, coordinates) => commitSnapshot(moveFormationPlayer(snapshot, playerId, coordinates))}
                onPitchPress={handlePitchPress}
                onRemove={(playerId) => commitSnapshot(removeFormationPlayer(snapshot, playerId))}
                onSelectMarker={handleMarkerSelect}
                placements={snapshot.placements}
                selectedPlayerName={selectedBoardPlayer?.displayName || ''}
                selectedMarkerId={selectedMarkerId}
              />
              {selectedSource ? <p className="mt-4 rounded-lg bg-[var(--accent-soft)] px-4 py-3 text-sm font-black">Selected: {selectedBoardPlayer?.displayName || selectedMarker?.displayName}. Tap the pitch to position.</p> : null}
              <UnplacedPlayersTray
                canEdit={canEdit}
                onDragStart={handlePlayerDragStart}
                onSelect={(player) => handleBoardPlayerSelect(player, 'unplaced')}
                players={snapshot.unplaced}
                selectedPlayerId={selectedSource?.type === 'unplaced' ? selectedSource.playerId : ''}
              />
            </section>
            <aside className={`${panelClass} hidden lg:block lg:sticky lg:top-4`} aria-label="Player assignment controls">{roster}</aside>
          </div>

          <section className={panelClass}>
            <label>
              <span className="mb-2 block text-sm font-black">Staff notes</span>
              <textarea value={snapshot.notes} maxLength={2000} disabled={!canEdit} onChange={(event) => updateSnapshot({ ...snapshot, notes: event.target.value })} className={`${fieldClass} min-h-24 resize-y`} placeholder="Optional Team staff notes" />
            </label>
          </section>

          {!isNewBoard ? (
            <VersionHistory
              canEdit={canEdit}
              currentVersionNumber={snapshot.baseVersionNumber}
              isBusy={isSaving}
              onRestoreVersion={async (version) => {
                try {
                  const restored = await restoreFormationBoardVersion({ boardId: currentBoard.id, expectedVersionNumber: snapshot.baseVersionNumber, user, versionId: version.id })
                  const next = createEditorSnapshot({ board: restored })
                  setCurrentBoard(restored); setSnapshot(next); setSavedSnapshot(next); setHistory([]); setPortraitCompatibility(null); setVersions(await getFormationBoardVersions(restored.id)); await refreshBoards()
                  showToast({ title: 'Version restored', message: `Version ${restored.currentVersionNumber} now preserves the selected layout.` })
                } catch (error) { setErrorMessage(error.message || 'That version could not be restored.') }
              }}
              versions={versions}
            />
          ) : null}

          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-color)] bg-[var(--panel-bg)]/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl backdrop-blur lg:static lg:flex lg:justify-end lg:gap-3 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
            <div className="mx-auto grid max-w-3xl grid-cols-4 gap-2 lg:mx-0 lg:flex">
              <button type="button" onClick={() => setIsRosterOpen(true)} className={`${secondaryButtonClass} lg:hidden`}>Players</button>
              <button type="button" onClick={undo} disabled={!canEdit || history.length === 0} className={`${secondaryButtonClass} lg:hidden`}>Undo</button>
              <button type="button" onClick={() => setIsActionsOpen(true)} disabled={isNewBoard} className={`${secondaryButtonClass} lg:hidden`}>Actions</button>
              <button type="button" onClick={() => void saveBoard()} disabled={!canEdit || isSaving || !hasUnsavedChanges} className={primaryButtonClass}>{isSaving ? 'Saving...' : saveState === 'failed' ? 'Retry' : 'Save'}</button>
            </div>
          </div>

          <MobileRosterSheet isOpen={isRosterOpen} onClose={() => setIsRosterOpen(false)}>{roster}</MobileRosterSheet>
        </>
      )}

      <FormationBoardDialog isOpen={isActionsOpen} onClose={() => setIsActionsOpen(false)} title="Formation Board actions">
        <div className="space-y-3">
          {hasUnsavedChanges ? <NoticeBanner tone="info" title="Save before continuing" message="Publishing and exports always use a protected saved version." /> : null}
          {!publishedSnapshotVersion && canCreate ? (
            <button type="button" disabled={hasUnsavedChanges || isPublishing || isExporting} onClick={() => { setIsActionsOpen(false); setIsPublishOpen(true) }} className={`${primaryButtonClass} w-full`}>Publish to Team Resources</button>
          ) : null}
          {canCreate ? <button type="button" disabled={hasUnsavedChanges || isPublishing || isExporting} onClick={() => void exportBoard('png')} className={`${secondaryButtonClass} w-full`}>{isExporting ? 'Preparing export...' : 'Export PNG'}</button> : null}
          {canCreate ? <button type="button" disabled={hasUnsavedChanges || isPublishing || isExporting} onClick={() => void exportBoard('pdf')} className={`${secondaryButtonClass} w-full`}>{isExporting ? 'Preparing export...' : 'Export PDF'}</button> : null}
          <p className="text-xs font-semibold leading-5 text-[var(--text-muted)]">On supported mobile devices, the secure share sheet opens. Other devices download the file. Nothing is sent automatically.</p>
        </div>
      </FormationBoardDialog>

      <FormationBoardDialog isOpen={isPublishOpen} onClose={() => !isPublishing && setIsPublishOpen(false)} title="Publish to Team Resources">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
            <BoardThumbnail board={{ ...currentBoard, currentVersion: currentBoard?.currentVersion || publishedSnapshotVersion }} />
            <div>
              <p className="text-lg font-black">{snapshot?.title}</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text-muted)]">{snapshot?.gameFormat} | {currentPreset?.displayName || snapshot?.presetKey} | Version {snapshot?.baseVersionNumber}</p>
              <p className="mt-2 text-xs font-semibold text-[var(--text-muted)]">Review this preview before publishing. This saved version stays immutable in Team Resource history.</p>
            </div>
          </div>
          <label>
            <span className="mb-2 block text-sm font-black">Team Resource category</span>
            <select value={publicationCategory} disabled={isPublishing} onChange={(event) => setPublicationCategory(event.target.value)} className={fieldClass}>
              {RESOURCE_LIBRARY_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-sm font-black">Publication action</span>
            <select value={publicationAction} disabled={isPublishing} onChange={(event) => { setPublicationAction(event.target.value); if (event.target.value === 'new_resource') setPublicationResourceId('') }} className={fieldClass}>
              <option value="new_resource">Publish as new resource</option>
              <option value="update_resource" disabled={linkedPublicationResources.length === 0}>Update existing linked resource</option>
            </select>
          </label>
          {publicationAction === 'update_resource' ? (
            <label>
              <span className="mb-2 block text-sm font-black">Linked Team Resource</span>
              <select value={publicationResourceId} disabled={isPublishing} onChange={(event) => setPublicationResourceId(event.target.value)} className={fieldClass}>
                <option value="">Choose linked resource</option>
                {linkedPublicationResources.map((publication) => <option key={publication.resourceId} value={publication.resourceId}>{publication.boardTitleSnapshot || snapshot?.title} | last publication {publication.publicationNumber}</option>)}
              </select>
            </label>
          ) : null}
          {publications.length > 0 ? (
            <details className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] p-3">
              <summary className="cursor-pointer text-sm font-black">Resource history ({publications.length})</summary>
              <div className="mt-3 space-y-2">
                {publications.map((publication) => {
                  const version = versions.find((item) => item.id === publication.boardVersionId)
                  return <p key={publication.id} className="text-xs font-semibold text-[var(--text-muted)]">Publication {publication.publicationNumber} | Version {version?.versionNumber || 'Unknown'} | {version?.formationPresetKey || 'Unknown'} | {publication.publishedByName || 'Team staff'} | {formatDateTime(publication.publishedAt)}</p>
                })}
              </div>
            </details>
          ) : null}
          <button type="button" disabled={isPublishing || hasUnsavedChanges || (publicationAction === 'update_resource' && !publicationResourceId)} onClick={() => void publishBoard()} className={`${primaryButtonClass} w-full`}>{isPublishing ? 'Publishing...' : 'Publish immutable version'}</button>
          <p className="text-xs font-semibold leading-5 text-[var(--text-muted)]">A preview thumbnail is prepared securely. If preview generation fails, publication continues with a safe fallback and the saved board remains unchanged.</p>
        </div>
      </FormationBoardDialog>

      {dragPreview ? (
        <div aria-hidden="true" className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-[calc(100%+1rem)] rounded-full bg-[#101828] px-3 py-2 text-xs font-black text-white shadow-xl" style={{ left: dragPreview.x, top: dragPreview.y }}>{dragPreview.label}</div>
      ) : null}

      <ConfirmModal
        isOpen={Boolean(pendingPreset)}
        title="Change formation?"
        message="Player assignments will be mapped to matching position groups. Any unmatched Players will move to Unplaced, and you can Undo the change."
        confirmLabel="Change formation"
        onCancel={() => setPendingPreset(null)}
        onConfirm={() => {
          commitSnapshot(applyFormationPreset(snapshot, pendingPreset))
          setPendingPreset(null)
        }}
      />

      <ConfirmModal
        isOpen={blocker.state === 'blocked'}
        title="Leave with unsaved changes?"
        message="Your local draft is protected on this device, but the Team version will not change until you save."
        confirmLabel="Leave editor"
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />

      <ConfirmModal
        isOpen={Boolean(conflict)}
        title="A newer Team version is available"
        message="Another authorised Team staff member saved a newer version. Your changes were not written over it. Reload the latest version or save your work as a new Formation Board."
        confirmLabel="Reload latest"
        onCancel={() => setConflict(null)}
        onConfirm={() => void reloadLatest()}
      >
        <button type="button" onClick={() => void saveAsNewBoard()} disabled={isSaving} className={`${secondaryButtonClass} mt-4 w-full`}>Save as new board</button>
      </ConfirmModal>
    </div>
  )
}
